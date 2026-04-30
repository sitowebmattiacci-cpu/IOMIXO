"""Stage 2 — librosa-based feature extraction for both tracks."""

from __future__ import annotations

from loguru import logger

from services.music_analyzer import analyze_track

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class MusicAnalysisStage(Stage):
    name = "music_analysis"

    def should_run(self, ctx: PipelineContext) -> bool:
        # Reuse cached analysis when an upgrade rerender supplies it.
        return not (ctx.cached_analysis and ctx.analysis_a and ctx.analysis_b)

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        reporter.update(self.name, "running", 0, 22, "Analyzing audio",
                        message="Analyzing Track A")
        ctx.analysis_a = analyze_track(str(ctx.track_a_path))

        reporter.update(self.name, "running", 50, 28, "Analyzing audio",
                        message="Analyzing Track B")
        ctx.analysis_b = analyze_track(str(ctx.track_b_path))

        reporter.mark(self.name, "complete", 100)
        reporter.report("processing", 35, "Analysis complete",
                        analysis_a=ctx.analysis_a, analysis_b=ctx.analysis_b)
        logger.info(
            f"[{ctx.job_id}] Stage 2 done. "
            f"A: {ctx.analysis_a.get('bpm')} BPM {ctx.analysis_a.get('key')} | "
            f"B: {ctx.analysis_b.get('bpm')} BPM {ctx.analysis_b.get('key')}"
        )
