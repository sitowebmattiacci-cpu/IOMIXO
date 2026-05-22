"""Render-from-arrangement engine — Phase 1 of the workstation pivot.

Takes an arrangement JSON document and produces a final mastered WAV +
preview MP3, uploading both to the generated-outputs bucket. This is the
*user-driven* render path — it replaces the autonomous SmartCompositionStage
output for the new product. The autonomous pipeline now produces an
arrangement (Phase 2), and this renderer is what turns user-edited
arrangements into final audio.

The renderer reuses existing primitives:
  - librosa for load/pitch/stretch (matches mashup_composer conventions)
  - soundfile for WAV write
  - services.mastering_engine.master_audio for the mastering pass
  - utils.audio_utils.export_preview_mp3 for MP3 export
  - utils.s3_utils for storage
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf
from loguru import logger

from schemas.arrangement import Arrangement, Clip, Track
from services.mastering_engine import master_audio
from utils.audio_utils import export_preview_mp3, get_audio_info
from utils.s3_utils import (
    SOUNDBANK_BUCKET,
    STEMS_BUCKET,
    USER_SAMPLES_BUCKET,
    download_from_storage,
    get_signed_download_url,
    upload_to_storage,
)

SR = 44100  # all audio resampled to 44.1k stereo at render time

_BUCKET_BY_KIND = {
    "stem":        STEMS_BUCKET,
    "soundbank":   SOUNDBANK_BUCKET,
    "user_sample": USER_SAMPLES_BUCKET,
}


def _load_clip_asset(clip: Clip, cache_dir: Path, asset_cache: dict[str, np.ndarray]) -> np.ndarray:
    """Download (cached) and decode an asset to a stereo float32 array @ SR."""
    cache_key = f"{clip.asset_kind}:{clip.asset_ref}"
    if cache_key in asset_cache:
        return asset_cache[cache_key]

    bucket = _BUCKET_BY_KIND[clip.asset_kind]
    local_path = cache_dir / f"{clip.asset_kind}_{Path(clip.asset_ref).name}"
    if not local_path.exists():
        # download_from_storage is hard-coded to the uploads bucket; emulate
        # against any bucket using upload_to_storage's REST client.
        from utils.s3_utils import _STORAGE_URL, _HEADERS  # type: ignore
        import requests
        url = f"{_STORAGE_URL}/object/{bucket}/{clip.asset_ref}"
        resp = requests.get(url, headers=_HEADERS, stream=True, timeout=120)
        resp.raise_for_status()
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with open(local_path, "wb") as f:
            for chunk in resp.iter_content(8192):
                f.write(chunk)

    y, _ = librosa.load(str(local_path), sr=SR, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    asset_cache[cache_key] = y.astype(np.float32, copy=False)
    return asset_cache[cache_key]


def _apply_clip_transforms(y: np.ndarray, clip: Clip) -> np.ndarray:
    """Trim by offset, then pitch-shift, time-stretch, fade, gain."""
    region_len_sec = max(0.0, clip.end_sec - clip.start_sec)
    start_sample = int(clip.offset_sec * SR)
    end_sample = start_sample + int(region_len_sec * SR)
    y = y[:, start_sample:end_sample]

    if y.shape[1] == 0:
        return np.zeros((2, 1), dtype=np.float32)

    if abs(clip.pitch_semitones) > 1e-3:
        y = np.stack([
            librosa.effects.pitch_shift(y[0], sr=SR, n_steps=clip.pitch_semitones),
            librosa.effects.pitch_shift(y[1], sr=SR, n_steps=clip.pitch_semitones),
        ])

    if abs(clip.time_stretch_ratio - 1.0) > 1e-3 and clip.time_stretch_ratio > 0:
        y = np.stack([
            librosa.effects.time_stretch(y[0], rate=clip.time_stretch_ratio),
            librosa.effects.time_stretch(y[1], rate=clip.time_stretch_ratio),
        ])

    n = y.shape[1]
    fi = min(int(clip.fade_in_sec * SR), n)
    fo = min(int(clip.fade_out_sec * SR), n)
    if fi > 0:
        ramp = np.linspace(0.0, 1.0, fi, dtype=np.float32)
        y[:, :fi] *= ramp
    if fo > 0:
        ramp = np.linspace(1.0, 0.0, fo, dtype=np.float32)
        y[:, -fo:] *= ramp

    if abs(clip.gain_db) > 1e-3:
        y = y * (10 ** (clip.gain_db / 20.0))

    return y


def _mix_track(track: Track, total_samples: int, cache_dir: Path,
               asset_cache: dict[str, np.ndarray]) -> np.ndarray:
    """Render a single track into a (2, total_samples) buffer."""
    buf = np.zeros((2, total_samples), dtype=np.float32)
    if track.mute:
        return buf

    for clip in track.clips:
        try:
            y = _load_clip_asset(clip, cache_dir, asset_cache)
            y = _apply_clip_transforms(y, clip)
        except Exception as exc:
            logger.warning(f"Skipping clip {clip.id}: {exc}")
            continue

        start = int(clip.start_sec * SR)
        end = min(start + y.shape[1], total_samples)
        if start >= total_samples:
            continue
        clip_len = end - start
        if clip_len <= 0:
            continue
        buf[:, start:end] += y[:, :clip_len]

    if abs(track.volume_db) > 1e-3:
        buf *= 10 ** (track.volume_db / 20.0)
    return buf


def render_arrangement_to_files(
    arrangement: Arrangement, work_dir: Path, output_quality: str = "standard"
) -> dict[str, Any]:
    """Render the arrangement to a mastered WAV and a preview MP3.

    Writes both into ``work_dir`` and returns local paths + mastering meta.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = work_dir / "asset_cache"
    cache_dir.mkdir(exist_ok=True)
    asset_cache: dict[str, np.ndarray] = {}

    total_samples = max(int(arrangement.duration_sec * SR), 1)

    # Solo handling: if any track is solo'd, only solo'd tracks contribute.
    solo_active = any(t.solo for t in arrangement.tracks)
    contributing = [t for t in arrangement.tracks if (t.solo if solo_active else not t.mute)]

    master_buf = np.zeros((2, total_samples), dtype=np.float32)
    for track in contributing:
        master_buf += _mix_track(track, total_samples, cache_dir, asset_cache)

    peak = float(np.max(np.abs(master_buf))) or 1.0
    if peak > 0.999:
        master_buf *= 0.999 / peak

    pre_master_wav = work_dir / "arrangement_premaster.wav"
    sf.write(str(pre_master_wav), master_buf.T, SR, subtype="PCM_24")

    mastered_wav = work_dir / "arrangement_mastered.wav"
    mastering_meta = master_audio(str(pre_master_wav), str(mastered_wav), output_quality)

    preview_mp3 = work_dir / "arrangement_preview.mp3"
    export_preview_mp3(str(mastered_wav), str(preview_mp3), bitrate="192k")

    return {
        "premaster_wav": pre_master_wav,
        "mastered_wav":  mastered_wav,
        "preview_mp3":   preview_mp3,
        "mastering":     mastering_meta,
        "duration_sec":  arrangement.duration_sec,
    }


def render_and_upload(
    arrangement: Arrangement,
    job_id: str,
    user_plan: str = "free",
    output_quality: str = "standard",
    work_dir: Path | None = None,
) -> dict[str, Any]:
    """End-to-end: render, master, upload, return signed URLs."""
    tmp_ctx = None
    if work_dir is None:
        tmp_ctx = tempfile.TemporaryDirectory(prefix=f"arr_render_{job_id}_")
        work_dir = Path(tmp_ctx.name)

    try:
        files = render_arrangement_to_files(arrangement, work_dir, output_quality)

        base_key = f"outputs/{job_id}"
        mp3_key = f"{base_key}/preview.mp3"
        wav_key = f"{base_key}/master.wav"

        upload_to_storage(str(files["preview_mp3"]), mp3_key, "audio/mpeg")
        full_wav_url = None
        wav_uploaded = user_plan in ("pro", "studio") or output_quality == "professional"
        if wav_uploaded:
            try:
                upload_to_storage(str(files["mastered_wav"]), wav_key, "audio/wav")
                full_wav_url = get_signed_download_url(wav_key, expires_in=86400)
            except Exception as exc:
                logger.warning(f"WAV upload failed: {exc}")

        info = get_audio_info(str(files["mastered_wav"]))

        return {
            "preview_mp3_url": get_signed_download_url(mp3_key, expires_in=86400),
            "full_wav_url":    full_wav_url,
            "duration_sec":    info.get("duration", arrangement.duration_sec),
            "lufs":            files["mastering"].get("lufs"),
            "mastering_meta":  files["mastering"],
        }
    finally:
        if tmp_ctx is not None:
            tmp_ctx.cleanup()
