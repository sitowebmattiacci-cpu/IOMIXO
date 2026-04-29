"""
Sound modernization presets — applies style-specific DSP treatment:
EQ curves, saturation, sidechain compression simulation, reverb.
"""

import numpy as np
import librosa
import soundfile as sf
from scipy import signal as scipy_signal
from loguru import logger


_PRESETS = {
    "edm_festival": {
        "high_shelf_gain_db":  4.0,
        "low_shelf_gain_db":   6.0,
        "mid_cut_hz":          500,
        "mid_cut_db":         -3.0,
        "saturation":          0.15,
        "reverb_ir_size":      1024,
    },
    "house_club": {
        "high_shelf_gain_db":  3.0,
        "low_shelf_gain_db":   5.0,
        "mid_cut_hz":          300,
        "mid_cut_db":         -2.0,
        "saturation":          0.08,
        "reverb_ir_size":      512,
    },
    "deep_emotional": {
        "high_shelf_gain_db": -1.0,
        "low_shelf_gain_db":   2.0,
        "mid_cut_hz":          800,
        "mid_cut_db":         -1.0,
        "saturation":          0.03,
        "reverb_ir_size":      4096,
    },
    "pop_radio": {
        "high_shelf_gain_db":  2.0,
        "low_shelf_gain_db":   1.0,
        "mid_cut_hz":          1000,
        "mid_cut_db":         -1.0,
        "saturation":          0.05,
        "reverb_ir_size":      256,
    },
    "cinematic": {
        "high_shelf_gain_db": -2.0,
        "low_shelf_gain_db":   3.0,
        "mid_cut_hz":          400,
        "mid_cut_db":         -2.0,
        "saturation":          0.02,
        "reverb_ir_size":      8192,
    },
    "chill_sunset": {
        "high_shelf_gain_db": -3.0,
        "low_shelf_gain_db":   1.0,
        "mid_cut_hz":          600,
        "mid_cut_db":          0.0,
        "saturation":          0.02,
        "reverb_ir_size":      2048,
    },
}


def _db_to_linear(db: float) -> float:
    return 10 ** (db / 20)


def _apply_shelf(y: np.ndarray, sr: int, freq: float, gain_db: float, high: bool) -> np.ndarray:
    """Simple first-order high/low shelf filter."""
    gain  = _db_to_linear(gain_db)
    if abs(gain_db) < 0.1:
        return y
    btype = "high" if high else "low"
    sos = scipy_signal.butter(1, freq / (sr / 2), btype=btype, output="sos")
    shelf = scipy_signal.sosfilt(sos, y)
    return y + shelf * (gain - 1.0)


def _apply_saturation(y: np.ndarray, drive: float) -> np.ndarray:
    """Soft-clip saturation."""
    if drive <= 0:
        return y
    y_driven = y * (1 + drive * 10)
    return np.tanh(y_driven) / (1 + drive)


def _apply_reverb(y: np.ndarray, ir_size: int) -> np.ndarray:
    """Naive convolution reverb with exponential decay IR."""
    if ir_size <= 0:
        return y
    ir = np.exp(-np.linspace(0, 10, ir_size)) * np.random.randn(ir_size) * 0.05
    reverbed = scipy_signal.fftconvolve(y, ir, mode="full")[: len(y)]
    return y * 0.85 + reverbed * 0.15


def apply_style_preset(input_path: str, output_path: str, preset_name: str) -> None:
    preset = _PRESETS.get(preset_name)
    if not preset:
        logger.warning(f"Unknown preset '{preset_name}' — copying through")
        import shutil
        shutil.copy(input_path, output_path)
        return

    logger.info(f"Applying preset: {preset_name}")
    y, sr = librosa.load(input_path, sr=44100, mono=False)

    # If stereo, process each channel
    if y.ndim == 2:
        channels = [y[0], y[1]]
    else:
        channels = [y, y]

    processed = []
    for ch in channels:
        ch = _apply_shelf(ch, sr, freq=100,  gain_db=preset["low_shelf_gain_db"],  high=False)
        ch = _apply_shelf(ch, sr, freq=8000, gain_db=preset["high_shelf_gain_db"], high=True)
        ch = _apply_saturation(ch, preset["saturation"])
        ch = _apply_reverb(ch, preset["reverb_ir_size"])
        processed.append(ch)

    stereo = np.stack(processed, axis=-1)
    peak = np.max(np.abs(stereo))
    if peak > 0:
        stereo = stereo / peak * 0.891

    sf.write(output_path, stereo, sr, subtype="PCM_24")
    logger.info(f"Preset applied → {output_path}")
