"""Stage 1 — download tracks and run Demucs stem separation.

Phase 0 update: when ``ctx.project_id`` is present, separated stems are
uploaded to the ``stems`` Supabase Storage bucket so they survive past
the lifetime of this job. The remix workstation reads from this bucket
to expose stems for drag-and-drop into the timeline.
"""

from __future__ import annotations

import os
from pathlib import Path

import requests
import soundfile as sf
from loguru import logger

from config import get_settings
from utils.s3_utils import STEMS_BUCKET, download_from_s3, upload_to_storage
from services.stem_separator import separate_stems

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter

_settings = get_settings()


def _stem_audio_meta(local_path: str) -> tuple[float | None, int | None]:
    try:
        info = sf.info(local_path)
        return float(info.duration), int(info.samplerate)
    except Exception as exc:
        logger.warning(f"Could not read audio meta for {local_path}: {exc}")
        return None, None


def _register_stems_in_backend(
    ctx: PipelineContext, side: str, source_track_id: str | None,
    stems: list[dict],
) -> None:
    """POST stem rows to backend so /projects/:id/stems returns them."""
    backend_url = getattr(_settings, "backend_url", None) or os.environ.get("BACKEND_URL")
    api_key = getattr(_settings, "internal_api_key", None) or os.environ.get("AI_ENGINE_API_KEY")
    if not backend_url or not api_key or not stems:
        logger.warning(f"[{ctx.job_id}] Skipping stem registration (side={side}): missing config or empty list")
        return
    try:
        resp = requests.post(
            f"{backend_url}/internal/stems",
            json={
                "project_id":      ctx.project_id,
                "source_track_id": source_track_id,
                "stems":           stems,
            },
            headers={"X-Internal-API-Key": api_key},
            timeout=30,
        )
        if not resp.ok:
            body = (resp.text or "")[:500]
            logger.error(f"[{ctx.job_id}] Stem registration rejected (side={side}): status={resp.status_code} body={body}")
            resp.raise_for_status()
        logger.info(f"[{ctx.job_id}] Registered {len(stems)} stems in backend (side={side})")
    except Exception as exc:
        logger.error(f"[{ctx.job_id}] Failed to register stems (side={side}): {exc}")


def _persist_stems(
    ctx: PipelineContext, side: str, stems_local: dict[str, str],
    source_track_id: str | None = None,
) -> dict[str, str]:
    """Upload each stem to the stems bucket, register row, return name→key."""
    if not ctx.project_id:
        logger.info(f"[{ctx.job_id}] No project_id; skipping stem persistence ({side})")
        return {}

    keys: dict[str, str] = {}
    rows: list[dict] = []
    for stem_name, local_path in stems_local.items():
        if not Path(local_path).exists():
            continue
        storage_key = f"{ctx.project_id}/{side}/{stem_name}.flac"
        upload_to_storage(local_path, storage_key, "audio/flac", bucket=STEMS_BUCKET)
        keys[stem_name] = storage_key
        dur, sr = _stem_audio_meta(local_path)
        rows.append({
            "side":         side,
            "stem_name":    stem_name,
            "s3_key":       storage_key,
            "duration_sec": dur,
            "sample_rate":  sr,
        })
    logger.info(f"[{ctx.job_id}] Persisted {len(keys)} stems for side {side}")
    _register_stems_in_backend(ctx, side, source_track_id, rows)
    return keys


class StemSeparationStage(Stage):
    name = "stem_separation"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        ctx.track_a_path = ctx.work_dir / "track_a_original.wav"
        ctx.track_b_path = ctx.work_dir / "track_b_original.wav"

        has_b = bool(ctx.track_b_s3_key)

        reporter.update(self.name, "running", 0, 2, "Downloading audio",
                        message="Downloading audio files")

        logger.info(f"[{ctx.job_id}] Downloading track A: {ctx.track_a_s3_key}")
        download_from_s3(ctx.track_a_s3_key, str(ctx.track_a_path))
        if has_b:
            logger.info(f"[{ctx.job_id}] Downloading track B: {ctx.track_b_s3_key}")
            download_from_s3(ctx.track_b_s3_key, str(ctx.track_b_path))
        else:
            logger.info(f"[{ctx.job_id}] Remix mode: skipping track B (single-track project)")

        reporter.update(self.name, "running", 20, 5, "Stem separation",
                        message="Separating stems — Track A")
        logger.info(f"[{ctx.job_id}] Separating stems — Track A (this takes a few minutes on CPU)")
        stem_cfg = (ctx.pipeline_config or {}).get("stem_separation", {})
        ctx.stems_a = separate_stems(
            str(ctx.track_a_path),
            str(ctx.work_dir / "stems_a"),
            stem_cfg,
        )

        if has_b:
            reporter.update(self.name, "running", 60, 12, "Stem separation",
                            message="Separating stems — Track B")
            logger.info(f"[{ctx.job_id}] Separating stems — Track B")
            ctx.stems_b = separate_stems(
                str(ctx.track_b_path),
                str(ctx.work_dir / "stems_b"),
                stem_cfg,
            )

        reporter.update(self.name, "running", 90, 18, "Persisting stems",
                        message="Uploading stems to storage")
        ctx.stems_a_keys = _persist_stems(ctx, "a", ctx.stems_a or {})
        if has_b:
            ctx.stems_b_keys = _persist_stems(ctx, "b", ctx.stems_b or {})

        reporter.update(self.name, "complete", 100, 20, "Stem separation complete")
        logger.info(f"[{ctx.job_id}] Stage 1 done. Stems A: {list((ctx.stems_a or {}).keys())}")
