"""
mastering_chain.py — Professional mastering chain extending mastering_engine.py.

This module wraps and extends the existing mastering_engine.master_audio() with:
  1. Multiband compression (3 bands: low <200Hz, mid 200-5kHz, high >5kHz)
  2. Parallel transient shaping (attack / sustain control per preset)
  3. Preset-aware LUFS targeting and ceiling
  4. Stereo bass-mono below configurable frequency (prevents sub phase issues)

The existing mastering_engine.master_audio() handles:
  - ITU-R BS.1770-4 LUFS measurement
  - Gain normalisation
  - Mid-Side stereo widening
  - Peak limiting

This chain runs BEFORE calling master_audio(), so results are:
  multiband_compress → transient_shape → bass_mono → master_audio()

Never duplicates the LUFS / K-weighting / limiter code already in mastering_engine.py.
"""

from __future__ import annotations

import numpy as np
import librosa
import soundfile as sf
from typing import Optional
from loguru import logger
from scipy import signal as scipy_signal

# Import the existing mastering engine (final LUFS + limiter stage)
from ..mastering_engine import master_audio as _base_master_audio

from .preset_loader import PresetProfile, MultibandConfig, StereoConfig, TransientConfig


_DEFAULT_SR = 44100


# ------------------------------------------------------------------
# Multiband compression
# ------------------------------------------------------------------

def _bandpass_signal(y: np.ndarray, lo: float, hi: float, sr: int) -> np.ndarray:
    nyq  = sr / 2.0
    lo_n = max(lo / nyq, 1e-4)
    hi_n = min(hi / nyq, 1.0 - 1e-4)
    sos  = scipy_signal.butter(4, [lo_n, hi_n], btype="band", output="sos")
    return scipy_signal.sosfiltfilt(sos, y).astype(np.float32)


def _lowpass_signal(y: np.ndarray, cutoff: float, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    sos = scipy_signal.butter(4, min(cutoff / nyq, 0.99), btype="low", output="sos")
    return scipy_signal.sosfiltfilt(sos, y).astype(np.float32)


def _highpass_signal(y: np.ndarray, cutoff: float, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    sos = scipy_signal.butter(4, max(cutoff / nyq, 1e-4), btype="high", output="sos")
    return scipy_signal.sosfiltfilt(sos, y).astype(np.float32)


def _compress_band(y: np.ndarray, sr: int,
                   threshold_db: float, ratio: float,
                   attack_ms: float = 5.0, release_ms: float = 80.0) -> np.ndarray:
    """
    Feedforward RMS compressor on a single channel.
    Returns gain-reduced float32 array.
    """
    # Smooth RMS envelope via two-pole low-pass
    rms_win = max(1, int(0.010 * sr))   # 10ms window
    sq      = y ** 2
    kernel  = np.ones(rms_win) / rms_win
    rms_env = np.sqrt(np.convolve(sq, kernel, mode="same")).astype(np.float64)

    eps            = 1e-9
    threshold_lin  = 10 ** (threshold_db / 20.0)
    atk_coeff      = np.exp(-1.0 / (attack_ms  / 1000.0 * sr))
    rel_coeff      = np.exp(-1.0 / (release_ms / 1000.0 * sr))

    gain_env = np.ones(len(y), dtype=np.float64)
    prev     = 1.0
    for i, r in enumerate(rms_env):
        if r > threshold_lin:
            target = threshold_lin * ((r / (threshold_lin + eps)) ** (1.0 / ratio))
            gc     = target / (r + eps)
        else:
            gc = 1.0
        coeff    = atk_coeff if gc < prev else rel_coeff
        prev     = coeff * prev + (1.0 - coeff) * gc
        gain_env[i] = prev

    return (y * gain_env.astype(np.float32)).astype(np.float32)


def _multiband_compress(y: np.ndarray, sr: int, cfg: MultibandConfig) -> np.ndarray:
    """
    3-band parallel compressor.
    Splits audio into 3 bands, compresses each, sums back.

    Works on (samples,) mono or (samples, channels) array.
    """
    def process_channel(ch: np.ndarray) -> np.ndarray:
        lo_f,  hi_f  = float(cfg.low_band_hz[1]),  200.0
        mid_lo, mid_hi = float(cfg.mid_band_hz[0]),  float(cfg.mid_band_hz[1])
        high_lo       = float(cfg.high_band_hz[0])

        band_low  = _lowpass_signal(ch, 200.0, sr)
        band_mid  = _bandpass_signal(ch, 200.0, 5000.0, sr)
        band_high = _highpass_signal(ch, 5000.0, sr)

        band_low  = _compress_band(band_low,  sr,
                                   cfg.low_band_threshold_db,  cfg.low_band_ratio)
        band_mid  = _compress_band(band_mid,  sr,
                                   cfg.mid_band_threshold_db,  cfg.mid_band_ratio)
        band_high = _compress_band(band_high, sr,
                                   cfg.high_band_threshold_db, cfg.high_band_ratio)

        return (band_low + band_mid + band_high).astype(np.float32)

    if y.ndim == 2:
        channels = [process_channel(y[:, i]) for i in range(y.shape[1])]
        return np.stack(channels, axis=-1)
    return process_channel(y)


# ------------------------------------------------------------------
# Transient shaping
# ------------------------------------------------------------------

def _transient_shape(y: np.ndarray, sr: int, cfg: TransientConfig) -> np.ndarray:
    """
    Parallel transient shaper: accentuates or softens attack transients.

    Algorithm:
      - Fast envelope follower (attack_ms) captures transient edge
      - Slow envelope follower (attack_ms * 20) captures sustain body
      - Transient signal = fast - slow
      - Shape: add/subtract transient component based on attack_shape
    """
    attack_s  = cfg.attack_ms / 1000.0
    sustain_db = cfg.sustain_db
    shape      = cfg.attack_shape   # "punchy" | "soft" | "groove"

    def shape_channel(ch: np.ndarray) -> np.ndarray:
        sr_f   = float(sr)
        fast_c = np.exp(-1.0 / (attack_s * sr_f))
        slow_c = np.exp(-1.0 / (attack_s * 20.0 * sr_f))

        abs_ch   = np.abs(ch).astype(np.float64)
        env_fast = np.zeros_like(abs_ch)
        env_slow = np.zeros_like(abs_ch)
        pf, ps   = 0.0, 0.0
        for i, x in enumerate(abs_ch):
            pf            = fast_c * pf + (1.0 - fast_c) * x
            ps            = slow_c * ps + (1.0 - slow_c) * x
            env_fast[i]   = pf
            env_slow[i]   = ps

        transient = (env_fast - env_slow).astype(np.float32)

        if shape == "punchy":
            # Boost transients, reduce sustain slightly
            boost    = np.clip(transient, 0, None)
            sust_lin = 10 ** (sustain_db / 20.0)
            return (ch * sust_lin + boost * 0.25).astype(np.float32)

        elif shape == "soft":
            # Reduce transients, boost sustain
            supp = np.clip(transient, 0, None) * 0.4
            return (ch - supp + ch * max(0.0, -sustain_db / 20.0) * 0.1).astype(np.float32)

        else:  # groove
            # Slight transient boost, neutral sustain
            boost = np.clip(transient, 0, None) * 0.15
            return (ch + boost).astype(np.float32)

    if y.ndim == 2:
        channels = [shape_channel(y[:, i]) for i in range(y.shape[1])]
        return np.stack(channels, axis=-1)
    return shape_channel(y)


# ------------------------------------------------------------------
# Bass mono below cutoff
# ------------------------------------------------------------------

def _bass_mono(y: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    """
    Apply mono below cutoff_hz to prevent sub-bass phase cancellation.
    Works only on stereo arrays.
    """
    if y.ndim != 2:
        return y
    nyq = sr / 2.0
    sos = scipy_signal.butter(4, min(cutoff_hz / nyq, 0.99), btype="low", output="sos")

    sub_l = scipy_signal.sosfiltfilt(sos, y[:, 0]).astype(np.float32)
    sub_r = scipy_signal.sosfiltfilt(sos, y[:, 1]).astype(np.float32)
    sub_mono = (sub_l + sub_r) / 2.0

    # Subtract sub from each channel and add mono sub
    out = y.copy().astype(np.float32)
    out[:, 0] = out[:, 0] - sub_l + sub_mono
    out[:, 1] = out[:, 1] - sub_r + sub_mono
    return out


# ------------------------------------------------------------------
# EQ from preset (extends the basic shelf EQ in sound_modernizer)
# ------------------------------------------------------------------

def _apply_eq_curve(y: np.ndarray, sr: int, preset: PresetProfile) -> np.ndarray:
    """
    Apply the 5-band EQ defined in preset.eq to an audio buffer.
    Operates per-channel on stereo, mono otherwise.
    """
    from scipy.signal import butter, sosfiltfilt

    eq = preset.eq

    def process_channel(ch: np.ndarray) -> np.ndarray:
        nyq = sr / 2.0

        # Sub-bass shelf (+/-)
        if abs(eq.sub_bass_gain_db) > 0.1:
            sos = butter(1, eq.sub_bass_shelf_hz / nyq, btype="low", output="sos")
            shelf = sosfiltfilt(sos, ch)
            ch = ch + shelf * (10 ** (eq.sub_bass_gain_db / 20.0) - 1.0)

        # Bass shelf
        if abs(eq.bass_gain_db) > 0.1:
            sos = butter(1, eq.bass_shelf_hz / nyq, btype="low", output="sos")
            shelf = sosfiltfilt(sos, ch)
            ch = ch + shelf * (10 ** (eq.bass_gain_db / 20.0) - 1.0)

        # Low-mid cut (peak notch approximation via bandpass subtraction)
        if abs(eq.low_mid_cut_db) > 0.1:
            lo = max(eq.low_mid_cut_hz * 0.7 / nyq, 1e-4)
            hi = min(eq.low_mid_cut_hz * 1.4 / nyq, 0.999)
            sos = butter(2, [lo, hi], btype="band", output="sos")
            band = sosfiltfilt(sos, ch)
            ch = ch + band * (10 ** (eq.low_mid_cut_db / 20.0) - 1.0)

        # Presence boost
        if abs(eq.presence_gain_db) > 0.1:
            lo = max(eq.presence_boost_hz * 0.7 / nyq, 1e-4)
            hi = min(eq.presence_boost_hz * 1.4 / nyq, 0.999)
            sos = butter(2, [lo, hi], btype="band", output="sos")
            band = sosfiltfilt(sos, ch)
            ch = ch + band * (10 ** (eq.presence_gain_db / 20.0) - 1.0)

        # Air shelf
        if abs(eq.air_gain_db) > 0.1:
            sos = butter(1, eq.air_shelf_hz / nyq, btype="high", output="sos")
            shelf = sosfiltfilt(sos, ch)
            ch = ch + shelf * (10 ** (eq.air_gain_db / 20.0) - 1.0)

        # Hard high cut
        if eq.high_cut_hz < (sr / 2 - 100):
            sos = butter(4, eq.high_cut_hz / nyq, btype="low", output="sos")
            ch  = sosfiltfilt(sos, ch).astype(np.float32)

        return ch.astype(np.float32)

    if y.ndim == 2:
        channels = [process_channel(y[:, i]) for i in range(y.shape[1])]
        return np.stack(channels, axis=-1)
    return process_channel(y)


# ------------------------------------------------------------------
# Saturation (extended from sound_modernizer, different modes)
# ------------------------------------------------------------------

def _apply_saturation(y: np.ndarray, drive: float, mode: str) -> np.ndarray:
    if drive <= 0:
        return y
    driven = y * (1 + drive * 12)
    if mode == "tube":
        # Asymmetric soft clip (odd harmonics)
        sat = np.arctan(driven) / (np.pi / 2)
    else:
        # Tape: symmetric soft clip (even harmonics)
        sat = np.tanh(driven) / (1 + drive * 0.5)
    # Blend: 70% saturated + 30% clean (parallel saturation)
    result = sat * 0.70 + y * 0.30
    return result.astype(np.float32)


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------

def apply_mastering_chain(
    input_path:  str,
    output_path: str,
    preset:      PresetProfile,
    quality:     str = "hd",
) -> dict:
    """
    Full mastering chain for a rendered mashup, using preset settings.

    Chain:
      1. Load audio at target SR
      2. Apply 5-band EQ (preset.eq)
      3. Saturation (preset.saturation)
      4. Multiband compression (preset.multiband)
      5. Transient shaping (preset.transient)
      6. Bass mono below preset.stereo.bass_mono_below_hz
      7. Call mastering_engine.master_audio() — LUFS normalization + M/S widening + limiter

    Args:
        input_path:  Path to rendered mashup WAV.
        output_path: Path to write the mastered WAV.
        preset:      Full PresetProfile with EQ / compression / transient config.
        quality:     "standard" | "hd" | "professional" (passed to master_audio).

    Returns:
        dict with chain metadata + mastering_engine metadata merged.
    """
    target_sr = 48000 if quality == "professional" else 44100
    logger.info(
        f"MasteringChain: loading {input_path} "
        f"(preset={preset.id}, quality={quality})"
    )

    y, sr = librosa.load(input_path, sr=target_sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y], axis=-1)
    elif y.shape[0] == 2:
        y = y.T   # → (samples, channels)

    logger.info(f"MasteringChain: audio loaded — {y.shape[0]} samples @ {sr}Hz")

    # --- Stage 1: EQ
    y = _apply_eq_curve(y, sr, preset)
    logger.debug("MasteringChain: EQ applied")

    # --- Stage 2: Saturation
    sat_cfg = preset.saturation
    if sat_cfg.drive > 0:
        if y.ndim == 2:
            for i in range(y.shape[1]):
                y[:, i] = _apply_saturation(y[:, i], sat_cfg.drive, sat_cfg.mode)
        else:
            y = _apply_saturation(y, sat_cfg.drive, sat_cfg.mode)
    logger.debug("MasteringChain: saturation applied")

    # --- Stage 3: Multiband compression
    y = _multiband_compress(y, sr, preset.multiband)
    logger.debug("MasteringChain: multiband compression applied")

    # --- Stage 4: Transient shaping
    y = _transient_shape(y, sr, preset.transient)
    logger.debug("MasteringChain: transient shaping applied")

    # --- Stage 5: Bass mono
    y = _bass_mono(y, sr, preset.stereo.bass_mono_below_hz)
    logger.debug("MasteringChain: bass mono applied")

    # --- Pre-master normalise to -3 dBFS (headroom for master_audio)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-9:
        y = y / peak * 0.708   # -3 dBFS headroom

    # --- Write intermediate WAV for master_audio
    import tempfile, os
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(tmp_fd)
    try:
        sf.write(tmp_path, y, sr, subtype="PCM_24")
        # --- Stage 6: LUFS normalisation + stereo widening + limiter
        mastering_meta = _base_master_audio(tmp_path, output_path, quality=quality)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    logger.info(f"MasteringChain: complete → {output_path}")
    return {
        "preset_id":     preset.id,
        "target_lufs":   preset.target_lufs,
        "quality":       quality,
        "mastering":     mastering_meta,
        "chain_stages":  ["eq", "saturation", "multiband_compress",
                          "transient_shape", "bass_mono",
                          "lufs_normalize", "ms_widening", "peak_limiter"],
    }
