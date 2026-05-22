"""
preset_loader.py — Loads, validates, and caches style preset JSON profiles.

Design rules:
  - No external I/O at import time (lazy-loaded on first access)
  - Full schema validation with explicit field fallbacks for forward-compat
  - Returns a PresetProfile dataclass with typed sub-configs
  - Never duplicates EQ/reverb logic from sound_modernizer.py — this is
    configuration loading only; DSP is in the individual engine modules.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from loguru import logger

# ------------------------------------------------------------------
# Absolute path to the presets directory (same package, /presets/)
# ------------------------------------------------------------------
_PRESETS_DIR = os.path.join(os.path.dirname(__file__), "presets")

_VALID_PRESET_IDS = {
    "festival_edm",
    "house_club",
    "deep_emotional",
    "radio_pop",
    "chill_electronic",
    "cinematic_epic",
    "tropical_sunset",
}

_ENERGY_PROFILES = {"aggressive", "groovy", "emotional", "clean", "chill", "cinematic", "warm"}


# ------------------------------------------------------------------
# Sub-config dataclasses (flat, all primitive types)
# ------------------------------------------------------------------

@dataclass
class EQConfig:
    sub_bass_shelf_hz: float = 60.0
    sub_bass_gain_db:  float = 1.0
    bass_shelf_hz:     float = 120.0
    bass_gain_db:      float = 2.0
    low_mid_cut_hz:    float = 350.0
    low_mid_cut_db:    float = -2.0
    presence_boost_hz: float = 2500.0
    presence_gain_db:  float = 1.5
    air_shelf_hz:      float = 10000.0
    air_gain_db:       float = 1.5
    high_cut_hz:       float = 18000.0


@dataclass
class CompressionConfig:
    threshold_db:   float = -20.0
    ratio:          float = 3.0
    attack_ms:      float = 8.0
    release_ms:     float = 120.0
    knee_db:        float = 4.0
    makeup_gain_db: float = 3.0


@dataclass
class MultibandConfig:
    low_band_hz:             List[float] = field(default_factory=lambda: [20, 200])
    low_band_ratio:          float = 2.5
    low_band_threshold_db:   float = -22.0
    mid_band_hz:             List[float] = field(default_factory=lambda: [200, 4000])
    mid_band_ratio:          float = 2.0
    mid_band_threshold_db:   float = -24.0
    high_band_hz:            List[float] = field(default_factory=lambda: [4000, 20000])
    high_band_ratio:         float = 1.8
    high_band_threshold_db:  float = -20.0


@dataclass
class StereoConfig:
    width:              float = 1.25
    bass_mono_below_hz: float = 120.0
    mid_side_balance:   float = 0.0


@dataclass
class SaturationConfig:
    drive:      float = 0.06
    mode:       str   = "tape"        # "tape" | "tube"
    harmonics:  str   = "even"        # "even" | "odd"


@dataclass
class ReverbConfig:
    size:          float = 0.35
    wet_db:        float = -14.0
    decay_s:       float = 1.5
    pre_delay_ms:  float = 15.0
    high_cut_hz:   float = 5000.0
    low_cut_hz:    float = 200.0


@dataclass
class SidechainConfig:
    enabled:           bool       = True
    kick_rate_bpm_sync: str       = "1/4"   # "1/4" | "1/8"
    depth:             float      = 0.45
    attack_ms:         float      = 3.0
    release_ms:        float      = 100.0
    target_stems:      List[str]  = field(default_factory=lambda: ["bass"])


@dataclass
class LayersConfig:
    kick_boost:              bool = False
    snare_roll_before_drops: bool = False
    riser_before_drops:      bool = False
    impact_at_drops:         bool = False
    white_noise_sweep:       bool = False
    pad_layer:               bool = False
    bass_layer:              str  = "none"   # "none" | "sub_punch" | "groove_pump" | etc.
    uplifter:                bool = False
    downlifter:              bool = False
    reverse_cymbal:          bool = False


@dataclass
class ArrangementRules:
    silence_before_drop_ms:   float = 0.0
    pre_drop_energy_cut_db:   float = 0.0
    drop_impact_boost_db:     float = 1.0
    breakdown_thin_db:        float = -3.0
    chorus_reinforcement_db:  float = 1.0


@dataclass
class TransientConfig:
    attack_shape: str   = "punchy"   # "punchy" | "soft" | "groove"
    attack_ms:    float = 4.0
    sustain_db:   float = 0.0


# ------------------------------------------------------------------
# Top-level preset profile
# ------------------------------------------------------------------

@dataclass
class PresetProfile:
    id:               str
    display_name:     str
    description:      str
    energy_profile:   str               # see _ENERGY_PROFILES
    target_lufs:      float
    limiter_ceiling_db: float

    eq:               EQConfig          = field(default_factory=EQConfig)
    compression:      CompressionConfig = field(default_factory=CompressionConfig)
    multiband:        MultibandConfig   = field(default_factory=MultibandConfig)
    stereo:           StereoConfig      = field(default_factory=StereoConfig)
    saturation:       SaturationConfig  = field(default_factory=SaturationConfig)
    reverb:           ReverbConfig      = field(default_factory=ReverbConfig)
    sidechain:        SidechainConfig   = field(default_factory=SidechainConfig)
    layers:           LayersConfig      = field(default_factory=LayersConfig)
    arrangement_rules: ArrangementRules = field(default_factory=ArrangementRules)
    transient:        TransientConfig   = field(default_factory=TransientConfig)


# ------------------------------------------------------------------
# Module-level LRU cache (dict, loaded on demand)
# ------------------------------------------------------------------
_cache: Dict[str, PresetProfile] = {}


def _safe(d: dict, key: str, default):
    """Return d[key] if present and not None, otherwise default."""
    v = d.get(key)
    return v if v is not None else default


def _parse_eq(raw: dict) -> EQConfig:
    d = EQConfig()
    d.sub_bass_shelf_hz = float(_safe(raw, "sub_bass_shelf_hz", d.sub_bass_shelf_hz))
    d.sub_bass_gain_db  = float(_safe(raw, "sub_bass_gain_db",  d.sub_bass_gain_db))
    d.bass_shelf_hz     = float(_safe(raw, "bass_shelf_hz",     d.bass_shelf_hz))
    d.bass_gain_db      = float(_safe(raw, "bass_gain_db",      d.bass_gain_db))
    d.low_mid_cut_hz    = float(_safe(raw, "low_mid_cut_hz",    d.low_mid_cut_hz))
    d.low_mid_cut_db    = float(_safe(raw, "low_mid_cut_db",    d.low_mid_cut_db))
    d.presence_boost_hz = float(_safe(raw, "presence_boost_hz", d.presence_boost_hz))
    d.presence_gain_db  = float(_safe(raw, "presence_gain_db",  d.presence_gain_db))
    d.air_shelf_hz      = float(_safe(raw, "air_shelf_hz",      d.air_shelf_hz))
    d.air_gain_db       = float(_safe(raw, "air_gain_db",       d.air_gain_db))
    d.high_cut_hz       = float(_safe(raw, "high_cut_hz",       d.high_cut_hz))
    return d


def _parse_compression(raw: dict) -> CompressionConfig:
    d = CompressionConfig()
    d.threshold_db   = float(_safe(raw, "threshold_db",   d.threshold_db))
    d.ratio          = float(_safe(raw, "ratio",          d.ratio))
    d.attack_ms      = float(_safe(raw, "attack_ms",      d.attack_ms))
    d.release_ms     = float(_safe(raw, "release_ms",     d.release_ms))
    d.knee_db        = float(_safe(raw, "knee_db",        d.knee_db))
    d.makeup_gain_db = float(_safe(raw, "makeup_gain_db", d.makeup_gain_db))
    return d


def _parse_multiband(raw: dict) -> MultibandConfig:
    d = MultibandConfig()
    d.low_band_hz            = list(_safe(raw, "low_band_hz",            d.low_band_hz))
    d.low_band_ratio         = float(_safe(raw, "low_band_ratio",         d.low_band_ratio))
    d.low_band_threshold_db  = float(_safe(raw, "low_band_threshold_db",  d.low_band_threshold_db))
    d.mid_band_hz            = list(_safe(raw, "mid_band_hz",            d.mid_band_hz))
    d.mid_band_ratio         = float(_safe(raw, "mid_band_ratio",         d.mid_band_ratio))
    d.mid_band_threshold_db  = float(_safe(raw, "mid_band_threshold_db",  d.mid_band_threshold_db))
    d.high_band_hz           = list(_safe(raw, "high_band_hz",           d.high_band_hz))
    d.high_band_ratio        = float(_safe(raw, "high_band_ratio",        d.high_band_ratio))
    d.high_band_threshold_db = float(_safe(raw, "high_band_threshold_db", d.high_band_threshold_db))
    return d


def _parse_stereo(raw: dict) -> StereoConfig:
    d = StereoConfig()
    d.width              = float(_safe(raw, "width",              d.width))
    d.bass_mono_below_hz = float(_safe(raw, "bass_mono_below_hz", d.bass_mono_below_hz))
    d.mid_side_balance   = float(_safe(raw, "mid_side_balance",   d.mid_side_balance))
    return d


def _parse_saturation(raw: dict) -> SaturationConfig:
    d = SaturationConfig()
    d.drive     = float(_safe(raw, "drive",     d.drive))
    d.mode      = str(_safe(raw, "mode",        d.mode))
    d.harmonics = str(_safe(raw, "harmonics",   d.harmonics))
    return d


def _parse_reverb(raw: dict) -> ReverbConfig:
    d = ReverbConfig()
    d.size         = float(_safe(raw, "size",         d.size))
    d.wet_db       = float(_safe(raw, "wet_db",       d.wet_db))
    d.decay_s      = float(_safe(raw, "decay_s",      d.decay_s))
    d.pre_delay_ms = float(_safe(raw, "pre_delay_ms", d.pre_delay_ms))
    d.high_cut_hz  = float(_safe(raw, "high_cut_hz",  d.high_cut_hz))
    d.low_cut_hz   = float(_safe(raw, "low_cut_hz",   d.low_cut_hz))
    return d


def _parse_sidechain(raw: dict) -> SidechainConfig:
    d = SidechainConfig()
    d.enabled            = bool(_safe(raw, "enabled",            d.enabled))
    d.kick_rate_bpm_sync = str(_safe(raw, "kick_rate_bpm_sync",  d.kick_rate_bpm_sync))
    d.depth              = float(_safe(raw, "depth",             d.depth))
    d.attack_ms          = float(_safe(raw, "attack_ms",         d.attack_ms))
    d.release_ms         = float(_safe(raw, "release_ms",        d.release_ms))
    raw_stems = _safe(raw, "target_stems", d.target_stems)
    d.target_stems = list(raw_stems) if raw_stems else []
    return d


def _parse_layers(raw: dict) -> LayersConfig:
    d = LayersConfig()
    d.kick_boost              = bool(_safe(raw, "kick_boost",              d.kick_boost))
    d.snare_roll_before_drops = bool(_safe(raw, "snare_roll_before_drops", d.snare_roll_before_drops))
    d.riser_before_drops      = bool(_safe(raw, "riser_before_drops",      d.riser_before_drops))
    d.impact_at_drops         = bool(_safe(raw, "impact_at_drops",         d.impact_at_drops))
    d.white_noise_sweep       = bool(_safe(raw, "white_noise_sweep",       d.white_noise_sweep))
    d.pad_layer               = bool(_safe(raw, "pad_layer",               d.pad_layer))
    d.bass_layer              = str(_safe(raw, "bass_layer",               d.bass_layer))
    d.uplifter                = bool(_safe(raw, "uplifter",                d.uplifter))
    d.downlifter              = bool(_safe(raw, "downlifter",              d.downlifter))
    d.reverse_cymbal          = bool(_safe(raw, "reverse_cymbal",          d.reverse_cymbal))
    return d


def _parse_arrangement_rules(raw: dict) -> ArrangementRules:
    d = ArrangementRules()
    d.silence_before_drop_ms  = float(_safe(raw, "silence_before_drop_ms",  d.silence_before_drop_ms))
    d.pre_drop_energy_cut_db  = float(_safe(raw, "pre_drop_energy_cut_db",  d.pre_drop_energy_cut_db))
    d.drop_impact_boost_db    = float(_safe(raw, "drop_impact_boost_db",    d.drop_impact_boost_db))
    d.breakdown_thin_db       = float(_safe(raw, "breakdown_thin_db",       d.breakdown_thin_db))
    d.chorus_reinforcement_db = float(_safe(raw, "chorus_reinforcement_db", d.chorus_reinforcement_db))
    return d


def _parse_transient(raw: dict) -> TransientConfig:
    d = TransientConfig()
    d.attack_shape = str(_safe(raw, "attack_shape", d.attack_shape))
    d.attack_ms    = float(_safe(raw, "attack_ms",  d.attack_ms))
    d.sustain_db   = float(_safe(raw, "sustain_db", d.sustain_db))
    return d


def _load_from_disk(preset_id: str) -> PresetProfile:
    path = os.path.join(_PRESETS_DIR, f"{preset_id}.json")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Preset file not found: {path}")
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)

    loaded_id = raw.get("id", preset_id)
    energy = raw.get("energy_profile", "clean")
    if energy not in _ENERGY_PROFILES:
        logger.warning(f"Preset '{preset_id}': unknown energy_profile '{energy}', defaulting to 'clean'")
        energy = "clean"

    return PresetProfile(
        id                 = loaded_id,
        display_name       = raw.get("display_name", loaded_id),
        description        = raw.get("description", ""),
        energy_profile     = energy,
        target_lufs        = float(raw.get("target_lufs", -12.0)),
        limiter_ceiling_db = float(raw.get("limiter_ceiling_db", -0.5)),
        eq                 = _parse_eq(raw.get("eq", {})),
        compression        = _parse_compression(raw.get("compression", {})),
        multiband          = _parse_multiband(raw.get("multiband", {})),
        stereo             = _parse_stereo(raw.get("stereo", {})),
        saturation         = _parse_saturation(raw.get("saturation", {})),
        reverb             = _parse_reverb(raw.get("reverb", {})),
        sidechain          = _parse_sidechain(raw.get("sidechain", {})),
        layers             = _parse_layers(raw.get("layers", {})),
        arrangement_rules  = _parse_arrangement_rules(raw.get("arrangement_rules", {})),
        transient          = _parse_transient(raw.get("transient", {})),
    )


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def load_preset(preset_id: str) -> PresetProfile:
    """
    Return the PresetProfile for the given preset ID.
    Results are cached in-process; first call reads from disk.

    Raises:
        ValueError  — unknown preset_id
        FileNotFoundError — JSON file missing from /presets/
    """
    if preset_id not in _VALID_PRESET_IDS:
        raise ValueError(
            f"Unknown preset '{preset_id}'. "
            f"Valid IDs: {sorted(_VALID_PRESET_IDS)}"
        )
    if preset_id not in _cache:
        logger.debug(f"Loading preset from disk: {preset_id}")
        _cache[preset_id] = _load_from_disk(preset_id)
    return _cache[preset_id]


def list_presets() -> List[str]:
    """Return all registered preset IDs in sorted order."""
    return sorted(_VALID_PRESET_IDS)


def clear_cache() -> None:
    """Flush the in-process preset cache (for testing)."""
    _cache.clear()
