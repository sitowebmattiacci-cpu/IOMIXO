"""Clip-level beat sync analysis.

Given a clip's source audio and project BPM, compute the metadata edits
that lock the clip's first musical beat to the project grid:

  - suggested_start_sec    : nearest grid line to the clip's current start
  - suggested_offset_sec   : trims pre-beat silence/attack inside the source
  - time_stretch_ratio     : project_bpm / clip_bpm (clamped 0.5..2.0)
  - fade_in_sec            : tiny click-killer when we cut at a transient
  - bpm / confidence       : detection results for UI feedback

Original audio is never modified — this only returns suggestions for the
arrangement document.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import librosa
import numpy as np
import requests
from loguru import logger

from utils.s3_utils import (
    SOUNDBANK_BUCKET,
    STEMS_BUCKET,
    USER_SAMPLES_BUCKET,
)

_SR = 44100
_BUCKET_BY_KIND = {
    "stem":        STEMS_BUCKET,
    "soundbank":   SOUNDBANK_BUCKET,
    "user_sample": USER_SAMPLES_BUCKET,
}

_GRID_BEATS = {"bar": 4.0, "beat": 1.0, "half": 0.5}


def _download_asset(asset_kind: str, asset_ref: str, cache_dir: Path) -> Path:
    bucket = _BUCKET_BY_KIND[asset_kind]
    local_path = cache_dir / f"{asset_kind}_{Path(asset_ref).name}"
    if local_path.exists():
        return local_path

    from utils.s3_utils import _STORAGE_URL, _HEADERS  # type: ignore
    url = f"{_STORAGE_URL}/object/{bucket}/{asset_ref}"
    resp = requests.get(url, headers=_HEADERS, stream=True, timeout=120)
    resp.raise_for_status()
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with open(local_path, "wb") as f:
        for chunk in resp.iter_content(8192):
            f.write(chunk)
    return local_path


def analyze_clip_for_sync(
    *,
    clip_id: str,
    asset_kind: str,
    asset_ref: str,
    project_bpm: float,
    grid: str,
    start_sec: float,
    end_sec: float,
    offset_sec: float,
    cache_dir: Path | None = None,
) -> dict:
    """Run librosa beat/onset analysis on the clip's source window.

    Returns a suggestion dict the frontend can apply to the arrangement.
    """
    if cache_dir is None:
        cache_dir = Path(tempfile.gettempdir()) / "iomixo_sync_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    region_len = max(0.5, end_sec - start_sec)
    # Load a window starting at the clip's current offset; cap to 20s
    # so analysis stays cheap on long source files.
    load_dur = float(min(region_len + 4.0, 20.0))

    local_path = _download_asset(asset_kind, asset_ref, cache_dir)
    try:
        y, sr = librosa.load(
            str(local_path),
            sr=_SR,
            mono=True,
            offset=max(0.0, float(offset_sec)),
            duration=load_dur,
        )
    except Exception as exc:
        logger.warning(f"[sync:{clip_id}] librosa.load failed: {exc}")
        return _empty_suggestion(clip_id, project_bpm, grid, start_sec, offset_sec)

    if y.size == 0 or float(np.max(np.abs(y))) < 1e-4:
        return _empty_suggestion(clip_id, project_bpm, grid, start_sec, offset_sec)

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_times = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, units="time"
    )

    try:
        tempo, beat_times = librosa.beat.beat_track(
            onset_envelope=onset_env, sr=sr, units="time"
        )
        tempo = float(np.atleast_1d(tempo)[0])
    except Exception:
        tempo, beat_times = 0.0, np.array([])

    clip_bpm: float | None = tempo if 50.0 <= tempo <= 220.0 else None

    if len(beat_times) > 0:
        first_beat = float(beat_times[0])
    elif len(onset_times) > 0:
        first_beat = float(onset_times[0])
    else:
        first_beat = 0.0

    confidence = _confidence_at(onset_env, first_beat, sr)

    # Snap the clip's start to the nearest grid line at the project tempo.
    grid_beats = _GRID_BEATS.get(grid, 1.0)
    step = (60.0 / max(project_bpm, 1e-6)) * grid_beats
    suggested_start_sec = round(start_sec / step) * step

    # Adjust offset so the first detected beat sits at the clip's start.
    suggested_offset_sec = max(0.0, float(offset_sec) + first_beat)

    if clip_bpm is not None and abs(clip_bpm - project_bpm) > 0.5:
        ratio = max(0.5, min(2.0, project_bpm / clip_bpm))
    else:
        ratio = 1.0

    on_transient = bool(
        len(onset_times) and float(min(abs(onset_times - first_beat))) < 0.03
    )
    fade_in_sec = 0.005 if on_transient and first_beat > 1e-3 else 0.0

    return {
        "clip_id":              clip_id,
        "bpm":                  clip_bpm,
        "confidence":           round(float(confidence), 4),
        "suggested_start_sec":  round(float(suggested_start_sec), 6),
        "suggested_offset_sec": round(float(suggested_offset_sec), 6),
        "time_stretch_ratio":   round(float(ratio), 6),
        "fade_in_sec":          round(float(fade_in_sec), 6),
    }


def _empty_suggestion(
    clip_id: str, project_bpm: float, grid: str, start_sec: float, offset_sec: float
) -> dict:
    grid_beats = _GRID_BEATS.get(grid, 1.0)
    step = (60.0 / max(project_bpm, 1e-6)) * grid_beats
    return {
        "clip_id":              clip_id,
        "bpm":                  None,
        "confidence":           0.0,
        "suggested_start_sec":  round(round(start_sec / step) * step, 6),
        "suggested_offset_sec": float(offset_sec),
        "time_stretch_ratio":   1.0,
        "fade_in_sec":          0.0,
    }


def _confidence_at(onset_env: np.ndarray, t_sec: float, sr: int) -> float:
    if onset_env.size == 0:
        return 0.0
    hop = 512  # librosa default
    frame = int(round(t_sec * sr / hop))
    frame = max(0, min(onset_env.size - 1, frame))
    peak = float(np.max(onset_env))
    if peak <= 1e-9:
        return 0.0
    return float(onset_env[frame] / peak)
