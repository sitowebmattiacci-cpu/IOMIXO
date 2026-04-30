"""Stage 3 — compute the harmonic / tempo transform plan between A and B."""

from __future__ import annotations

from loguru import logger

from services.harmonic_matcher import compute_transform_plan

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class HarmonicMatchingStage(Stage):
    name = "harmonic_matching"

    def should_run(self, ctx: PipelineContext) -> bool:
        return not (ctx.cached_analysis and ctx.transform)

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        reporter.update(self.name, "running", 0, 36, "Harmonic matching",
                        message="Computing harmonic transform")
        ctx.transform = compute_transform_plan(ctx.analysis_a, ctx.analysis_b)
        reporter.update(self.name, "complete", 100, 45, "Harmonic matching complete")
        logger.info(f"[{ctx.job_id}] Stage 3 done. Transform: {ctx.transform}")
