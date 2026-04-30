"""Top-level orchestrator — owns stage ordering, lifecycle, and error handling.

The orchestrator deliberately knows nothing about the inside of each stage; it
only sees the :class:`Stage` interface. New stages (e.g. preview-only render,
soundbank injection, full re-render) can be inserted by subclassing
:class:`Stage` and adding the instance to the list returned by
:func:`build_default_pipeline` (or any custom factory).
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
    HarmonicMatchingStage,
    MasteringStage,
    MusicAnalysisStage,
    PreviewClipRendererStage,
    RenderUploadStage,
    SmartCompositionStage,
    StemSeparationStage,
    StyleInjectionStage,
)


_STAGE_KEYS = (
    "stem_separation",
    "music_analysis",
    "harmonic_matching",
    "mashup_composition",
    "sound_modernization",
    "mastering",
    "rendering",
)


def build_default_pipeline() -> list[Stage]:
    """The canonical 7-stage pipeline used in production (full mode)."""
    return [
        StemSeparationStage(),
        MusicAnalysisStage(),
        HarmonicMatchingStage(),
        SmartCompositionStage(),
        StyleInjectionStage(),
        MasteringStage(),
        RenderUploadStage(),
    ]


def build_preview_pipeline() -> list[Stage]:
    """Preview pipeline — stops after harmonic match and renders 3 short teasers.

    Skips smart composition (full arrangement), style injection, mastering, and
    HQ render/upload. The PreviewClipRendererStage produces 3 MP3 teasers.
    """
    return [
        StemSeparationStage(),
        MusicAnalysisStage(),
        HarmonicMatchingStage(),
        PreviewClipRendererStage(),
    ]


def build_pipeline_for_mode(mode: str) -> list[Stage]:
    if mode == "preview":
        return build_preview_pipeline()
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

                # After harmonic matching, capture cached analysis so a future
                # full-mode rerender can skip the heavy upstream stages.
                if stage.name == "harmonic_matching":
                    self._emit_cached_analysis(ctx, reporter)

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
            track_b_s3_key=payload["track_b_s3_key"],
            remix_style=payload.get("remix_style", "none"),
            output_quality=payload.get("output_quality", "standard"),
            user_plan=payload.get("user_plan", "free"),
            pipeline_config=pipeline_config,
            mode=payload.get("mode", "full"),
            preview_duration_sec=int(payload.get("preview_duration_sec", 30) or 30),
            cached_analysis=payload.get("cached_analysis"),
            parent_job_id=payload.get("parent_job_id"),
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
        if ctx.remix_style == "none":
            ctx.stages["sound_modernization"]["status"] = "skipped"
        if ctx.mode == "preview":
            for k in ("mashup_composition", "sound_modernization", "mastering"):
                ctx.stages[k]["status"] = "skipped"

        # If the upstream provided cached analysis, hydrate the context so the
        # heavy stages can short-circuit (see should_run on each stage).
        if ctx.cached_analysis:
            self._hydrate_from_cache(ctx)

        return ctx

    @staticmethod
    def _hydrate_from_cache(ctx: PipelineContext) -> None:
        cache = ctx.cached_analysis or {}
        ctx.analysis_a = cache.get("analysis_a") or ctx.analysis_a
        ctx.analysis_b = cache.get("analysis_b") or ctx.analysis_b
        ctx.transform  = cache.get("transform")  or ctx.transform
        # File paths are not portable across runs; mark stems as None so
        # StemSeparationStage runs again unless the caller persisted stems
        # under a known location.
        for key in ("stem_separation", "music_analysis", "harmonic_matching"):
            if key in ctx.stages and ctx.analysis_a and ctx.analysis_b and ctx.transform:
                # We have analysis but probably no stems; only short-circuit
                # analysis + harmonic matching, NOT stem separation (stems are
                # files on local disk that don't survive).
                if key in ("music_analysis", "harmonic_matching"):
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
            # Round-trip through JSON to guarantee serializable shape.
            return json.loads(json.dumps(payload, default=str))
        except Exception as exc:
            logger.warning(f"[{ctx.job_id}] Failed to serialise cached_analysis: {exc}")
            return None

    def _emit_cached_analysis(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        cache = self._build_cached_analysis(ctx)
        if cache is None:
            return
        reporter.report(
            "processing",
            ctx.stages.get("harmonic_matching", {}).get("progress", 45) or 45,
            "Caching analysis",
            cached_analysis=cache,
        )
