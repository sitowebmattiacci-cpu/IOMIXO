"""
IOMIXO AI — TransitionFXEngine
================================
Stage 5: Automatic professional transition FX placement

At every segment boundary in the ArrangementTimeline, this engine
automatically inserts producer-grade transition effects:

  - RISER       : pitched noise sweep upward (approach a drop)
  - REVERSE_CYMBAL: reverse crash leading into a hit
  - IMPACT      : low-frequency thud at the drop moment
  - WHITE_NOISE_SWEEP: broadband filter sweep (open/close)
  - ECHO_TAIL   : trails the last vocal phrase into silence
  - REVERB_FREEZE: frozen reverb pad at a held note
  - TAPE_STOP   : deceleration effect (comedic/vintage breakdowns)
  - FILTER_SWEEP: low-pass or high-pass filter automation arc
  - SILENCE_CUT : clean hard cut (used before high-impact sections)
  - SNARE_ROLL  : 16th-note snare escalation before drops

FX placement logic:
  - incoming act energy delta determines FX intensity
  - high-energy transitions → RISER + IMPACT + REVERSE_CYMBAL
  - low-energy transitions  → ECHO_TAIL + FILTER_SWEEP + REVERB_FREEZE
  - breakdown entries       → TAPE_STOP or SILENCE_CUT
  - outro entries           → REVERB_FREEZE + ECHO_TAIL
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from loguru import logger

from .arrangement_builder import AudioSegment, ArrangementTimeline


# ─────────────────────────────────────────────────────────────────────────────
# FX TYPE CATALOG
# ─────────────────────────────────────────────────────────────────────────────

FX_TYPES = [
    "riser",
    "reverse_cymbal",
    "impact",
    "white_noise_sweep",
    "echo_tail",
    "reverb_freeze",
    "tape_stop",
    "filter_sweep",
    "silence_cut",
    "snare_roll",
]


@dataclass
class TransitionMarker:
    """
    A single transition FX instruction at a specific output timestamp.
    """
    transition_id: int
    position: float          # seconds in output mashup (when FX starts)
    duration: float          # seconds the FX occupies
    fx_chain: list[str]      # ordered list of FX types to apply
    intensity: float         # 0–1 (how intense the transition is)
    from_act: str
    to_act: str
    notes: str = ""

    # DSP parameters for each FX
    params: dict = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# TRANSITION LOGIC RULES
# ─────────────────────────────────────────────────────────────────────────────

# Transition type matrix based on (from_act, to_act)
# Defines the FX chain and approximate intensity
_TRANSITION_RULES: dict[tuple[str, str], dict] = {
    ("intro", "build"): {
        "fx": ["filter_sweep", "riser"],
        "intensity": 0.50,
        "duration": 3.0,
        "notes": "Open filter + rising pad to signal tension building",
    },
    ("build", "first_payoff"): {
        "fx": ["snare_roll", "riser", "reverse_cymbal", "impact"],
        "intensity": 0.95,
        "duration": 4.0,
        "notes": "Classic 4-beat snare roll + riser crash into first drop",
    },
    ("first_payoff", "emotional_rise"): {
        "fx": ["echo_tail", "reverb_freeze"],
        "intensity": 0.40,
        "duration": 2.5,
        "notes": "Echo the last note of the chorus into a reverb freeze pad",
    },
    ("emotional_rise", "climax"): {
        "fx": ["riser", "white_noise_sweep", "reverse_cymbal", "impact"],
        "intensity": 1.00,
        "duration": 4.5,
        "notes": "Maximum tension before the ultimate climax drop",
    },
    ("climax", "release"): {
        "fx": ["reverb_freeze", "echo_tail", "filter_sweep"],
        "intensity": 0.55,
        "duration": 3.0,
        "notes": "Fade climax energy with reverb tail and filter close",
    },
    ("release", "outro"): {
        "fx": ["reverb_freeze", "echo_tail"],
        "intensity": 0.30,
        "duration": 3.5,
        "notes": "Long reverb fade into outro silence",
    },
    # Default for any unrecognized transition
    ("*", "*"): {
        "fx": ["filter_sweep"],
        "intensity": 0.40,
        "duration": 2.0,
        "notes": "Generic filter sweep",
    },
}

# DSP parameters for each FX type
_FX_DEFAULT_PARAMS: dict[str, dict] = {
    "riser": {
        "start_freq_hz": 200,
        "end_freq_hz": 8000,
        "start_gain_db": -20,
        "end_gain_db": 0,
        "noise_type": "pink",         # pink/white
    },
    "reverse_cymbal": {
        "fade_in_ms": 200,
        "peak_gain_db": -3,
        "eq_high_shelf_hz": 6000,
    },
    "impact": {
        "transient_db": 0,
        "frequency_hz": 60,            # sub-bass thud
        "decay_ms": 120,
    },
    "white_noise_sweep": {
        "filter_type": "lowpass",      # lowpass / highpass / bandpass
        "start_cutoff_hz": 20000,
        "end_cutoff_hz": 500,
        "sweep_direction": "downward",
        "gain_db": -12,
    },
    "echo_tail": {
        "delay_ms": 375,               # 1/8 note at 80BPM, will be rescaled to target BPM
        "feedback": 0.45,
        "wet_dry_ratio": 0.60,
        "high_cut_hz": 8000,
    },
    "reverb_freeze": {
        "freeze_duration_ms": 2000,
        "wet_db": -6,
        "decay_s": 4.0,
        "pre_delay_ms": 20,
    },
    "tape_stop": {
        "deceleration_ms": 800,
        "pitch_drop_semitones": -12,
        "wow_flutter_hz": 2.0,
    },
    "filter_sweep": {
        "filter_type": "lowpass",
        "start_cutoff_hz": 200,
        "end_cutoff_hz": 18000,
        "sweep_direction": "upward",
        "resonance_q": 1.5,
    },
    "silence_cut": {
        "silence_duration_ms": 80,    # brief silence before the hit
    },
    "snare_roll": {
        "note_division": "16th",
        "start_velocity": 0.4,
        "end_velocity": 1.0,
        "roll_bars": 2,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# TRANSITION FX ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class TransitionFXEngine:
    """
    Automatically places transition FX markers at every act boundary
    in an ArrangementTimeline.

    Usage:
        fx_engine = TransitionFXEngine()
        markers = fx_engine.place_transitions(timeline, target_bpm=128.0)
    """

    def place_transitions(
        self,
        timeline: ArrangementTimeline,
        target_bpm: float | None = None,
    ) -> list[TransitionMarker]:
        """
        Scan the timeline segment boundaries and generate TransitionMarkers.
        Returns list sorted by position.
        """
        bpm = target_bpm or timeline.target_bpm
        segments = timeline.segments

        if len(segments) < 2:
            logger.warning("[TransitionFXEngine] Less than 2 segments — no transitions")
            return []

        markers: list[TransitionMarker] = []

        for i in range(len(segments) - 1):
            seg_current = segments[i]
            seg_next = segments[i + 1]

            from_act = seg_current.act
            to_act = seg_next.act

            rule = (
                _TRANSITION_RULES.get((from_act, to_act))
                or _TRANSITION_RULES.get(("*", "*"))
            )

            # Position: FX starts at the end of current segment minus FX duration
            fx_duration = rule["duration"]
            fx_position = seg_current.output_end - fx_duration

            # Snap to beat grid
            fx_position = self._snap_to_beat(fx_position, bpm)

            # Scale echo delay to target BPM
            params = self._build_fx_params(rule["fx"], bpm)

            # Energy delta between segments
            energy_delta = abs(seg_next.energy_target - seg_current.energy_target)

            marker = TransitionMarker(
                transition_id=i,
                position=round(fx_position, 3),
                duration=fx_duration,
                fx_chain=rule["fx"],
                intensity=round(
                    float(np.clip(rule["intensity"] * (0.7 + energy_delta * 0.3), 0, 1)),
                    3
                ),
                from_act=from_act,
                to_act=to_act,
                notes=rule.get("notes", ""),
                params=params,
            )
            markers.append(marker)
            logger.info(
                f"[TransitionFXEngine] [{from_act}→{to_act}] "
                f"at {fx_position:.1f}s: {' + '.join(rule['fx'])} "
                f"(intensity={marker.intensity:.2f})"
            )

        return sorted(markers, key=lambda m: m.position)

    # ─────────────────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────────────────

    def _snap_to_beat(self, time_s: float, bpm: float) -> float:
        """Snap a time value to the nearest 1/4-note beat grid."""
        if bpm <= 0:
            return time_s
        beat_dur = 60.0 / bpm
        snapped = round(time_s / beat_dur) * beat_dur
        return round(float(snapped), 4)

    def _build_fx_params(self, fx_chain: list[str], bpm: float) -> dict:
        """
        Build DSP parameters for each FX in the chain.
        Scales time-based parameters (delays, rolls) to the target BPM.
        """
        params = {}
        beat_ms = (60.0 / bpm) * 1000 if bpm > 0 else 468.75  # ms per beat

        for fx_name in fx_chain:
            base = dict(_FX_DEFAULT_PARAMS.get(fx_name, {}))

            # Scale BPM-dependent values
            if fx_name == "echo_tail":
                # Rescale delay to 1/8 note of target BPM
                base["delay_ms"] = round(beat_ms / 2, 1)

            if fx_name == "snare_roll":
                # 16th note = beat/4
                base["note_duration_ms"] = round(beat_ms / 4, 1)

            params[fx_name] = base

        return params

    def to_json(self, markers: list[TransitionMarker]) -> list[dict]:
        """Export markers as JSON-serializable list."""
        out = []
        for m in markers:
            out.append({
                "transition_id": m.transition_id,
                "position": m.position,
                "duration": m.duration,
                "fx_chain": m.fx_chain,
                "intensity": m.intensity,
                "from_act": m.from_act,
                "to_act": m.to_act,
                "notes": m.notes,
                "params": m.params,
            })
        return out
