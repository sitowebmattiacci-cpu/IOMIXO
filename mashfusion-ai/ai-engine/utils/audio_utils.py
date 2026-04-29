"""Shared audio utility functions."""

import subprocess
import soundfile as sf
from pathlib import Path


def export_preview_mp3(input_wav: str, output_mp3: str, bitrate: str = "192k") -> None:
    """Encode WAV → MP3 using ffmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-i", input_wav,
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        "-id3v2_version", "3",
        output_mp3,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg encoding failed:\n{result.stderr}")


def get_audio_info(path: str) -> dict:
    """Return sample_rate, duration, channels, format."""
    info = sf.info(path)
    return {
        "sample_rate": info.samplerate,
        "channels":    info.channels,
        "duration":    round(info.duration, 2),
        "format":      info.format,
        "subtype":     info.subtype,
    }


def normalize_peak(y, ceiling_linear: float = 0.891):
    """Peak normalize a numpy array."""
    import numpy as np
    peak = float(abs(y).max())
    if peak > 0:
        return y / peak * ceiling_linear
    return y
