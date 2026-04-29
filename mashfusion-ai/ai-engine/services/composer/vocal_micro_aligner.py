"""
IOMIXO AI — VocalMicroAligner
================================
Stage 6: Syllable-level vocal alignment with beat transients

This module takes the dominant vocal stem and micro-aligns each vocal phrase
with the target beat grid so that:

  - Phrase-initial consonant attacks land on (or just before) a beat
  - Sustained vowels sit comfortably between transients
  - No vocal phrase is orphaned mid-beat in an unnatural position

Alignment strategy:
  1. Detect beat transients in the NEW instrumental bed (after time-stretch)
  2. For each vocal phrase, find the nearest "snap target" beat
  3. Compute a micro-shift (±ms) to align onset to the beat
  4. Reject shifts > threshold_ms to preserve natural groove feel

The output is a list of VocalPlacement objects — precise timing coordinates
that the audio render engine uses when placing the vocal stem.

Dependencies: librosa, numpy, scipy
"""

from __future__ import annotations

import numpy as np
import librosa
from scipy.signal import find_peaks
from dataclasses import dataclass, field
from loguru import logger

from .deep_analyzer import SongMap, VocalPhrase, BeatEvent


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class VocalPlacement:
    """
    Precise placement of a single vocal phrase in the output mashup.
    """
    phrase_index: int
    original_onset: float       # original phrase onset in source track (seconds)
    original_end: float         # original phrase end in source track (seconds)
    output_onset: float         # where to place this phrase in output mashup (seconds)
    micro_shift_ms: float       # correction applied (positive = pushed forward)
    snap_beat_time: float       # the beat this phrase was snapped to
    snap_quality: float         # 0–1 (1 = perfectly on beat)
    was_adjusted: bool
    segment_act: str            # which arrangement act this phrase belongs to
    notes: str = ""


@dataclass
class AlignmentResult:
    """
    Full alignment result for one track's vocals.
    """
    track_id: str
    placements: list[VocalPlacement] = field(default_factory=list)
    mean_shift_ms: float = 0.0
    max_shift_ms: float = 0.0
    alignment_coverage: float = 0.0   # fraction of phrases that were successfully aligned


# ─────────────────────────────────────────────────────────────────────────────
# VOCAL MICRO ALIGNER
# ─────────────────────────────────────────────────────────────────────────────

# Maximum allowed micro-shift before we leave the phrase in place
_MAX_SHIFT_MS = 80.0    # ms — beyond this, keep original position (preserve feel)
_BEAT_LOOKAHEAD = 2     # look ±2 beats when searching for snap target
_GRID_RESOLUTION = 0.25  # snap to quarter-note (1/4 beat grid)


class VocalMicroAligner:
    """
    Aligns vocal phrases to the new beat grid with sub-millisecond precision.

    Usage:
        aligner = VocalMicroAligner(sr=44100)
        result = aligner.align(
            song_map=dominant_song_map,
            target_beat_events=new_beat_events,   # from time-stretched instrumental
            arrangement_start_offset=30.0,        # where in output mashup this section starts
            act="first_payoff"
        )
    """

    def __init__(self, sr: int = 44100):
        self.sr = sr

    def align(
        self,
        song_map: SongMap,
        target_beat_events: list[BeatEvent],
        arrangement_start_offset: float = 0.0,
        act: str = "unknown",
        max_shift_ms: float = _MAX_SHIFT_MS,
    ) -> AlignmentResult:
        """
        Align all vocal phrases in song_map to the target beat grid.

        Args:
            song_map: SongMap with vocal_phrases populated
            target_beat_events: beat timestamps in the NEW bed (after time-stretch)
            arrangement_start_offset: where in the final mashup this section begins
            act: narrative act name (for metadata)
            max_shift_ms: maximum micro-shift allowed in milliseconds

        Returns:
            AlignmentResult with per-phrase VocalPlacements
        """
        if not song_map.vocal_phrases:
            logger.warning(
                f"[VocalMicroAligner] Track {song_map.track_id} has no vocal phrases"
            )
            return AlignmentResult(track_id=song_map.track_id)

        if not target_beat_events:
            logger.warning(
                "[VocalMicroAligner] No target beat events — using original timings"
            )
            return self._passthrough(song_map, arrangement_start_offset, act)

        beat_times = np.array([be.time for be in target_beat_events])

        placements: list[VocalPlacement] = []
        shifts_ms: list[float] = []
        adjusted_count = 0

        for i, phrase in enumerate(song_map.vocal_phrases):
            onset = phrase.onset_time

            # Map onset to output timeline position
            output_onset_raw = onset + arrangement_start_offset

            # Find nearest beat to snap to
            nearest_beat, snap_quality = self._find_snap_target(
                onset_time=onset,
                beat_times=beat_times,
                arrangement_offset=arrangement_start_offset,
            )

            # Compute shift
            shift_s = nearest_beat - output_onset_raw
            shift_ms = shift_s * 1000.0

            # Only apply if within tolerance
            if abs(shift_ms) <= max_shift_ms and snap_quality > 0.3:
                adjusted_onset = nearest_beat
                was_adjusted = True
                adjusted_count += 1
            else:
                adjusted_onset = output_onset_raw
                shift_ms = 0.0
                was_adjusted = False

            placements.append(VocalPlacement(
                phrase_index=i,
                original_onset=round(onset, 4),
                original_end=round(phrase.end, 4),
                output_onset=round(adjusted_onset, 4),
                micro_shift_ms=round(shift_ms, 2),
                snap_beat_time=round(nearest_beat, 4),
                snap_quality=round(snap_quality, 4),
                was_adjusted=was_adjusted,
                segment_act=act,
                notes=self._generate_note(shift_ms, snap_quality, was_adjusted),
            ))

            shifts_ms.append(abs(shift_ms))

        mean_shift = float(np.mean(shifts_ms)) if shifts_ms else 0.0
        max_shift = float(np.max(shifts_ms)) if shifts_ms else 0.0
        coverage = adjusted_count / len(placements) if placements else 0.0

        logger.info(
            f"[VocalMicroAligner] Track {song_map.track_id} — "
            f"{len(placements)} phrases, "
            f"{adjusted_count} adjusted, "
            f"mean_shift={mean_shift:.1f}ms, "
            f"coverage={coverage:.1%}"
        )

        return AlignmentResult(
            track_id=song_map.track_id,
            placements=placements,
            mean_shift_ms=round(mean_shift, 2),
            max_shift_ms=round(max_shift, 2),
            alignment_coverage=round(coverage, 4),
        )

    def align_from_audio(
        self,
        song_map: SongMap,
        instrumental_audio: np.ndarray,
        arrangement_start_offset: float = 0.0,
        act: str = "unknown",
        max_shift_ms: float = _MAX_SHIFT_MS,
    ) -> AlignmentResult:
        """
        Variant: extract beat events directly from a numpy audio array
        (the actual rendered instrumental bed) then align.
        """
        logger.info("[VocalMicroAligner] Extracting beat events from instrumental audio")

        onset_env = librosa.onset.onset_strength(y=instrumental_audio, sr=self.sr)
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=self.sr
        )
        beat_times_np = librosa.frames_to_time(beat_frames, sr=self.sr)

        beat_events = [
            BeatEvent(
                time=round(float(t), 4),
                beat_index=i,
                local_bpm=round(float(tempo), 2),
                strength=1.0,
            )
            for i, t in enumerate(beat_times_np)
        ]

        return self.align(
            song_map=song_map,
            target_beat_events=beat_events,
            arrangement_start_offset=arrangement_start_offset,
            act=act,
            max_shift_ms=max_shift_ms,
        )

    # ─────────────────────────────────────────────────────────────────────
    # BEAT SNAP LOGIC
    # ─────────────────────────────────────────────────────────────────────

    def _find_snap_target(
        self,
        onset_time: float,
        beat_times: np.ndarray,
        arrangement_offset: float,
    ) -> tuple[float, float]:
        """
        Find the best beat in the target grid to snap this vocal onset to.

        Returns (snap_time_in_output, quality_0_to_1)
        where quality = how well the snap aligns (1 = perfect on-beat).
        """
        if len(beat_times) == 0:
            return onset_time + arrangement_offset, 0.0

        # Shift beat times to output space
        output_beats = beat_times + arrangement_offset

        # Find onset in output space
        output_onset = onset_time + arrangement_offset

        # Find nearest beat index
        distances = np.abs(output_beats - output_onset)
        nearest_idx = int(np.argmin(distances))
        nearest_time = float(output_beats[nearest_idx])
        nearest_dist_ms = abs(nearest_time - output_onset) * 1000.0

        # Quality: 1.0 if perfectly on beat, 0 if >_MAX_SHIFT_MS away
        quality = float(np.clip(1.0 - nearest_dist_ms / _MAX_SHIFT_MS, 0, 1))

        # Check beat neighbors for potentially better snap
        # (e.g. snap to 1/8 or 1/16 subdivision if closer)
        if nearest_idx > 0 and nearest_idx < len(output_beats) - 1:
            beat_interval = float(
                output_beats[nearest_idx] - output_beats[nearest_idx - 1]
            )
            # Subdivisions: half-beat (1/8th note)
            for sub_fraction in [0.5, 0.25]:
                for direction in [-1, 0, 1]:
                    candidate = nearest_time + direction * beat_interval * sub_fraction
                    dist = abs(candidate - output_onset) * 1000.0
                    sub_quality = float(np.clip(1.0 - dist / _MAX_SHIFT_MS, 0, 1))
                    if sub_quality > quality:
                        nearest_time = candidate
                        quality = sub_quality

        return round(nearest_time, 4), round(quality, 4)

    # ─────────────────────────────────────────────────────────────────────
    # PASSTHROUGH (no beat info)
    # ─────────────────────────────────────────────────────────────────────

    def _passthrough(
        self,
        song_map: SongMap,
        offset: float,
        act: str,
    ) -> AlignmentResult:
        """Return placements with original timings + offset, no adjustment."""
        placements = [
            VocalPlacement(
                phrase_index=i,
                original_onset=p.onset_time,
                original_end=p.end,
                output_onset=round(p.onset_time + offset, 4),
                micro_shift_ms=0.0,
                snap_beat_time=round(p.onset_time + offset, 4),
                snap_quality=0.0,
                was_adjusted=False,
                segment_act=act,
                notes="Passthrough — no beat events available",
            )
            for i, p in enumerate(song_map.vocal_phrases)
        ]
        return AlignmentResult(
            track_id=song_map.track_id,
            placements=placements,
            mean_shift_ms=0.0,
            max_shift_ms=0.0,
            alignment_coverage=0.0,
        )

    @staticmethod
    def _generate_note(shift_ms: float, quality: float, adjusted: bool) -> str:
        if not adjusted:
            return f"No adjustment (shift {shift_ms:.1f}ms > threshold or quality {quality:.2f} too low)"
        direction = "forward" if shift_ms > 0 else "backward"
        return (
            f"Snapped {direction} by {abs(shift_ms):.1f}ms "
            f"(beat quality={quality:.2f})"
        )

    # ─────────────────────────────────────────────────────────────────────
    # SERIALIZATION
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def to_json(result: AlignmentResult) -> dict:
        return {
            "track_id": result.track_id,
            "mean_shift_ms": result.mean_shift_ms,
            "max_shift_ms": result.max_shift_ms,
            "alignment_coverage": result.alignment_coverage,
            "placements": [
                {
                    "phrase_index": p.phrase_index,
                    "original_onset": p.original_onset,
                    "original_end": p.original_end,
                    "output_onset": p.output_onset,
                    "micro_shift_ms": p.micro_shift_ms,
                    "snap_beat_time": p.snap_beat_time,
                    "snap_quality": p.snap_quality,
                    "was_adjusted": p.was_adjusted,
                    "segment_act": p.segment_act,
                    "notes": p.notes,
                }
                for p in result.placements
            ],
        }
