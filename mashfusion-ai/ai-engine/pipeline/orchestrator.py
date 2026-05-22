"""Top-level orchestrator — owns stage ordering, lifecycle, and error handling.

Phase 2 pivot: the engine no longer renders a final mashup automatically.
The pipeline produces an *arrangement seed* (a starter timeline JSON) and
exits. Final audio is only produced by user-triggered renders through the
``/render/arrangement`` endpoint (Phase 1).
"""

from __future__ import annotations

import json
import traceback
from pathlib import Path
from typing import Callable, Iterable

from loguru import logger

from services.remix_director_adapter import (
    apply_director_params,
    build_default_pipeline_config,
)

from .base import Stage
from .context import PipelineContext
from .reporter import ProgressReporter
from .stages import (
    AISeedStage,
    HarmonicMatchingStage,
    MusicAnalysisStage,
    StemSeparationStage,
)


_STAGE_KEYS = (
    "stem_separation",
    "music_analysis",
    "harmonic_matching",
    "ai_seed",
)


def build_default_pipeline() -> list[Stage]:
    """Mashup-mode seed pipeline (two tracks → editable starter arrangement).

    Stops after generating an arrangement JSON. The user then edits the
    arrangement in the browser and triggers a render via the backend's
    ``/projects/:id/render`` endpoint, which calls the AI engine's
    ``/render/arrangement`` directly — bypassing this pipeline entirely.
    """
    return [
        StemSeparationStage(),
        MusicAnalysisStage(),
        HarmonicMatchingStage(),
        AISeedStage(),
    ]


def build_remix_pipeline() -> list[Stage]:
    """Remix-mode pipeline (single track → stems + empty timeline).

    Per product direction: the user is the creative director. In remix
    mode we only separate stems and analyse Track A for tempo/key (so the
    workstation grid + key panel render correctly). We deliberately skip
    harmonic matching (no second track) and the AI seed never places
    clips — the timeline starts empty so the user drags stems in.
    """
    return [
        StemSeparationStage(),
        MusicAnalysisStage(),
        AISeedStage(),
    ]


def build_pipeline_for_mode(project_mode: str = "mashup") -> list[Stage]:
    """Select pipeline by product mode."""
    if project_mode == "remix":
        return build_remix_pipeline()
    return build_default_pipeline()


class PipelineOrchestrator:
    """Runs an ordered list of :class:`Stage` instances against a context."""

    def __init__(
        self,
        stages: Iterable[Stage],
        transport: Callable[..., None],
        tmp_dir: str | Path,
    ) -> None:
        self._stages = list(stages)
        self._transport = transport
        self._tmp_dir = Path(tmp_dir)

    # ── public API ───────────────────────────────────────────────────────
    def run(self, payload: dict) -> PipelineContext:
        ctx = self._build_context(payload)
        reporter = ProgressReporter(ctx.job_id, self._transport, ctx)

        try:
            for stage in self._stages:
                if not stage.should_run(ctx):
                    logger.info(f"[{ctx.job_id}] Skipping stage '{stage.name}' (should_run=False)")
                    self._mark_skipped(ctx, stage.name)
                    continue
                logger.info(f"[{ctx.job_id}] → Stage: {stage.name}")
                stage.run(ctx, reporter)

            reporter.report(
                "complete", 100, "Complete",
                output=ctx.output,
                analysis_a=ctx.analysis_a, analysis_b=ctx.analysis_b,
                cached_analysis=self._build_cached_analysis(ctx),
            )
        except Exception as exc:
            logger.error(
                f"[{ctx.job_id}] Pipeline failed: {exc}\n{traceback.format_exc()}"
            )
            self._mark_running_as_failed(ctx)
            reporter.report(
                "failed", 0, "Failed",
                error_message=str(exc),
            )

        return ctx

    # ── internals ────────────────────────────────────────────────────────
    def _build_context(self, payload: dict) -> PipelineContext:
        director_params = payload.get("remix_director_params") or {}
        pipeline_config = apply_director_params(
            director_params, build_default_pipeline_config()
        )

        ctx = PipelineContext(
            job_id=payload["job_id"],
            track_a_s3_key=payload["track_a_s3_key"],
            track_b_s3_key=payload.get("track_b_s3_key") or None,
            project_id=payload.get("project_id"),
            user_id=payload.get("user_id"),
            remix_style=payload.get("remix_style", "none"),
            output_quality=payload.get("output_quality", "standard"),
            user_plan=payload.get("user_plan", "free"),
            pipeline_config=pipeline_config,
            mode=payload.get("mode", "full"),
            project_mode=payload.get("project_mode", "mashup"),
            cached_analysis=payload.get("cached_analysis"),
        )
        ctx.work_dir = self._tmp_dir / ctx.job_id
        ctx.work_dir.mkdir(parents=True, exist_ok=True)

        ctx.stages = {
            key: {
                "status": "pending",
                "progress": 0,
                "started_at": None,
                "completed_at": None,
                "message": None,
            }
            for key in _STAGE_KEYS
        }

        if ctx.cached_analysis:
            self._hydrate_from_cache(ctx)

        return ctx

    @staticmethod
    def _hydrate_from_cache(ctx: PipelineContext) -> None:
        cache = ctx.cached_analysis or {}
        ctx.analysis_a = cache.get("analysis_a") or ctx.analysis_a
        ctx.analysis_b = cache.get("analysis_b") or ctx.analysis_b
        ctx.transform  = cache.get("transform")  or ctx.transform
        for key in ("music_analysis", "harmonic_matching"):
            if key in ctx.stages and ctx.analysis_a and ctx.analysis_b and ctx.transform:
                ctx.stages[key]["status"] = "skipped"

    @staticmethod
    def _mark_running_as_failed(ctx: PipelineContext) -> None:
        for key, value in ctx.stages.items():
            if value.get("status") == "running":
                ctx.stages[key] = {**value, "status": "failed"}

    @staticmethod
    def _mark_skipped(ctx: PipelineContext, name: str) -> None:
        if name in ctx.stages and ctx.stages[name].get("status") == "pending":
            ctx.stages[name]["status"] = "skipped"

    @staticmethod
    def _build_cached_analysis(ctx: PipelineContext) -> dict | None:
        if not (ctx.analysis_a and ctx.analysis_b):
            return None
        try:
            payload = {
                "analysis_a": ctx.analysis_a,
                "analysis_b": ctx.analysis_b,
                "transform":  ctx.transform,
            }
            return json.loads(json.dumps(payload, default=str))
        except Exception as exc:
            logger.warning(f"[{ctx.job_id}] Failed to serialise cached_analysis: {exc}")
            return None
