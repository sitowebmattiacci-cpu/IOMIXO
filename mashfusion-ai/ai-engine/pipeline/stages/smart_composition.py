"""Stage 4 — smart composer (with legacy fallback) builds the raw mashup."""

from __future__ import annotations

from loguru import logger

from services.mashup_composer import compose_mashup, run_full_composer_engine

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class SmartCompositionStage(Stage):
    name = "mashup_composition"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        reporter.update(self.name, "running", 0, 46, "Composing mashup",
                        message="Building arrangement")

        ctx.mashup_path = ctx.work_dir / "mashup_raw.wav"
        composition_cfg = ctx.pipeline_config.get("composition", {})

        def _composition_progress(p: int) -> None:
            reporter.mark(self.name, "running", p)
            reporter.report("processing", 46 + int(p * 0.14), "Composing mashup")

        try:
            ctx.composer_metadata = run_full_composer_engine(
                mix_path_a=str(ctx.track_a_path),
                mix_path_b=str(ctx.track_b_path),
                stems_a=ctx.stems_a,
                stems_b=ctx.stems_b,
                transform=ctx.transform,
                output_path=str(ctx.mashup_path),
                progress_cb=_composition_progress,
                vocal_mix_ratio=composition_cfg.get("vocal_mix_ratio", 0.5),
                energy_curve=composition_cfg.get("energy_curve", "steady"),
                transition_density=composition_cfg.get("transition_density", "smooth"),
                finale_intensity=composition_cfg.get("finale_intensity", "standard"),
                arrangement_complexity=composition_cfg.get("arrangement_complexity", 0.5),
                surprise_factor=composition_cfg.get("surprise_factor", 0.0),
            )
            logger.info(f"[{ctx.job_id}] Stage 4 (full composer) done.")
        except Exception as e:
            logger.warning(f"[{ctx.job_id}] Full composer failed ({e}), falling back to legacy")
            compose_mashup(
                stems_a=ctx.stems_a,
                stems_b=ctx.stems_b,
                analysis_a=ctx.analysis_a,
                analysis_b=ctx.analysis_b,
                transform=ctx.transform,
                output_path=str(ctx.mashup_path),
                progress_cb=_composition_progress,
            )
            logger.info(f"[{ctx.job_id}] Stage 4 (legacy composer) done.")

        reporter.update(self.name, "complete", 100, 60, "Composition complete")
