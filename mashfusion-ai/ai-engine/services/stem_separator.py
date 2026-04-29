"""Demucs 6-stem separation service."""

import os
import subprocess
from pathlib import Path
from loguru import logger
from config import get_settings

settings = get_settings()

STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"]


def _to_wav(input_path: str) -> str:
    """Convert any audio file to a plain 44100Hz stereo WAV using ffmpeg.
    Returns path to the (possibly new) WAV file."""
    p = Path(input_path)
    if p.suffix.lower() == ".wav":
        # Re-encode to ensure clean PCM — avoids torchaudio format issues
        out = p.with_suffix(".clean.wav")
    else:
        out = p.with_suffix(".wav")
    ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
    subprocess.run(
        [ffmpeg, "-y", "-i", str(p), "-ar", "44100", "-ac", "2", str(out)],
        capture_output=True, check=True
    )
    return str(out)


def separate_stems(input_path: str, output_dir: str) -> dict[str, str]:
    """
    Run Demucs htdemucs_6s on `input_path`.
    Returns dict mapping stem name → absolute file path.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    model = settings.demucs_model

    # Pre-convert to clean WAV so torchaudio/soundfile can read it directly
    wav_path = _to_wav(input_path)

    cmd = [
        "python3", "-m", "demucs",
        "--name", model,
        "--out", output_dir,
        wav_path,
    ]

    # Force torchaudio to use soundfile backend instead of torchcodec
    env = os.environ.copy()
    env["TORCHAUDIO_USE_BACKEND_DISPATCHER"] = "0"

    logger.info(f"Running Demucs: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, env=env)

    if result.returncode != 0:
        raise RuntimeError(f"Demucs failed:\n{result.stderr or result.stdout}")

    # Demucs writes: {output_dir}/{model}/{track_name}/drums.wav ...
    track_name  = Path(wav_path).stem
    stems_dir   = Path(output_dir) / model / track_name

    stems = {}
    for stem in STEM_NAMES:
        stem_path = stems_dir / f"{stem}.wav"
        if stem_path.exists():
            stems[stem] = str(stem_path)
        else:
            logger.warning(f"Stem {stem} not found at {stem_path}")

    if not stems:
        raise FileNotFoundError(f"No stems found in {stems_dir}")

    logger.info(f"Separation complete — {len(stems)} stems found")
    return stems
