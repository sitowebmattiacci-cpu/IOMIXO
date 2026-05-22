"""Run demucs CLI but patch audio I/O to bypass torchcodec/ffmpeg.

Newer torchaudio routes load/save through torchcodec, which on local dev
machines without FFmpeg dylibs fails to load. We replace demucs's audio
loading + saving paths with soundfile-based equivalents so separation
works without FFmpeg/torchcodec installed.
"""
from __future__ import annotations

import sys

import numpy as np
import soundfile as sf
import torch
from demucs import audio as demucs_audio
from demucs import separate as demucs_separate


def _save_audio_soundfile(wav, path, samplerate, **_kwargs):
    arr = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
    if arr.ndim == 2 and arr.shape[0] in (1, 2):
        arr = arr.T
    # Save as FLAC (lossless, ~50% smaller than PCM WAV) so each stem stays
    # under Supabase's 50MB-per-object limit on the free plan. The pipeline
    # downstream reads the path back, so we rewrite the .wav extension to
    # .flac here — callers that glob for the stem look for .flac too.
    path_str = str(path)
    if path_str.endswith(".wav"):
        path_str = path_str[:-4] + ".flac"
    sf.write(path_str, arr, int(samplerate), format="FLAC", subtype="PCM_16")


def _load_track_soundfile(track, audio_channels, samplerate):
    data, sr = sf.read(str(track), always_2d=True, dtype="float32")
    # soundfile returns (frames, channels); demucs expects (channels, frames).
    wav = torch.from_numpy(data.T).contiguous()
    return demucs_audio.convert_audio(wav, sr, samplerate, audio_channels)


# Patch BOTH the source module and the names already imported into
# demucs.separate at module-load time.
demucs_audio.save_audio = _save_audio_soundfile
demucs_separate.save_audio = _save_audio_soundfile
demucs_separate.load_track = _load_track_soundfile


if __name__ == "__main__":
    demucs_separate.main(sys.argv[1:])
