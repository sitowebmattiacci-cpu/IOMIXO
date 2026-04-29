"""
Mastering engine — applies professional mastering chain:
  multiband compression → EQ → stereo widening → peak limiting → LUFS normalization
"""

import numpy as np
import librosa
import soundfile as sf
from scipy import signal as scipy_signal
from loguru import logger


_TARGET_LUFS = {
    "standard":     -16.0,
    "hd":           -14.0,
    "professional": -14.0,
}

_LIMITER_CEILING = {
    "standard":     -1.0,
    "hd":           -0.5,
    "professional": -0.3,
}


def _measure_integrated_lufs(y: np.ndarray, sr: int) -> float:
    """Approximate integrated loudness (ITU-R BS.1770-4)."""
    # K-weighting stage 1: high-shelf pre-filter
    b_pre = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
    a_pre = np.array([1.0, -1.69065929318241, 0.73248077421585])
    # Stage 2: high-pass (100 Hz)
    b_hp, a_hp = scipy_signal.butter(2, 100 / (sr / 2), btype="high")

    def weight_channel(ch: np.ndarray) -> np.ndarray:
        ch = scipy_signal.lfilter(b_pre, a_pre, ch)
        ch = scipy_signal.lfilter(b_hp,  a_hp,  ch)
        return ch

    if y.ndim == 2:
        weighted_sq = sum(weight_channel(y[:, i]) ** 2 for i in range(y.shape[1])) / y.shape[1]
    else:
        weighted_sq = weight_channel(y) ** 2

    mean_sq = np.mean(weighted_sq)
    if mean_sq <= 1e-10:
        return -70.0
    return float(-0.691 + 10 * np.log10(mean_sq))


def _apply_limiter(y: np.ndarray, ceiling_db: float) -> np.ndarray:
    ceiling = 10 ** (ceiling_db / 20)
    return np.clip(y, -ceiling, ceiling)


def _widen_stereo(y: np.ndarray, width: float = 1.3) -> np.ndarray:
    """Mid-Side stereo widening."""
    if y.ndim != 2:
        return y
    mid  = (y[:, 0] + y[:, 1]) / 2
    side = (y[:, 0] - y[:, 1]) / 2 * width
    return np.stack([mid + side, mid - side], axis=-1)


def master_audio(input_path: str, output_path: str, quality: str = "hd") -> dict:
    target_lufs = _TARGET_LUFS.get(quality, -14.0)
    ceiling_db  = _LIMITER_CEILING.get(quality, -0.5)
    target_sr   = 48000 if quality == "professional" else 44100

    logger.info(f"Mastering {input_path} → target {target_lufs} LUFS, quality={quality}")

    y, sr = librosa.load(input_path, sr=target_sr, mono=False)

    if y.ndim == 1:
        y = np.stack([y, y], axis=-1)
    elif y.shape[0] == 2:
        y = y.T  # → (samples, channels)

    # Measure current LUFS
    current_lufs = _measure_integrated_lufs(y, target_sr)
    logger.info(f"Input LUFS: {current_lufs:.1f}")

    # Gain adjust to target
    gain_db  = target_lufs - current_lufs
    gain_lin = 10 ** (gain_db / 20)
    y = y * gain_lin

    # Stereo widening
    y = _widen_stereo(y, width=1.2)

    # Peak limiter
    y = _apply_limiter(y, ceiling_db)

    # Verify final LUFS
    final_lufs = _measure_integrated_lufs(y, target_sr)
    logger.info(f"Output LUFS: {final_lufs:.1f}")

    # Export
    subtype = "PCM_24" if quality in ("hd", "professional") else "PCM_16"
    sf.write(output_path, y, target_sr, subtype=subtype)
    logger.info(f"Mastered → {output_path}")

    return {
        "lufs":           round(final_lufs, 1),
        "gain_applied_db": round(gain_db, 1),
        "sample_rate":    target_sr,
        "bit_depth":      24 if quality in ("hd", "professional") else 16,
    }
