"""
IOMIXO AI — ArrangementBuilder
================================
Stage 4: Second-by-second remix timeline generator

Takes the NarrativePlan from ArtisticDecisionEngine and builds a
precise ArrangementTimeline: an ordered list of AudioSegments that
describe exactly how the final audio should be assembled.

Each AudioSegment specifies:
  - start/end time in the output mashup
  - which source track + stem combination to use
  - gain levels for both tracks
  - crossfade durations at boundaries

The output is a machine-readable JSON-serializable timeline that the
audio render engine (mashup_composer.py) will execute.
"""

from __future__ import annotations

import json
import math
import numpy as np
from dataclasses import dataclass, asdict, field
from loguru import logger

from .deep_analyzer import SongMap, SectionBlock
from .artistic_decision_engine import NarrativePlan, ActAssignment, NARRATIVE_ACTS


def _snap_to_beat(t: float, beat_events: list) -> float:
    """Snap a time value to the nearest beat timestamp."""
    if not beat_events:
        return t
    times = [b.time for b in beat_events]
    idx = min(range(len(times)), key=lambda i: abs(times[i] - t))
    return times[idx]


def _quantize_to_bar(duration: float, bpm: float, beats_per_bar: int = 4) -> float:
    """Round a target duration to the nearest integer number of bars at given BPM."""
    if bpm <= 0:
        return duration
    bar_seconds = (60.0 / bpm) * beats_per_bar
    n_bars = max(1, round(duration / bar_seconds))
    return n_bars * bar_seconds


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class StemSelection:
    """
    Which stems from a given source track to include in a segment.
    """
    track: str              # "A" or "B"
    stems: list[str]        # e.g. ["vocals", "bass"], ["drums", "guitar", "piano", "other"]
    gain: float = 1.0       # linear gain multiplier (0–2)
    pitch_shift: int = 0    # semitones (applied by render engine)
    tempo_ratio: float = 1.0


@dataclass
class AudioSegment:
    """
    A single timed block in the mashup output.
    """
    segment_id: int
    act: str                    # narrative act this segment belongs to
    label: str                  # human description e.g. "A chorus vocals over B drums"

    output_start: float         # seconds in output mashup
    output_end: float           # seconds in output mashup
    duration: float             # seconds

    # Source positions (where to read from in the source tracks)
    source_a_start: float       # seconds in track A (loop if needed)
    source_b_start: float       # seconds in track B (loop if needed)

    # Stem selections
    layer_a: StemSelection | None = None
    layer_b: StemSelection | None = None

    # Transition handling
    fade_in: float = 0.0        # seconds of fade-in at start
    fade_out: float = 0.0       # seconds of fade-out at end
    crossfade_with_next: float = 0.0  # seconds of overlap with next segment

    # Metadata
    energy_target: float = 0.5
    is_hook: bool = False
    is_transition: bool = False
    notes: str = ""


@dataclass
class ArrangementTimeline:
    """
    Complete second-by-second mashup timeline.
    This is the final render blueprint.
    """
    total_duration: float
    target_bpm: float
    target_key: str
    pitch_shift_semitones: int
    tempo_ratio: float

    segments: list[AudioSegment] = field(default_factory=list)

    # JSON-ready render instructions
    def to_render_instructions(self) -> dict:
        """Export as JSON-serializable render instructions for the audio engine."""
        return {
            "total_duration": self.total_duration,
            "target_bpm": self.target_bpm,
            "target_key": self.target_key,
            "pitch_shift_semitones": self.pitch_shift_semitones,
            "tempo_ratio": self.tempo_ratio,
            "segments": [_segment_to_dict(s) for s in self.segments],
        }


def _segment_to_dict(seg: AudioSegment) -> dict:
    """Convert AudioSegment to JSON-safe dict."""
    return {
        "segment_id": seg.segment_id,
        "act": seg.act,
        "label": seg.label,
        "output_start": seg.output_start,
        "output_end": seg.output_end,
        "duration": seg.duration,
        "source_a_start": seg.source_a_start,
        "source_b_start": seg.source_b_start,
        "layer_a": {
            "track": seg.layer_a.track,
            "stems": seg.layer_a.stems,
            "gain": seg.layer_a.gain,
            "pitch_shift": seg.layer_a.pitch_shift,
            "tempo_ratio": seg.layer_a.tempo_ratio,
        } if seg.layer_a else None,
        "layer_b": {
            "track": seg.layer_b.track,
            "stems": seg.layer_b.stems,
            "gain": seg.layer_b.gain,
            "pitch_shift": seg.layer_b.pitch_shift,
            "tempo_ratio": seg.layer_b.tempo_ratio,
        } if seg.layer_b else None,
        "fade_in": seg.fade_in,
        "fade_out": seg.fade_out,
        "crossfade_with_next": seg.crossfade_with_next,
        "energy_target": seg.energy_target,
        "is_hook": seg.is_hook,
        "is_transition": seg.is_transition,
        "notes": seg.notes,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ARRANGEMENT BUILDER
# ─────────────────────────────────────────────────────────────────────────────

# Duration budget per act (seconds)
_ACT_DURATION: dict[str, float] = {
    "intro":          18.0,
    "build":          30.0,
    "first_payoff":   30.0,
    "emotional_rise": 24.0,
    "climax":         36.0,
    "release":        24.0,
    "outro":          18.0,
}

# Crossfade budget between acts (seconds)
_ACT_CROSSFADE: dict[str, float] = {
    "intro":          2.0,
    "build":          3.0,
    "first_payoff":   1.0,   # hard cut for impact
    "emotional_rise": 2.5,
    "climax":         1.0,   # hard cut for impact
    "release":        3.0,
    "outro":          4.0,
}

# Stem selection strategy per act
# (A_stems, A_gain, B_stems, B_gain)
_ACT_STEM_STRATEGY: dict[str, tuple[list[str], float, list[str], float]] = {
    "intro": (
        ["other"],             0.50,
        ["other", "piano"],    0.60,
    ),
    "build": (
        ["vocals", "bass"],    0.75,
        ["drums", "other"],    0.65,
    ),
    "first_payoff": (
        ["vocals", "bass"],    1.00,
        ["drums", "guitar"],   0.90,
    ),
    "emotional_rise": (
        ["vocals"],            0.85,
        ["piano", "other"],    0.70,
    ),
    "climax": (
        ["vocals", "bass"],    1.00,
        ["drums", "guitar", "piano", "other"], 0.85,
    ),
    "release": (
        ["vocals"],            0.75,
        ["piano", "other"],    0.60,
    ),
    "outro": (
        ["vocals", "other"],   0.50,
        ["other"],             0.40,
    ),
}


class ArrangementBuilder:
    """
    Builds the final second-by-second AudioSegment timeline from a NarrativePlan.

    Usage:
        builder = ArrangementBuilder()
        timeline = builder.build(
            plan=narrative_plan,
            map_a=song_map_a,
            map_b=song_map_b,
            transform={"pitch_shift_semitones": -2, "tempo_ratio": 1.05,
                       "target_bpm": 128.0, "target_key": "A minor"}
        )
        render_json = timeline.to_render_instructions()
    """

    def build(
        self,
        plan: NarrativePlan,
        map_a: SongMap,
        map_b: SongMap,
        transform: dict,
    ) -> ArrangementTimeline:
        """
        Construct the ArrangementTimeline from the NarrativePlan.
        """
        logger.info("[ArrangementBuilder] Building arrangement timeline")

        pitch_shift = transform.get("pitch_shift_semitones", 0)
        tempo_ratio = transform.get("tempo_ratio", 1.0)
        target_bpm = transform.get("target_bpm", map_a.bpm)
        target_key = transform.get("target_key", map_a.musical_key)

        segments: list[AudioSegment] = []
        cursor = 0.0   # current output time cursor in seconds
        seg_id = 0

        dominant = plan.dominant_track
        non_dominant = "B" if dominant == "A" else "A"
        map_dom = map_a if dominant == "A" else map_b
        map_sup = map_b if dominant == "A" else map_a

        for act_assignment in plan.narrative_acts:
            act = act_assignment.act
            raw_act_dur = _ACT_DURATION.get(act, 24.0)
            # Quantize duration to integer bars at target BPM → eliminates drift
            act_dur = _quantize_to_bar(raw_act_dur, target_bpm, beats_per_bar=4)
            crossfade = _ACT_CROSSFADE.get(act, 2.0)
            # Crossfade should also be bar-aligned (or at least beat-aligned)
            crossfade = min(crossfade, act_dur * 0.4)

            primary_sec = act_assignment.primary_section
            support_sec = act_assignment.support_section

            # ── Source positions in each track ───────────────────
            src_a_start = primary_sec.start if dominant == "A" else (
                support_sec.start if support_sec else 0.0
            )
            src_b_start = support_sec.start if dominant == "A" else primary_sec.start

            # Snap source positions to nearest beat in each track → no mid-beat starts
            src_a_start = _snap_to_beat(src_a_start, map_a.beat_events)
            src_b_start = _snap_to_beat(src_b_start, map_b.beat_events)

            # ── Stem selection ────────────────────────────────────
            a_stems, a_gain, b_stems, b_gain = _ACT_STEM_STRATEGY.get(
                act, (["vocals", "bass"], 0.80, ["drums", "other"], 0.75)
            )

            # If dominant is B, swap stem strategies
            if dominant == "B":
                a_stems, a_gain, b_stems, b_gain = b_stems, b_gain, a_stems, a_gain

            layer_a = StemSelection(
                track="A",
                stems=a_stems,
                gain=a_gain,
                pitch_shift=0,        # A is reference — no pitch shift
                tempo_ratio=1.0,
            )
            layer_b = StemSelection(
                track="B",
                stems=b_stems,
                gain=b_gain,
                pitch_shift=pitch_shift if dominant == "A" else 0,
                tempo_ratio=tempo_ratio if dominant == "A" else 1.0,
            )

            # ── Hook detection ────────────────────────────────────
            is_hook = round(cursor, 1) in [round(h, 1) for h in plan.hook_moments]

            # ── Fade in/out ───────────────────────────────────────
            fade_in = self._compute_fade_in(act, seg_id)
            fade_out = self._compute_fade_out(act, is_last=(seg_id == len(plan.narrative_acts) - 1))

            seg = AudioSegment(
                segment_id=seg_id,
                act=act,
                label=self._segment_label(act, primary_sec, support_sec, dominant),
                output_start=round(cursor, 3),
                output_end=round(cursor + act_dur, 3),
                duration=act_dur,
                source_a_start=round(src_a_start, 3),
                source_b_start=round(src_b_start, 3),
                layer_a=layer_a,
                layer_b=layer_b,
                fade_in=fade_in,
                fade_out=fade_out,
                crossfade_with_next=crossfade,
                energy_target=act_assignment.target_energy,
                is_hook=is_hook,
                is_transition=False,
                notes=act_assignment.notes,
            )
            segments.append(seg)

            # Advance cursor (overlap by crossfade amount)
            cursor += act_dur - crossfade
            seg_id += 1

        total_duration = segments[-1].output_end if segments else 0.0

        logger.info(
            f"[ArrangementBuilder] Timeline built — "
            f"{len(segments)} segments, {total_duration:.1f}s total"
        )

        timeline = ArrangementTimeline(
            total_duration=round(total_duration, 2),
            target_bpm=round(target_bpm, 2),
            target_key=target_key,
            pitch_shift_semitones=pitch_shift,
            tempo_ratio=round(tempo_ratio, 4),
            segments=segments,
        )

        self._log_timeline(timeline)
        return timeline

    # ─────────────────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────────────────

    def _compute_fade_in(self, act: str, seg_id: int) -> float:
        if seg_id == 0:
            return 3.0   # first segment always fades in
        return {
            "intro":          2.0,
            "build":          1.5,
            "first_payoff":   0.0,   # hard entry = impact
            "emotional_rise": 1.0,
            "climax":         0.0,   # hard cut
            "release":        1.5,
            "outro":          2.0,
        }.get(act, 1.0)

    def _compute_fade_out(self, act: str, is_last: bool) -> float:
        if is_last:
            return 5.0   # full outro fade
        return {
            "intro":          0.0,
            "build":          0.0,
            "first_payoff":   1.5,
            "emotional_rise": 0.0,
            "climax":         2.0,
            "release":        1.0,
            "outro":          5.0,
        }.get(act, 1.0)

    def _segment_label(
        self,
        act: str,
        primary: SectionBlock,
        support: SectionBlock | None,
        dominant: str,
    ) -> str:
        p_vocal = "vocals" if primary.is_vocal else "instr"
        p_lbl = primary.label
        s_lbl = support.label if support else "—"
        return (
            f"[{act.upper()}] Track{dominant} {p_vocal}/{p_lbl} "
            f"+ Track{'B' if dominant=='A' else 'A'} {s_lbl}"
        )

    def _log_timeline(self, timeline: ArrangementTimeline) -> None:
        """Log a compact readable timeline to the logger."""
        logger.info(
            f"[ArrangementBuilder] === ARRANGEMENT TIMELINE "
            f"({timeline.total_duration:.1f}s @ {timeline.target_bpm:.0f}BPM {timeline.target_key}) ==="
        )
        for seg in timeline.segments:
            hook_marker = " ★ HOOK" if seg.is_hook else ""
            logger.info(
                f"  [{seg.output_start:6.1f}s–{seg.output_end:6.1f}s] "
                f"{seg.act.upper():<18} {seg.label}{hook_marker}"
            )
