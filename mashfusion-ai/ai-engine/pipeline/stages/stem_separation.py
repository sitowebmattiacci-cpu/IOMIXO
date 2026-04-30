"""Stage 1 — download tracks and run Demucs stem separation."""

from __future__ import annotations

from loguru import logger

from utils.s3_utils import download_from_s3
from services.stem_separator import separate_stems

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class StemSeparationStage(Stage):
    name = "stem_separation"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        ctx.track_a_path = ctx.work_dir / "track_a_original.wav"
        ctx.track_b_path = ctx.work_dir / "track_b_original.wav"

        reporter.update(self.name, "running", 0, 2, "Downloading audio",
                        message="Downloading audio files")

        logger.info(f"[{ctx.job_id}] Downloading track A: {ctx.track_a_s3_key}")
        download_from_s3(ctx.track_a_s3_key, str(ctx.track_a_path))
        logger.info(f"[{ctx.job_id}] Downloading track B: {ctx.track_b_s3_key}")
        download_from_s3(ctx.track_b_s3_key, str(ctx.track_b_path))

        reporter.update(self.name, "running", 20, 5, "Stem separation",
                        message="Separating stems — Track A")
        logger.info(f"[{ctx.job_id}] Separating stems — Track A (this takes a few minutes on CPU)")
        ctx.stems_a = separate_stems(str(ctx.track_a_path), str(ctx.work_dir / "stems_a"))

        reporter.update(self.name, "running", 60, 12, "Stem separation",
                        message="Separating stems — Track B")
        logger.info(f"[{ctx.job_id}] Separating stems — Track B")
        ctx.stems_b = separate_stems(str(ctx.track_b_path), str(ctx.work_dir / "stems_b"))

        reporter.update(self.name, "complete", 100, 20, "Stem separation complete")
        logger.info(f"[{ctx.job_id}] Stage 1 done. Stems A: {list(ctx.stems_a.keys())}")
