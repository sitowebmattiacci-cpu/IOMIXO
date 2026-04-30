"""Stage 6 — final mastering pass (skipped when the style engine handled it)."""

from __future__ import annotations

from loguru import logger

from services.mastering_engine import master_audio

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class MasteringStage(Stage):
    name = "mastering"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        already_mastered = (
            ctx.remix_style != "none"
            and ctx.mastered_path is not None
            and ctx.mastered_path != ctx.mashup_path
            and bool(ctx.mastering_meta)
        )

        if already_mastered:
            reporter.mark(self.name, "skipped", 100, "Handled by style engine")
        else:
            reporter.update(self.name, "running", 0, 73, "Mastering",
                            message="Mastering audio")

            master_output = ctx.work_dir / "mashup_mastered_final.wav"
            mastering_cfg = ctx.pipeline_config.get("mastering", {})
            ctx.mastering_meta = master_audio(
                str(ctx.mastered_path), str(master_output), ctx.output_quality,
                target_lufs=mastering_cfg.get("target_lufs", -14.0),
                ceiling_dbtp=mastering_cfg.get("ceiling_dbtp", -1.0),
                warmth=mastering_cfg.get("warmth", 0.5),
                brightness=mastering_cfg.get("brightness", 0.5),
            )
            ctx.mastered_path = master_output
            reporter.mark(self.name, "complete", 100)
            logger.info(f"[{ctx.job_id}] Stage 6 done. LUFS: {ctx.mastering_meta.get('lufs')}")

        reporter.report("processing", 85, "Mastering complete")
