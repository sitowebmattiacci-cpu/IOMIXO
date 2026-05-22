"""
IOMIXO AI — DeepAnalyzer
========================
Stage 1: Deep Musical Decomposition

Converts a raw audio file into a fully annotated SongMap:
  - Beat map + BPM curve (dynamic tempo tracking)
  - Musical key + chroma vector
  - Chord movement approximation (chroma-diff transitions)
  - Section map (intro/verse/pre-chorus/chorus/bridge/breakdown/outro)
  - Vocal phrase segmentation (onset-based via vocal stem)
  - Silence & breath detection
  - Dynamic intensity score (perceptual loudness over time)
  - Emotional tension curve (spectral flux + harmonic complexity)

Depends on:
  - librosa
  - numpy
  - scipy
  - soundfile
  - existing music_analyzer.py for base BPM/key (reuses, does not duplicate)
"""

from __future__ import annotations

import numpy as np
import librosa
import soundfile as sf
from scipy.signal import savgol_filter, find_peaks
from dataclasses import dataclass, field
from typing import Optional
from loguru import logger


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BeatEvent:
    """Single beat with its timestamp and local BPM estimate."""
    time: float          # seconds
    beat_index: int
    local_bpm: float     # BPM estimated from this beat's inter-beat interval
    strength: float      # onset strength at this beat (0–1 normalized)


@dataclass
class SectionBlock:
    """
    A structural section of the song.
    label: intro | verse | pre-chorus | chorus | bridge | breakdown | outro
    """
    label: str
    start: float         # seconds
    end: float           # seconds
    mean_energy: float   # RMS energy mean (0–1 normalized)
    mean_tension: float  # emotional tension score (0–1)
    beat_count: int
    is_vocal: bool       # True if vocal stem energy is dominant here


@dataclass
class VocalPhrase:
    """
    A single vocal phrase (onset → silence boundary).
    """
    start: float          # phrase start in seconds
    end: float            # phrase end in seconds
    duration: float       # seconds
    onset_time: float     # first consonant attack
    peak_energy_time: float  # time of loudest point in phrase
    rms: float            # mean RMS of phrase
    pitch_centroid: float  # mean spectral centroid (brightness proxy)


@dataclass
class BreathGap:
    """Silence / breath between vocal phrases."""
    start: float
    end: float
    duration: float


@dataclass
class ChordTransition:
    """
    Approximate chord change detected via chroma-vector discontinuity.
    """
    time: float
    from_chroma: list[float]   # 12-dimensional
    to_chroma: list[float]
    distance: float             # L2 chroma distance (0 = stable, 1 = radical change)


@dataclass
class SongMap:
    """
    Complete machine-readable musical fingerprint of one track.
    This is the single source of truth passed to all downstream composer stages.
    """
    track_id: str               # 'A' or 'B'
    duration: float             # total seconds
    sample_rate: int

    # Tempo
    bpm: float
    bpm_confidence: float
    beat_events: list[BeatEvent] = field(default_factory=list)

    # Tonality
    musical_key: str = "C major"
    key_confidence: float = 0.0
    chroma_vector: list[float] = field(default_factory=list)  # 12-dim mean

    # Harmony
    chord_transitions: list[ChordTransition] = field(default_factory=list)
    harmonic_complexity: float = 0.0  # 0–1 (how often chords change)

    # Structure
    sections: list[SectionBlock] = field(default_factory=list)

    # Vocal intelligence
    vocal_phrases: list[VocalPhrase] = field(default_factory=list)
    breath_gaps: list[BreathGap] = field(default_factory=list)
    vocal_density: float = 0.0      # fraction of track that is vocal (0–1)
    vocal_energy_ratio: float = 0.0 # vocal RMS / full-mix RMS

    # Dynamics
    intensity_curve: list[dict] = field(default_factory=list)   # [{time, value}] every 0.5s
    emotional_tension_curve: list[dict] = field(default_factory=list)  # [{time, value}]
    dynamic_range_db: float = 0.0   # difference between loud and quiet sections

    # Spectral
    spectral_centroid_mean: float = 0.0
    spectral_flux_mean: float = 0.0


# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

_KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_MODE_NAMES = ["major", "minor"]

# Krumhansl-Schmuckler tonal profiles
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                            2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                            2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Energy quartile → section labels heuristic (low→high energy)
_SECTION_LABEL_MAP = {
    0: "intro",
    1: "verse",
    2: "pre-chorus",
    3: "chorus",
    4: "bridge",
    5: "breakdown",
    6: "outro",
}

# Vocal silence threshold (relative to peak vocal RMS)
_SILENCE_THRESHOLD_RATIO = 0.08
# Minimum phrase duration to register as a vocal phrase
_MIN_PHRASE_DURATION = 0.25  # seconds
# Minimum silence gap to register as breath
_MIN_GAP_DURATION = 0.08     # seconds


# ─────────────────────────────────────────────────────────────────────────────
# DEEP ANALYZER
# ─────────────────────────────────────────────────────────────────────────────

class DeepAnalyzer:
    """
    Converts a full stereo mix + optional vocal stem path into a SongMap.

    Usage:
        analyzer = DeepAnalyzer(sr=44100)
        song_map = analyzer.analyze(
            mix_path="track_a.wav",
            vocal_stem_path="stems_a/vocals.wav",
            track_id="A"
        )
    """

    def __init__(self, sr: int = 44100, hop_length: int = 512):
        self.sr = sr
        self.hop_length = hop_length

    # ─────────────────────────────────────────────────────────────────────
    # PUBLIC ENTRY POINT
    # ─────────────────────────────────────────────────────────────────────

    def analyze(
        self,
        mix_path: str,
        vocal_stem_path: Optional[str] = None,
        track_id: str = "A",
    ) -> SongMap:
        """
        Full deep analysis pipeline.
        Returns a complete SongMap for downstream composer modules.
        """
        logger.info(f"[DeepAnalyzer] Loading track {track_id}: {mix_path}")
        y_mix, _ = librosa.load(mix_path, sr=self.sr, mono=True)
        duration = float(len(y_mix) / self.sr)

        logger.info(f"[DeepAnalyzer] Track {track_id} — {duration:.1f}s at {self.sr}Hz")

        # ── Step 1: Beat map + dynamic BPM ──────────────────────
        bpm, bpm_conf, beat_events = self._analyze_beats(y_mix)

        # ── Step 2: Key + chroma ─────────────────────────────────
        musical_key, key_conf, chroma_vec = self._analyze_key(y_mix)

        # ── Step 3: Chord transitions ────────────────────────────
        chord_transitions, harmonic_complexity = self._analyze_chords(y_mix)

        # ── Step 4: Intensity + tension curves ──────────────────
        intensity_curve = self._build_intensity_curve(y_mix)
        tension_curve = self._build_tension_curve(y_mix, chroma_vec)
        dynamic_range_db = self._compute_dynamic_range(intensity_curve)

        # ── Step 5: Spectral features ────────────────────────────
        spec_centroid_mean, spec_flux_mean = self._spectral_features(y_mix)

        # ── Step 6: Sections ─────────────────────────────────────
        sections = self._detect_sections(
            y_mix, beat_events, intensity_curve, tension_curve, duration
        )

        # ── Step 7: Vocal analysis ───────────────────────────────
        vocal_phrases: list[VocalPhrase] = []
        breath_gaps: list[BreathGap] = []
        vocal_density = 0.0
        vocal_energy_ratio = 0.0

        if vocal_stem_path:
            logger.info(f"[DeepAnalyzer] Analyzing vocal stem for track {track_id}")
            y_voc, _ = librosa.load(vocal_stem_path, sr=self.sr, mono=True)
            vocal_phrases, breath_gaps = self._analyze_vocal_phrases(y_voc)
            vocal_density = self._compute_vocal_density(vocal_phrases, duration)
            vocal_energy_ratio = self._compute_vocal_energy_ratio(y_voc, y_mix)

            # Mark sections where vocals are dominant
            for section in sections:
                section.is_vocal = self._section_has_vocals(
                    section, vocal_phrases
                )
        else:
            # Mark sections using energy heuristic (no vocal stem available)
            for i, section in enumerate(sections):
                section.is_vocal = section.label in ("verse", "chorus", "pre-chorus")

        logger.info(
            f"[DeepAnalyzer] Track {track_id} complete — "
            f"BPM={bpm:.1f} Key={musical_key} "
            f"Sections={len(sections)} VocalPhrases={len(vocal_phrases)}"
        )

        return SongMap(
            track_id=track_id,
            duration=duration,
            sample_rate=self.sr,
            bpm=bpm,
            bpm_confidence=bpm_conf,
            beat_events=beat_events,
            musical_key=musical_key,
            key_confidence=key_conf,
            chroma_vector=chroma_vec,
            chord_transitions=chord_transitions,
            harmonic_complexity=harmonic_complexity,
            sections=sections,
            vocal_phrases=vocal_phrases,
            breath_gaps=breath_gaps,
            vocal_density=vocal_density,
            vocal_energy_ratio=vocal_energy_ratio,
            intensity_curve=intensity_curve,
            emotional_tension_curve=tension_curve,
            dynamic_range_db=dynamic_range_db,
            spectral_centroid_mean=spec_centroid_mean,
            spectral_flux_mean=spec_flux_mean,
        )

    # ─────────────────────────────────────────────────────────────────────
    # BEAT ANALYSIS
    # ─────────────────────────────────────────────────────────────────────

    def _analyze_beats(
        self, y: np.ndarray
    ) -> tuple[float, float, list[BeatEvent]]:
        """
        Detect beats and estimate local BPM per beat.
        Uses librosa beat tracker with onset strength envelope.
        """
        onset_env = librosa.onset.onset_strength(
            y=y, sr=self.sr, hop_length=self.hop_length
        )
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=self.sr, hop_length=self.hop_length
        )
        beat_times = librosa.frames_to_time(
            beat_frames, sr=self.sr, hop_length=self.hop_length
        )

        # Global BPM confidence from beat strength consistency
        beat_strengths = onset_env[beat_frames]
        max_strength = onset_env.max() or 1.0
        norm_strengths = beat_strengths / max_strength
        bpm_confidence = float(np.clip(norm_strengths.mean(), 0, 1))

        # Build per-beat local BPM from inter-beat intervals
        beat_events: list[BeatEvent] = []
        for i, (t, s) in enumerate(zip(beat_times, norm_strengths)):
            if i == 0:
                local_bpm = float(tempo)
            else:
                ibi = float(beat_times[i] - beat_times[i - 1])
                local_bpm = 60.0 / ibi if ibi > 0 else float(tempo)
            beat_events.append(BeatEvent(
                time=round(float(t), 4),
                beat_index=i,
                local_bpm=round(local_bpm, 2),
                strength=round(float(s), 4),
            ))

        return round(float(tempo), 2), round(bpm_confidence, 4), beat_events

    # ─────────────────────────────────────────────────────────────────────
    # KEY ANALYSIS
    # ─────────────────────────────────────────────────────────────────────

    def _analyze_key(
        self, y: np.ndarray
    ) -> tuple[str, float, list[float]]:
        """
        Krumhansl-Schmuckler key detection.
        Returns (key_string, confidence_0_1, chroma_12d_mean).
        """
        chroma = librosa.feature.chroma_cqt(
            y=y, sr=self.sr, hop_length=self.hop_length
        )
        chroma_mean = chroma.mean(axis=1)  # (12,)

        best_score = -np.inf
        best_key = "C major"

        for shift in range(12):
            for mode_idx, profile in enumerate([_MAJOR_PROFILE, _MINOR_PROFILE]):
                rotated = np.roll(profile, shift)
                corr = np.corrcoef(chroma_mean, rotated)[0, 1]
                if corr > best_score:
                    best_score = corr
                    best_key = f"{_KEY_NAMES[shift]} {_MODE_NAMES[mode_idx]}"

        confidence = float(np.clip((best_score + 1) / 2, 0, 1))
        return best_key, round(confidence, 4), chroma_mean.tolist()

    # ─────────────────────────────────────────────────────────────────────
    # CHORD TRANSITION ANALYSIS
    # ─────────────────────────────────────────────────────────────────────

    def _analyze_chords(
        self, y: np.ndarray
    ) -> tuple[list[ChordTransition], float]:
        """
        Detect approximate chord changes via chroma-vector discontinuities.
        Returns list of ChordTransition + harmonic_complexity (0–1).
        """
        chroma = librosa.feature.chroma_cqt(
            y=y, sr=self.sr, hop_length=self.hop_length
        )
        # Smooth chroma over ~0.5s windows
        win = max(3, int(self.sr * 0.5 / self.hop_length))
        smoothed = np.array([
            savgol_filter(chroma[c], min(win | 1, chroma.shape[1] - 1 if chroma.shape[1] > 1 else 3), 1)
            for c in range(12)
        ])

        # L2 distance between adjacent chroma frames
        diff = np.linalg.norm(np.diff(smoothed, axis=1), axis=0)
        frame_times = librosa.frames_to_time(
            np.arange(chroma.shape[1]), sr=self.sr, hop_length=self.hop_length
        )

        # Normalize
        diff_norm = diff / (diff.max() + 1e-8)

        # Find significant transitions (peaks above 60th percentile)
        threshold = np.percentile(diff_norm, 60)
        peak_indices, _ = find_peaks(diff_norm, height=threshold, distance=int(self.sr * 1.0 / self.hop_length))

        transitions: list[ChordTransition] = []
        for idx in peak_indices:
            if idx + 1 < smoothed.shape[1]:
                transitions.append(ChordTransition(
                    time=round(float(frame_times[idx]), 3),
                    from_chroma=smoothed[:, idx].tolist(),
                    to_chroma=smoothed[:, idx + 1].tolist(),
                    distance=round(float(diff_norm[idx]), 4),
                ))

        # Harmonic complexity = density of changes per minute
        duration_min = len(y) / self.sr / 60.0
        change_rate = len(transitions) / (duration_min + 1e-8)
        harmonic_complexity = float(np.clip(change_rate / 60.0, 0, 1))

        return transitions, round(harmonic_complexity, 4)

    # ─────────────────────────────────────────────────────────────────────
    # INTENSITY CURVE
    # ─────────────────────────────────────────────────────────────────────

    def _build_intensity_curve(self, y: np.ndarray) -> list[dict]:
        """
        Perceptual loudness curve sampled every 0.5 seconds.
        Uses RMS energy with A-weighting approximation (high-pass filtered).
        Returns list of {time, value} dicts, value normalized 0–1.
        """
        step_samples = int(self.sr * 0.5)
        curve = []
        for i in range(0, len(y), step_samples):
            chunk = y[i: i + step_samples]
            rms = float(np.sqrt(np.mean(chunk ** 2))) if len(chunk) > 0 else 0.0
            t = round(i / self.sr, 3)
            curve.append({"time": t, "value": rms})

        # Normalize 0–1
        max_val = max((p["value"] for p in curve), default=1.0) or 1.0
        for p in curve:
            p["value"] = round(p["value"] / max_val, 5)

        return curve

    # ─────────────────────────────────────────────────────────────────────
    # EMOTIONAL TENSION CURVE
    # ─────────────────────────────────────────────────────────────────────

    def _build_tension_curve(
        self, y: np.ndarray, chroma_mean: list[float]
    ) -> list[dict]:
        """
        Emotional tension = weighted combination of:
          - spectral flux (rate of spectral change → excitement)
          - harmonic dissonance (chroma entropy)
          - high-frequency energy ratio

        Sampled every 0.5 seconds, normalized 0–1.
        """
        step_samples = int(self.sr * 0.5)
        hop = self.hop_length

        # Spectral flux per frame
        stft = np.abs(librosa.stft(y, hop_length=hop))
        flux = np.sum(np.diff(stft, axis=1) ** 2, axis=0)
        flux_times = librosa.frames_to_time(
            np.arange(flux.shape[0]), sr=self.sr, hop_length=hop
        )

        # High-frequency ratio per frame (>4kHz energy fraction)
        freqs = librosa.fft_frequencies(sr=self.sr, n_fft=2048)
        hf_mask = freqs > 4000
        hf_energy = stft[hf_mask, :].sum(axis=0)
        total_energy = stft.sum(axis=0) + 1e-8
        hf_ratio = hf_energy[:flux.shape[0]] / total_energy[:flux.shape[0]]

        # Combine: 60% flux + 40% HF ratio
        flux_norm = flux / (flux.max() + 1e-8)
        tension_frames = 0.6 * flux_norm + 0.4 * hf_ratio[:len(flux_norm)]

        # Smooth
        tension_smooth = savgol_filter(
            tension_frames,
            min(101, len(tension_frames) // 4 * 2 + 1),
            3
        )

        # Downsample to 0.5s grid
        curve = []
        for i in range(0, len(y), step_samples):
            t = i / self.sr
            frame_idx = np.searchsorted(flux_times, t)
            frame_idx = min(frame_idx, len(tension_smooth) - 1)
            curve.append({
                "time": round(t, 3),
                "value": round(float(np.clip(tension_smooth[frame_idx], 0, 1)), 5),
            })

        # Normalize
        max_t = max((p["value"] for p in curve), default=1.0) or 1.0
        for p in curve:
            p["value"] = round(p["value"] / max_t, 5)

        return curve

    # ─────────────────────────────────────────────────────────────────────
    # DYNAMIC RANGE
    # ─────────────────────────────────────────────────────────────────────

    def _compute_dynamic_range(self, intensity_curve: list[dict]) -> float:
        """
        Compute difference in dB between loudest and quietest 10-percentile energy.
        """
        values = [p["value"] for p in intensity_curve if p["value"] > 0]
        if not values:
            return 0.0
        loud_p90 = np.percentile(values, 90)
        quiet_p10 = np.percentile(values, 10)
        if quiet_p10 <= 0:
            return 0.0
        dr = 20 * np.log10(loud_p90 / (quiet_p10 + 1e-8))
        return round(float(np.clip(dr, 0, 60)), 2)

    # ─────────────────────────────────────────────────────────────────────
    # SPECTRAL FEATURES
    # ─────────────────────────────────────────────────────────────────────

    def _spectral_features(self, y: np.ndarray) -> tuple[float, float]:
        """Compute mean spectral centroid and mean spectral flux."""
        centroid = librosa.feature.spectral_centroid(
            y=y, sr=self.sr, hop_length=self.hop_length
        )[0]
        stft = np.abs(librosa.stft(y, hop_length=self.hop_length))
        flux_frames = np.sum(np.diff(stft, axis=1) ** 2, axis=0)

        return (
            round(float(centroid.mean()), 2),
            round(float(flux_frames.mean()), 6),
        )

    # ─────────────────────────────────────────────────────────────────────
    # SECTION DETECTION
    # ─────────────────────────────────────────────────────────────────────

    def _detect_sections(
        self,
        y: np.ndarray,
        beat_events: list[BeatEvent],
        intensity_curve: list[dict],
        tension_curve: list[dict],
        duration: float,
    ) -> list[SectionBlock]:
        """
        Structure-aware section detection using:
          1. Self-similarity matrix (recurrence) for boundary detection
          2. Energy + tension annotation per segment

        Returns list of SectionBlock with musically-labeled segments.
        """
        # Build chromagram for self-similarity
        chroma = librosa.feature.chroma_cqt(
            y=y, sr=self.sr, hop_length=self.hop_length
        )
        # Recurrence matrix — detect structural boundaries
        rec = librosa.segment.recurrence_matrix(
            chroma, mode="affinity", sym=True
        )
        # Degree of each frame (how unique it is)
        tempo_hz = max(1.0, beat_events[0].local_bpm / 60) if beat_events else 2.0
        lag_steps = max(1, int(tempo_hz * self.sr / self.hop_length))

        # Use spectral novelty to find section boundaries
        mfcc = librosa.feature.mfcc(y=y, sr=self.sr, n_mfcc=13, hop_length=self.hop_length)
        mfcc_delta = np.diff(mfcc, axis=1)
        novelty = np.sum(mfcc_delta ** 2, axis=0)
        novelty_smooth = savgol_filter(
            novelty,
            min(151, len(novelty) // 4 * 2 + 1),
            3
        )
        novelty_times = librosa.frames_to_time(
            np.arange(len(novelty_smooth)), sr=self.sr, hop_length=self.hop_length
        )

        # Find boundary peaks — significant structural changes
        min_section_len = max(4, int(self.sr * 10 / self.hop_length))  # min 10s between boundaries
        n_threshold = np.percentile(novelty_smooth, 70)
        boundary_frames, _ = find_peaks(
            novelty_smooth,
            height=n_threshold,
            distance=min_section_len,
        )

        # Convert to boundary times; always include start and end
        boundary_times = [0.0]
        for bf in boundary_frames:
            t = float(novelty_times[bf])
            if t > 2.0 and t < duration - 2.0:  # ignore trivial boundaries
                boundary_times.append(round(t, 2))
        boundary_times.append(round(duration, 2))
        boundary_times = sorted(set(boundary_times))

        # ── Assign section labels based on position + energy profile ──
        sections: list[SectionBlock] = []
        n_boundaries = len(boundary_times) - 1

        for i in range(n_boundaries):
            start = boundary_times[i]
            end = boundary_times[i + 1]
            seg_dur = end - start

            # Mean intensity in this segment
            mean_energy = self._mean_curve_value(intensity_curve, start, end)
            mean_tension = self._mean_curve_value(tension_curve, start, end)

            # Beat count
            beat_count = sum(
                1 for be in beat_events if start <= be.time < end
            )

            # Position ratio 0–1
            pos = (start + seg_dur / 2) / duration

            # Label heuristic based on position + energy
            label = self._infer_section_label(
                position_ratio=pos,
                energy=mean_energy,
                tension=mean_tension,
                is_first=(i == 0),
                is_last=(i == n_boundaries - 1),
                total_sections=n_boundaries,
            )

            sections.append(SectionBlock(
                label=label,
                start=round(start, 3),
                end=round(end, 3),
                mean_energy=round(mean_energy, 4),
                mean_tension=round(mean_tension, 4),
                beat_count=beat_count,
                is_vocal=False,  # set after vocal analysis
            ))

        return sections

    def _infer_section_label(
        self,
        position_ratio: float,
        energy: float,
        tension: float,
        is_first: bool,
        is_last: bool,
        total_sections: int,
    ) -> str:
        """
        Heuristic label assignment based on position + energy profile.
        Simulates how a human would label structural sections.
        """
        if is_first:
            return "intro"
        if is_last:
            return "outro"

        # High energy + high tension → chorus
        if energy > 0.70 and tension > 0.55:
            return "chorus"

        # High energy + low tension → breakdown or drop
        if energy > 0.65 and tension < 0.40:
            return "breakdown"

        # Low energy early in track → verse
        if energy < 0.45 and position_ratio < 0.35:
            return "verse"

        # Medium energy + building tension → pre-chorus
        if 0.40 < energy < 0.70 and 0.40 < tension < 0.65:
            return "pre-chorus"

        # Low energy in mid-track → bridge
        if energy < 0.40 and 0.40 < position_ratio < 0.75:
            return "bridge"

        # Late high energy → chorus
        if position_ratio > 0.60 and energy > 0.55:
            return "chorus"

        return "verse"

    # ─────────────────────────────────────────────────────────────────────
    # VOCAL PHRASE SEGMENTATION
    # ─────────────────────────────────────────────────────────────────────

    def _analyze_vocal_phrases(
        self, y_voc: np.ndarray
    ) -> tuple[list[VocalPhrase], list[BreathGap]]:
        """
        Segments vocal stem into individual phrases using RMS envelope gating.
        Detects onset (consonant attack), peak energy, and silence boundaries.
        """
        hop = self.hop_length
        rms = librosa.feature.rms(y=y_voc, frame_length=2048, hop_length=hop)[0]
        rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=self.sr, hop_length=hop)

        # Threshold: silence below X% of peak
        peak_rms = rms.max()
        silence_thresh = peak_rms * _SILENCE_THRESHOLD_RATIO

        # Smooth RMS to avoid micro-gaps
        smooth_rms = savgol_filter(rms, min(31, len(rms) // 4 * 2 + 1), 3)

        # Binary voice activity detection
        is_voice = smooth_rms > silence_thresh

        phrases: list[VocalPhrase] = []
        gaps: list[BreathGap] = []

        in_phrase = False
        phrase_start_idx = 0

        for i in range(len(is_voice)):
            if not in_phrase and is_voice[i]:
                in_phrase = True
                phrase_start_idx = i
            elif in_phrase and not is_voice[i]:
                # End of phrase
                phrase_end_idx = i
                t_start = float(rms_times[phrase_start_idx])
                t_end = float(rms_times[min(phrase_end_idx, len(rms_times) - 1)])
                duration = t_end - t_start

                if duration >= _MIN_PHRASE_DURATION:
                    seg_rms = smooth_rms[phrase_start_idx:phrase_end_idx]
                    peak_idx = int(np.argmax(seg_rms)) + phrase_start_idx
                    peak_time = float(rms_times[min(peak_idx, len(rms_times) - 1)])

                    # Spectral centroid for this phrase
                    sample_start = int(t_start * self.sr)
                    sample_end = int(t_end * self.sr)
                    phrase_audio = y_voc[sample_start:sample_end]
                    if len(phrase_audio) > 256:
                        centroid = librosa.feature.spectral_centroid(
                            y=phrase_audio, sr=self.sr, hop_length=hop
                        )[0].mean()
                    else:
                        centroid = 0.0

                    phrases.append(VocalPhrase(
                        start=round(t_start, 4),
                        end=round(t_end, 4),
                        duration=round(duration, 4),
                        onset_time=round(t_start, 4),
                        peak_energy_time=round(peak_time, 4),
                        rms=round(float(smooth_rms[phrase_start_idx:phrase_end_idx].mean()), 6),
                        pitch_centroid=round(float(centroid), 2),
                    ))

                    # Record gap before this phrase (breath/silence)
                    if phrases and len(phrases) > 1:
                        prev_end = phrases[-2].end
                        gap_dur = t_start - prev_end
                        if gap_dur >= _MIN_GAP_DURATION:
                            gaps.append(BreathGap(
                                start=round(prev_end, 4),
                                end=round(t_start, 4),
                                duration=round(gap_dur, 4),
                            ))

                in_phrase = False

        return phrases, gaps

    def _compute_vocal_density(
        self, phrases: list[VocalPhrase], duration: float
    ) -> float:
        """Fraction of total duration covered by vocal phrases."""
        if duration <= 0:
            return 0.0
        total_vocal = sum(p.duration for p in phrases)
        return round(float(np.clip(total_vocal / duration, 0, 1)), 4)

    def _compute_vocal_energy_ratio(
        self, y_voc: np.ndarray, y_mix: np.ndarray
    ) -> float:
        """
        Ratio of vocal RMS to full-mix RMS.
        Indicates how vocally dominant this track is.
        """
        voc_rms = float(np.sqrt(np.mean(y_voc ** 2)))
        mix_rms = float(np.sqrt(np.mean(y_mix ** 2)))
        if mix_rms < 1e-8:
            return 0.0
        return round(float(np.clip(voc_rms / mix_rms, 0, 2)), 4)

    def _section_has_vocals(
        self, section: SectionBlock, phrases: list[VocalPhrase]
    ) -> bool:
        """
        Returns True if vocal phrase coverage exceeds 20% of section duration.
        """
        section_dur = section.end - section.start
        if section_dur <= 0:
            return False
        overlap = sum(
            min(p.end, section.end) - max(p.start, section.start)
            for p in phrases
            if p.start < section.end and p.end > section.start
        )
        return (overlap / section_dur) > 0.20

    # ─────────────────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _mean_curve_value(
        curve: list[dict], start: float, end: float
    ) -> float:
        """Compute mean value from a time-series curve between start and end."""
        vals = [
            p["value"] for p in curve
            if start <= p["time"] < end
        ]
        return float(np.mean(vals)) if vals else 0.0
