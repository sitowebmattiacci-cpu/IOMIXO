"""Stage 5 — apply commercial style / sound modernization presets."""

from __future__ import annotations

import os

from loguru import logger

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter

try:
    from services.style_engine import apply_commercial_style
    _HAS_STYLE_ENGINE = True
except Exception:
    _HAS_STYLE_ENGINE = False
    logger.warning("Style engine not available — skipping sound modernization stage")

try:
    from services.sound_modernizer import apply_style_preset  # noqa: F401
    _HAS_LEGACY_STYLE = True
except Exception:
    _HAS_LEGACY_STYLE = False


class StyleInjectionStage(Stage):
    name = "sound_modernization"

    def should_run(self, ctx: PipelineContext) -> bool:
        return ctx.remix_style != "none"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        # default carry-throughs: nothing styled, mastered_path = mashup_path
        ctx.mastered_path = ctx.mashup_path

        if ctx.remix_style == "none":
            # marked as skipped at orchestrator init; nothing else to do
            return

        reporter.update(self.name, "running", 0, 61, "Commercial style engine",
                        message=f"Applying style: {ctx.remix_style}")

        styled_path = ctx.work_dir / "mashup_styled.wav"
        ctx.styled_path = styled_path

        drums_np = self._load_drums_stem(ctx)

        if _HAS_STYLE_ENGINE:
            def _style_progress(pct: float, msg: str) -> None:
                reporter.mark(self.name, "running", int(pct), msg)
                reporter.report("processing", 61 + int(pct * 0.20),
                                "Commercial style engine")

            try:
                ctx.style_metadata = apply_commercial_style(
                    input_path=str(ctx.mashup_path),
                    output_path=str(styled_path),
                    preset_name=ctx.remix_style,
                    transition_markers=ctx.composer_metadata.get("transition_markers", []),
                    quality=ctx.output_quality,
                    bpm=float(ctx.analysis_a.get("bpm", 120.0)),
                    drums_stem=drums_np,
                    progress_cb=_style_progress,
                )
                ctx.mastered_path = styled_path
                ctx.mastering_meta = ctx.style_metadata.get("mastering", {})
                logger.info(f"[{ctx.job_id}] Stage 5 (style engine) done.")
            except Exception as se:
                logger.warning(f"[{ctx.job_id}] Style engine failed ({se}), trying legacy")
                if _HAS_LEGACY_STYLE:
                    try:
                        from services.sound_modernizer import apply_style_preset
                        apply_style_preset(str(ctx.mashup_path), str(styled_path), ctx.remix_style)
                        ctx.mastered_path = styled_path
                    except Exception as le:
                        logger.error(f"[{ctx.job_id}] Legacy style also failed: {le}")
        elif _HAS_LEGACY_STYLE:
            from services.sound_modernizer import apply_style_preset
            apply_style_preset(str(ctx.mashup_path), str(styled_path), ctx.remix_style)
            ctx.mastered_path = styled_path

        reporter.update(self.name, "complete", 100, 81, "Style applied")

    @staticmethod
    def _load_drums_stem(ctx: PipelineContext):
        if not _HAS_STYLE_ENGINE:
            return None
        try:
            import librosa as _lr
            drum_key = (ctx.stems_a or {}).get("drums")
            if drum_key and os.path.isfile(drum_key):
                arr, _ = _lr.load(drum_key, sr=44100, mono=True)
                return arr
        except Exception:
            return None
        return None
