"""
Pytest tests for remix_director_adapter.py

Tests verify that each RemixDirectorParams field correctly overrides
the matching key in the returned pipeline_config dict.
"""

import pytest
from services.remix_director_adapter import (
    apply_director_params,
    build_default_pipeline_config,
)


# ── Helpers ───────────────────────────────────────────────────

def base() -> dict:
    return build_default_pipeline_config()


def apply(params: dict) -> dict:
    """Apply params to a fresh default config."""
    return apply_director_params(params, build_default_pipeline_config())


# ══════════════════════════════════════════════════════════════
class TestNullInput:

    def test_none_returns_default_config(self):
        cfg = apply_director_params(None)
        assert cfg == base()

    def test_empty_dict_returns_default_config(self):
        cfg = apply({})
        assert cfg == base()


# ══════════════════════════════════════════════════════════════
class TestEnergyProfile:

    @pytest.mark.parametrize("key,expected_curve,expected_complexity", [
        ("explosive",        "explosive",        0.9),
        ("high_energy",      "high_energy",      0.7),
        ("slow_build",       "slow_build",       0.4),
        ("dreamy",           "dreamy",           0.3),
        ("steady",           "steady",           0.5),
        ("medium_slow_rise", "medium_slow_rise", 0.5),
    ])
    def test_energy_maps_to_curve(self, key, expected_curve, expected_complexity):
        cfg = apply({"target_energy": key})
        assert cfg["composition"]["energy_curve"] == expected_curve
        assert cfg["composition"]["arrangement_complexity"] == expected_complexity

    def test_explosive_sets_explosive_finale(self):
        cfg = apply({"target_energy": "explosive"})
        assert cfg["composition"]["finale_intensity"] == "explosive"

    def test_dreamy_sets_fade_out_finale(self):
        cfg = apply({"target_energy": "dreamy"})
        assert cfg["composition"]["finale_intensity"] == "fade_out"


# ══════════════════════════════════════════════════════════════
class TestTempoAdjustment:

    def test_original_keeps_default_mode(self):
        cfg = apply({"tempo_adjustment": "original"})
        assert cfg["harmonic_matching"]["tempo_mode"] == "original"

    def test_slower_sets_stretch_factor(self):
        cfg = apply({"tempo_adjustment": "slower"})
        assert cfg["harmonic_matching"]["tempo_mode"] == "stretch"
        assert cfg["harmonic_matching"]["stretch_factor"] == pytest.approx(0.85)

    def test_faster_sets_stretch_factor(self):
        cfg = apply({"tempo_adjustment": "faster"})
        assert cfg["harmonic_matching"]["stretch_factor"] == pytest.approx(1.15)


# ══════════════════════════════════════════════════════════════
class TestVocalPriority:

    def test_track_a_sets_high_mix_ratio(self):
        cfg = apply({"vocal_priority": "track_a"})
        assert cfg["composition"]["vocal_mix_ratio"] == pytest.approx(0.85)
        assert cfg["stem_separation"]["vocal_boost_a"] == pytest.approx(1.2)

    def test_track_b_sets_low_mix_ratio(self):
        cfg = apply({"vocal_priority": "track_b"})
        assert cfg["composition"]["vocal_mix_ratio"] == pytest.approx(0.15)
        assert cfg["stem_separation"]["vocal_boost_b"] == pytest.approx(1.2)

    def test_instrumental_zeroes_vocal(self):
        cfg = apply({"vocal_priority": "instrumental"})
        assert cfg["composition"]["vocal_mix_ratio"] == pytest.approx(0.0)
        assert cfg["composition"]["instrumental_blend"] == pytest.approx(0.8)

    def test_balanced_is_default(self):
        cfg = apply({"vocal_priority": "balanced"})
        assert cfg["composition"]["vocal_mix_ratio"] == pytest.approx(0.5)


# ══════════════════════════════════════════════════════════════
class TestInstrumentOverlay:

    def test_piano_pads_overlay(self):
        cfg = apply({"instrument_overlay": "piano_pads"})
        assert cfg["style"]["instrument_overlay"] == "piano_pads"

    def test_null_overlay_not_applied(self):
        cfg = apply({"instrument_overlay": None})
        assert cfg["style"]["instrument_overlay"] is None

    def test_null_string_not_applied(self):
        cfg = apply({"instrument_overlay": "null"})
        # "null" string should not be passed through as a real overlay
        assert cfg["style"]["instrument_overlay"] != "null"


# ══════════════════════════════════════════════════════════════
class TestTransitionDensity:

    @pytest.mark.parametrize("density,expected_complexity", [
        ("minimal",    0.2),
        ("smooth",     0.4),
        ("dynamic",    0.7),
        ("aggressive", 0.9),
    ])
    def test_transition_sets_complexity(self, density, expected_complexity):
        cfg = apply({"transition_density": density})
        assert cfg["composition"]["transition_density"] == density
        # arrangement_complexity should be at least the transition value
        assert cfg["composition"]["arrangement_complexity"] >= expected_complexity


# ══════════════════════════════════════════════════════════════
class TestFinaleIntensity:

    def test_fade_out_sets_long_fade(self):
        cfg = apply({"finale_intensity": "fade_out"})
        assert cfg["rendering"]["fade_out_duration"] == pytest.approx(8.0)

    def test_explosive_sets_short_fade(self):
        cfg = apply({"finale_intensity": "explosive"})
        assert cfg["rendering"]["fade_out_duration"] == pytest.approx(1.5)
        assert cfg["mastering"]["ceiling_dbtp"] == pytest.approx(-0.3)

    def test_standard_is_default_fade(self):
        cfg = apply({"finale_intensity": "standard"})
        assert cfg["rendering"]["fade_out_duration"] == pytest.approx(4.0)


# ══════════════════════════════════════════════════════════════
class TestStyleProfile:

    def test_edm_festival_loud_mastering(self):
        cfg = apply({"style_profile": "edm_festival"})
        assert cfg["mastering"]["target_lufs"] == pytest.approx(-8.0)
        assert cfg["mastering"]["compression_intensity"] == pytest.approx(0.9)
        assert cfg["style"]["profile"] == "edm_festival"

    def test_chill_sunset_warm_mastering(self):
        cfg = apply({"style_profile": "chill_sunset"})
        assert cfg["mastering"]["target_lufs"] == pytest.approx(-18.0)
        assert cfg["mastering"]["warmth"] == pytest.approx(0.8)

    def test_deep_emotional_low_compression(self):
        cfg = apply({"style_profile": "deep_emotional"})
        assert cfg["mastering"]["compression_intensity"] == pytest.approx(0.4)


# ══════════════════════════════════════════════════════════════
class TestModernityLevel:

    def test_viral_adds_brightness(self):
        default_b = build_default_pipeline_config()["mastering"]["brightness"]
        cfg = apply({"style_profile": "auto", "modernity_level": "viral"})
        assert cfg["mastering"]["brightness"] > default_b

    def test_classic_reduces_brightness(self):
        default_b = build_default_pipeline_config()["mastering"]["brightness"]
        cfg = apply({"style_profile": "auto", "modernity_level": "classic"})
        assert cfg["mastering"]["brightness"] < default_b


# ══════════════════════════════════════════════════════════════
class TestSurpriseFactor:

    def test_surprise_factor_passed_through(self):
        cfg = apply({"surprise_factor": 0.75})
        assert cfg["composition"]["surprise_factor"] == pytest.approx(0.75)

    def test_surprise_factor_defaults_to_zero(self):
        cfg = apply({})
        assert cfg["composition"]["surprise_factor"] == pytest.approx(0.0)


# ══════════════════════════════════════════════════════════════
class TestUiSteps:

    def test_processing_steps_applied(self):
        steps = ["Step 1", "Step 2", "Step 3"]
        cfg = apply({"processing_steps": steps})
        assert cfg["ui_steps"] == steps

    def test_no_steps_keeps_default(self):
        cfg = apply({})
        assert isinstance(cfg["ui_steps"], list)
        assert len(cfg["ui_steps"]) > 0


# ══════════════════════════════════════════════════════════════
class TestFullCompoundParams:
    """Integration-style: realistic combined params from the TS interpreter."""

    def test_edm_compound(self):
        params = {
            "style_profile":       "edm_festival",
            "target_energy":       "explosive",
            "tempo_adjustment":    "slightly_faster",
            "vocal_priority":      "track_a",
            "instrument_overlay":  "synth_leads",
            "transition_density":  "aggressive",
            "finale_intensity":    "explosive",
            "modernity_level":     "viral",
            "surprise_factor":     0.2,
        }
        cfg = apply(params)
        assert cfg["composition"]["energy_curve"] == "explosive"
        assert cfg["composition"]["vocal_mix_ratio"] == pytest.approx(0.85)
        assert cfg["style"]["instrument_overlay"] == "synth_leads"
        assert cfg["mastering"]["target_lufs"] == pytest.approx(-8.0)
        assert cfg["composition"]["surprise_factor"] == pytest.approx(0.2)

    def test_chill_compound(self):
        params = {
            "style_profile":       "chill_sunset",
            "target_energy":       "dreamy",
            "tempo_adjustment":    "slower",
            "vocal_priority":      "balanced",
            "instrument_overlay":  "ambient_pads",
            "transition_density":  "minimal",
            "finale_intensity":    "fade_out",
            "modernity_level":     "classic",
            "surprise_factor":     0.0,
        }
        cfg = apply(params)
        assert cfg["composition"]["energy_curve"] == "dreamy"
        assert cfg["harmonic_matching"]["stretch_factor"] == pytest.approx(0.85)
        assert cfg["rendering"]["fade_out_duration"] == pytest.approx(8.0)
        assert cfg["mastering"]["warmth"] == pytest.approx(0.8)
