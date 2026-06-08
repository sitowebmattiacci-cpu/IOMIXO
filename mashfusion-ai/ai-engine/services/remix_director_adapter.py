"""
MASHFUSION AI — Remix Director Adapter
=======================================
Takes the RemixDirectorParams dict (produced by the backend TypeScript
interpreter) and translates each field into concrete pipeline configuration
overrides that are passed to each processing stage.

Usage:
    from services.remix_director_adapter import apply_director_params

    pipeline_config = build_default_config()
    pipeline_config = apply_director_params(director_params, pipeline_config)
    # then pass pipeline_config to each stage
"""

from __future__ import annotations
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ── Default config shape (mirrors what tasks.py builds) ───────────────────────
def build_default_pipeline_config() -> dict[str, Any]:
    return {
        # ── Stem separation ───────────────────────────────────────
        "stem_separation": {
            "model": "htdemucs",
            "device": "auto",        # "cuda" | "cpu" | "auto"
            "vocal_boost_a": 1.0,    # scale factor applied to track-A vocals
            "vocal_boost_b": 1.0,    # scale factor applied to track-B vocals
        },
        # ── Harmonic matching ─────────────────────────────────────
        "harmonic_matching": {
            "tempo_mode": "original",     # "original" | "match_a" | "match_b" | "target_bpm"
            "target_bpm": None,
            "stretch_quality": "high",    # "fast" | "high"
        },
        # ── Composition ───────────────────────────────────────────
        "composition": {
            "vocal_mix_ratio": 0.5,       # 0.0 = all track-B, 1.0 = all track-A
            "instrumental_blend": 0.5,
            "energy_curve": "steady",     # matches EnergyProfile
            "transition_density": "smooth",
            "finale_intensity": "standard",
            "arrangement_complexity": 0.5, # 0–1
            "surprise_factor": 0.0,        # 0–1; drives random arrangement decisions
        },
        # ── Style / sound modernisation ───────────────────────────
        "style": {
            "profile": "auto",
            "instrument_overlay": None,   # e.g. "piano_pads" | None
            "modernity_level": "modern",
        },
        # ── Mastering ─────────────────────────────────────────────
        "mastering": {
            "target_lufs": -14.0,
            "ceiling_dbtp": -1.0,
            "warmth": 0.5,             # 0 = clinical, 1 = warm/vintage
            "brightness": 0.5,
            "compression_intensity": 0.5,
        },
        # ── Rendering ─────────────────────────────────────────────
        "rendering": {
            "fade_out_duration": 4.0,   # seconds
            "fade_in_duration":  0.5,
        },
        # ── Processing status messages ────────────────────────────
        "ui_steps": [
            "Interpreting your remix vision…",
            "Designing energy curve…",
            "Selecting vocal dominance…",
            "Injecting requested atmosphere…",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════════
# MAPPING TABLES
# ══════════════════════════════════════════════════════════════════════════════

# target_energy → (energy_curve_name, composition_complexity, finale_preset)
_ENERGY_MAP: dict[str, tuple[str, float, str]] = {
    "slow_build":       ("slow_build",        0.4, "high"),
    "medium_slow_rise": ("medium_slow_rise",   0.5, "high"),
    "steady":           ("steady",             0.5, "standard"),
    "high_energy":      ("high_energy",        0.7, "high"),
    "explosive":        ("explosive",          0.9, "explosive"),
    "dreamy":           ("dreamy",             0.3, "fade_out"),
}

# tempo_adjustment → harmonic_matching.tempo_mode + optional BPM offset pct
_TEMPO_MAP: dict[str, dict[str, Any]] = {
    "slower":           {"tempo_mode": "stretch", "stretch_factor": 0.85},
    "slightly_slower":  {"tempo_mode": "stretch", "stretch_factor": 0.93},
    "original":         {"tempo_mode": "original"},
    "slightly_faster":  {"tempo_mode": "stretch", "stretch_factor": 1.07},
    "faster":           {"tempo_mode": "stretch", "stretch_factor": 1.15},
}

# vocal_priority → (vocal_mix_ratio, instrumental_blend)
_VOCAL_MAP: dict[str, tuple[float, float]] = {
    "track_a":     (0.85, 0.5),
    "track_b":     (0.15, 0.5),
    "balanced":    (0.50, 0.5),
    "instrumental":(0.00, 0.8),
}

# style_profile → (warmth, brightness, target_lufs, compression_intensity)
_STYLE_MASTERING: dict[str, tuple[float, float, float, float]] = {
    "edm_festival":   (0.2, 0.9, -8.0,  0.9),
    "house_club":     (0.3, 0.8, -9.0,  0.8),
    "deep_emotional": (0.7, 0.3, -16.0, 0.4),
    "pop_radio":      (0.5, 0.7, -10.0, 0.7),
    "cinematic":      (0.6, 0.5, -14.0, 0.5),
    "chill_sunset":   (0.8, 0.3, -18.0, 0.3),
    "viral_modern":   (0.3, 0.8, -9.0,  0.8),
    "auto":           (0.5, 0.5, -14.0, 0.5),
}

# transition_density → arrangement_complexity
_TRANSITION_COMPLEXITY: dict[str, float] = {
    "minimal":    0.2,
    "smooth":     0.4,
    "dynamic":    0.7,
    "aggressive": 0.9,
}

# finale_intensity → mastering ceiling boost + fade_out_duration
_FINALE_MAP: dict[str, tuple[float, float]] = {
    "fade_out":  (-1.0, 8.0),
    "standard":  (-1.0, 4.0),
    "high":      (-0.5, 2.0),
    "explosive": (-0.3, 1.5),
}

# modernity_level → brightness boost offset
_MODERNITY_BRIGHTNESS: dict[str, float] = {
    "classic":      -0.15,
    "modern":        0.0,
    "cutting_edge":  0.10,
    "viral":         0.20,
}


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PUBLIC FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def apply_director_params(
    params: dict[str, Any] | None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Apply RemixDirectorParams to a pipeline config dict.

    Args:
        params: The RemixDirectorParams dict from the job payload.
                If None or empty, returns the default config unchanged.
        config: Existing pipeline config to merge into.
                If None, a fresh default config is created.

    Returns:
        A fully populated pipeline config dict.
    """
    if config is None:
        config = build_default_pipeline_config()

    if not params:
        return config

    # Shallow copies so we don't mutate defaults
    comp      = dict(config["composition"])
    style     = dict(config["style"])
    mastering = dict(config["mastering"])
    harmonic  = dict(config["harmonic_matching"])
    rendering = dict(config["rendering"])
    stems     = dict(config["stem_separation"])

    # ── Energy profile ────────────────────────────────────────
    energy_key = params.get("target_energy", "steady")
    if energy_key in _ENERGY_MAP:
        curve, complexity, finale = _ENERGY_MAP[energy_key]
        comp["energy_curve"]            = curve
        comp["arrangement_complexity"]  = complexity
        comp["finale_intensity"]        = finale

    # ── Tempo ─────────────────────────────────────────────────
    tempo_key = params.get("tempo_adjustment", "original")
    if tempo_key in _TEMPO_MAP:
        for k, v in _TEMPO_MAP[tempo_key].items():
            harmonic[k] = v

    # ── Vocal priority ────────────────────────────────────────
    vocal_key = params.get("vocal_priority", "balanced")
    if vocal_key in _VOCAL_MAP:
        mix, instr = _VOCAL_MAP[vocal_key]
        comp["vocal_mix_ratio"]     = mix
        comp["instrumental_blend"]  = instr
        # Boost the winning track's vocal extraction
        if vocal_key == "track_a":
            stems["vocal_boost_a"] = 1.2
        elif vocal_key == "track_b":
            stems["vocal_boost_b"] = 1.2

    # ── Instrument overlay ────────────────────────────────────
    overlay = params.get("instrument_overlay")
    if overlay and overlay != "null":
        style["instrument_overlay"] = overlay

    # ── Transition density ────────────────────────────────────
    trans_key = params.get("transition_density")
    if trans_key and trans_key in _TRANSITION_COMPLEXITY:
        comp["transition_density"]      = trans_key
        comp["arrangement_complexity"]  = max(
            comp.get("arrangement_complexity", 0.5),
            _TRANSITION_COMPLEXITY[trans_key]
        )

    # ── Finale intensity ──────────────────────────────────────
    finale_key = params.get("finale_intensity")
    if finale_key and finale_key in _FINALE_MAP:
        ceiling, fade = _FINALE_MAP[finale_key]
        mastering["ceiling_dbtp"]       = ceiling
        rendering["fade_out_duration"]  = fade
        comp["finale_intensity"]        = finale_key

    # ── Style profile → mastering preset ─────────────────────
    style_key = params.get("style_profile", "auto")
    style["profile"] = style_key
    if style_key in _STYLE_MASTERING:
        warmth, brightness, lufs, comp_intensity = _STYLE_MASTERING[style_key]
        mastering["warmth"]                 = warmth
        mastering["brightness"]             = brightness
        mastering["target_lufs"]            = lufs
        mastering["compression_intensity"]  = comp_intensity

    # ── Modernity offset ──────────────────────────────────────
    mod_key = params.get("modernity_level", "modern")
    style["modernity_level"] = mod_key
    mastering["brightness"]  = round(
        float(mastering.get("brightness", 0.5)) + _MODERNITY_BRIGHTNESS.get(mod_key, 0.0),
        3,
    )

    # ── Surprise factor ───────────────────────────────────────
    comp["surprise_factor"] = float(params.get("surprise_factor", 0.0))

    # ── UI processing steps (passed to SSE progress messages) ─
    ui_steps = params.get("processing_steps")
    if ui_steps:
        config["ui_steps"] = ui_steps

    # Reassemble
    config["composition"]       = comp
    config["style"]             = style
    config["mastering"]         = mastering
    config["harmonic_matching"] = harmonic
    config["rendering"]         = rendering
    config["stem_separation"]   = stems

    logger.info(
        "RemixDirector adapter applied: style=%s energy=%s vocal=%s transitions=%s",
        style_key, energy_key, vocal_key, trans_key,
    )
    return config
