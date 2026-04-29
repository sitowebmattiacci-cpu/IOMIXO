"""
Harmonic matcher — computes the pitch-shift (semitones) and time-stretch ratio
needed to align Track B to Track A's key and tempo.
"""

_KEY_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _key_to_semitone(key_str: str) -> int:
    """Convert 'F# minor' → semitone index 6."""
    root = key_str.split()[0]
    return _KEY_ORDER.index(root) if root in _KEY_ORDER else 0


def compute_transform_plan(analysis_a: dict, analysis_b: dict) -> dict:
    """
    Returns:
      pitch_shift_semitones: how many semitones to shift track B to match A's key
      tempo_ratio:           stretch factor to align B's BPM to A's BPM
      target_bpm:            final mashup BPM (A's BPM or average)
      target_key:            Track A's key (reference)
    """
    bpm_a = float(analysis_a["bpm"])
    bpm_b = float(analysis_b["bpm"])

    # Use Track A as tempo reference; stretch B
    tempo_ratio = bpm_a / bpm_b if bpm_b > 0 else 1.0

    # Key shift: how many semitones to transpose B to match A
    semitone_a = _key_to_semitone(analysis_a.get("musical_key", "C major"))
    semitone_b = _key_to_semitone(analysis_b.get("musical_key", "C major"))

    diff = (semitone_a - semitone_b) % 12
    # Choose shortest path (max ±6 semitones)
    pitch_shift = diff if diff <= 6 else diff - 12

    return {
        "pitch_shift_semitones": pitch_shift,
        "tempo_ratio":           round(tempo_ratio, 4),
        "target_bpm":            round(bpm_a, 2),
        "target_key":            analysis_a.get("musical_key", "C major"),
    }
