"""Multi-stage stem separation service."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
import soundfile as sf
from loguru import logger
from scipy import signal
import noisereduce as nr

from config import get_settings
from utils.audio_utils import normalize_peak

settings = get_settings()

STEM_NAMES_4 = ["drums", "bass", "other", "vocals"]


def _resolve_ffmpeg() -> str:
    """Locate an ffmpeg binary: env override → PATH → bundled imageio-ffmpeg."""
    override = os.environ.get("FFMPEG_PATH")
    if override and shutil.which(override):
        return override
    path_hit = shutil.which("ffmpeg")
    if path_hit:
        return path_hit
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _to_wav(input_path: str) -> str:
    """Convert any audio file to a plain 44100Hz stereo WAV using ffmpeg."""
    p = Path(input_path)
    if p.suffix.lower() == ".wav":
        out = p.with_suffix(".clean.wav")
    else:
        out = p.with_suffix(".wav")
    ffmpeg = _resolve_ffmpeg()
    subprocess.run(
        [ffmpeg, "-y", "-i", str(p), "-ar", "44100", "-ac", "2", str(out)],
        capture_output=True, check=True
    )
    return str(out)


def _pick_device(device: str) -> str:
    if device != "auto":
        return device
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _select_segment(duration: float | None, base_segment: float) -> int:
    if duration is None:
        return int(round(base_segment))
    if duration >= 900:
        return int(round(max(base_segment, 30.0)))
    if duration >= 600:
        return int(round(max(base_segment, 20.0)))
    if duration >= 300:
        return int(round(max(base_segment, 15.0)))
    return int(round(base_segment))


def _run_demucs(
    wav_path: str,
    output_dir: str,
    model: str,
    device: str,
    shifts: int,
    overlap: float,
    segment: float,
    two_stems: str | None = None,
) -> Path:
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable, "-m", "services._demucs_runner",
        "--name", model,
        "--device", device,
        "--shifts", str(shifts),
        "--overlap", str(overlap),
        "--segment", str(int(segment)),
        "--out", output_dir,
    ]
    if two_stems:
        cmd.extend(["--two-stems", two_stems])
    cmd.append(wav_path)

    env = os.environ.copy()
    env["TORCHAUDIO_USE_BACKEND_DISPATCHER"] = "0"
    if settings.models_dir:
        env.setdefault("DEMUCS_MODELS_DIR", settings.models_dir)

    logger.info(f"Running Demucs: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, env=env)
    if result.returncode != 0:
        raise RuntimeError(f"Demucs failed:\n{result.stderr or result.stdout}")

    track_name = Path(wav_path).stem
    return Path(output_dir) / model / track_name


def _collect_stems(stems_dir: Path, stem_names: Iterable[str]) -> dict[str, str]:
    stems: dict[str, str] = {}
    for stem in stem_names:
        stem_path = stems_dir / f"{stem}.flac"
        if stem_path.exists():
            stems[stem] = str(stem_path)
        else:
            logger.warning(f"Stem {stem} not found at {stem_path}")
    if not stems:
        raise FileNotFoundError(f"No stems found in {stems_dir}")
    return stems


def _butter_filter(data: np.ndarray, sr: int, cutoff: float, btype: str) -> np.ndarray:
    nyq = 0.5 * sr
    norm = max(1.0, min(cutoff, nyq - 1.0)) / nyq
    b, a = signal.butter(4, norm, btype=btype)
    return signal.lfilter(b, a, data, axis=0)


def _apply_denoise(data: np.ndarray, sr: int, strength: float) -> np.ndarray:
    if data.ndim == 1:
        return nr.reduce_noise(y=data, sr=sr, prop_decrease=strength)
    out = np.zeros_like(data)
    for ch in range(data.shape[1]):
        out[:, ch] = nr.reduce_noise(y=data[:, ch], sr=sr, prop_decrease=strength)
    return out


def _enhance_transients(data: np.ndarray, sr: int, amount: float) -> np.ndarray:
    low = _butter_filter(data, sr, 150.0, "low")
    trans = data - low
    return data + amount * trans


def _mono_below(data: np.ndarray, sr: int, cutoff: float) -> np.ndarray:
    if data.ndim == 1:
        return data
    low = _butter_filter(data, sr, cutoff, "low")
    mono_low = low.mean(axis=1, keepdims=True)
    mono_low = np.repeat(mono_low, data.shape[1], axis=1)
    return data - low + mono_low


def _process_vocals(data: np.ndarray, sr: int, refine: bool) -> np.ndarray:
    processed = _butter_filter(data, sr, 80.0, "high")
    processed = _apply_denoise(processed, sr, 0.35 if refine else 0.2)
    processed = _butter_filter(processed, sr, 14000.0, "low")
    return processed


def _process_drums(data: np.ndarray, sr: int) -> np.ndarray:
    processed = _butter_filter(data, sr, 35.0, "high")
    processed = _enhance_transients(processed, sr, 0.2)
    return processed


def _process_bass(data: np.ndarray, sr: int) -> np.ndarray:
    processed = _butter_filter(data, sr, 5000.0, "low")
    processed = _mono_below(processed, sr, 120.0)
    return processed


def _process_other(data: np.ndarray, sr: int) -> np.ndarray:
    processed = _butter_filter(data, sr, 40.0, "high")
    processed = _butter_filter(processed, sr, 16000.0, "low")
    return processed


def _load_audio(path: str) -> tuple[np.ndarray, int]:
    data, sr = sf.read(path, always_2d=True, dtype="float32")
    return data, int(sr)


def _write_audio(path: str, data: np.ndarray, sr: int) -> None:
    sf.write(path, data, sr, format="FLAC", subtype="PCM_16")


def _post_process(stems: dict[str, str], refine_vocals: bool, normalize: bool) -> None:
    for stem_name, stem_path in stems.items():
        if not Path(stem_path).exists():
            continue
        data, sr = _load_audio(stem_path)
        if stem_name == "vocals":
            data = _process_vocals(data, sr, refine_vocals)
        elif stem_name == "drums":
            data = _process_drums(data, sr)
        elif stem_name == "bass":
            data = _process_bass(data, sr)
        elif stem_name == "other":
            data = _process_other(data, sr)
        if normalize:
            data = normalize_peak(data)
        _write_audio(stem_path, data, sr)


def separate_stems(input_path: str, output_dir: str, config: dict | None = None) -> dict[str, str]:
    """Run multi-stage separation with optional quality controls."""
    cfg = config or {}
    quality = cfg.get("quality") or getattr(settings, "stem_separation_quality", "balanced")
    device = _pick_device(cfg.get("device", "auto"))
    demucs_model = cfg.get("demucs_model") or cfg.get("model") or settings.demucs_model
    mdx_model = cfg.get("mdx_model") or getattr(settings, "mdx_model", "mdx_extra_q")
    normalize = bool(cfg.get("normalize", True))

    if quality not in ("fast", "balanced", "high_quality"):
        quality = "balanced"

    base_shifts = cfg.get("demucs_shifts")
    if base_shifts is None:
        base_shifts = 0 if quality == "fast" else 1 if quality == "balanced" else 2
    base_overlap = cfg.get("demucs_overlap")
    if base_overlap is None:
        base_overlap = 0.25 if quality == "fast" else 0.5
    base_segment = cfg.get("demucs_segment")
    if base_segment is None:
        base_segment = 20.0 if quality == "fast" else 12.0 if quality == "balanced" else 8.0
    refine_vocals = quality == "high_quality"

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    wav_path = _to_wav(input_path)
    duration = None
    try:
        duration = float(sf.info(wav_path).duration)
    except Exception:
        pass
    segment = _select_segment(duration, float(base_segment))
    demucs_segment = cfg.get("demucs_segment")
    if demucs_segment is not None:
        demucs_segment = float(demucs_segment)
    else:
        demucs_segment = segment

    mdx_shifts = cfg.get("mdx_shifts", base_shifts)
    mdx_overlap = cfg.get("mdx_overlap", base_overlap)
    mdx_segment = _select_segment(duration, float(cfg.get("mdx_segment", base_segment)))

    stems: dict[str, str] = {}

    if quality == "fast":
        stems_dir = _run_demucs(
            wav_path,
            output_dir,
            demucs_model,
            device,
            shifts=base_shifts,
            overlap=base_overlap,
            segment=demucs_segment,
        )
        stems = _collect_stems(stems_dir, STEM_NAMES_4)
    else:
        mdx_dir = _run_demucs(
            wav_path,
            str(Path(output_dir) / "mdx"),
            mdx_model,
            device,
            shifts=int(mdx_shifts),
            overlap=float(mdx_overlap),
            segment=float(mdx_segment),
            two_stems="vocals",
        )
        mdx_stems = _collect_stems(mdx_dir, ["vocals", "no_vocals", "other"])
        vocals_path = mdx_stems.get("vocals")
        instrumental_path = mdx_stems.get("no_vocals") or mdx_stems.get("other")
        if not vocals_path or not instrumental_path:
            raise FileNotFoundError(f"MDX output missing vocals/instrumental in {mdx_dir}")

        demucs_dir = _run_demucs(
            instrumental_path,
            str(Path(output_dir) / "demucs"),
            demucs_model,
            device,
            shifts=base_shifts,
            overlap=base_overlap,
            segment=demucs_segment,
        )
        stems = _collect_stems(demucs_dir, ["drums", "bass", "other"])
        stems["vocals"] = vocals_path

    _post_process(stems, refine_vocals=refine_vocals, normalize=normalize)
    logger.info(f"Separation complete — {len(stems)} stems found")
    return stems
