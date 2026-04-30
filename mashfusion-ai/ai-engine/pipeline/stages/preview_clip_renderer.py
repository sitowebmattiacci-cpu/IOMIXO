"""Preview-mode terminal stage — renders 3 teaser MP3s and uploads them.

This replaces the full render pipeline (smart composition → style injection →
mastering → render upload) when ``ctx.mode == 'preview'``. Cost target: under
40% of full pipeline wall time.
"""

from __future__ import annotations

from loguru import logger

from utils.s3_utils import upload_to_s3, get_signed_download_url
from utils.audio_utils import get_audio_info
from services.preview import render_all_clips

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class PreviewClipRendererStage(Stage):
    name = "rendering"

    def should_run(self, ctx: PipelineContext) -> bool:
        return ctx.mode == "preview"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        reporter.update(self.name, "running", 0, 60, "Rendering preview clips",
                        message="Selecting teaser windows")

        if not (ctx.stems_a and ctx.stems_b and ctx.analysis_a and ctx.analysis_b):
            raise RuntimeError("Preview render requires stems and analysis for both tracks")

        duration_a = float(ctx.analysis_a.get("duration") or get_audio_info(str(ctx.track_a_path))["duration"])
        duration_b = float(ctx.analysis_b.get("duration") or get_audio_info(str(ctx.track_b_path))["duration"])

        reporter.update(self.name, "running", 20, 70, "Rendering preview clips",
                        message="Mixing teaser variants A/B/C")

        clips = render_all_clips(
            stems_a=ctx.stems_a,
            stems_b=ctx.stems_b,
            analysis_a=ctx.analysis_a,
            analysis_b=ctx.analysis_b,
            duration_a=duration_a,
            duration_b=duration_b,
            preview_duration_sec=ctx.preview_duration_sec,
            work_dir=ctx.work_dir,
        )
        if not clips:
            raise RuntimeError("Preview clip rendering produced no outputs")

        reporter.update(self.name, "running", 70, 90, "Uploading previews",
                        message="Uploading teaser variants")

        base_key = f"previews/{ctx.job_id}"
        urls: dict[str, str] = {}
        total_bytes = 0
        for window, mp3_path in clips:
            s3_key = f"{base_key}/preview_{window.variant.lower()}.mp3"
            upload_to_s3(str(mp3_path), s3_key, content_type="audio/mpeg")
            urls[window.variant] = get_signed_download_url(s3_key, expires_in=86400)
            try:
                total_bytes += mp3_path.stat().st_size
            except OSError:
                pass

        reporter.mark(self.name, "complete", 100)

        # Map preview URLs onto the existing FinalOutput shape — preview_a/b/c.
        ctx.output = {
            "is_preview":       True,
            "preview_a_url":    urls.get("A"),
            "preview_b_url":    urls.get("B"),
            "preview_c_url":    urls.get("C"),
            "preview_mp3_url":  urls.get("A"),  # back-compat: first variant
            "duration_seconds": ctx.preview_duration_sec,
            "loudness_lufs":    None,
            "sample_rate":      44100,
            "bit_depth":        16,
            "file_size_bytes":  total_bytes,
        }
        logger.info(f"[{ctx.job_id}] Preview clips ready: {list(urls.keys())}")
