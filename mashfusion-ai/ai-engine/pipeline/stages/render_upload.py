"""Stage 7 — render preview MP3, optionally upload WAV, and produce signed URLs."""

from __future__ import annotations

import os

from loguru import logger

from utils.s3_utils import upload_to_s3, get_signed_download_url
from utils.audio_utils import export_preview_mp3, get_audio_info

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter


class RenderUploadStage(Stage):
    name = "rendering"

    def should_run(self, ctx: PipelineContext) -> bool:
        return ctx.mode == "full"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        reporter.update(self.name, "running", 0, 86, "Rendering exports",
                        message="Exporting preview MP3")

        preview_path = ctx.work_dir / "preview.mp3"
        export_preview_mp3(str(ctx.mastered_path), str(preview_path), bitrate="192k")

        reporter.update(self.name, "running", 40, 90, "Uploading",
                        message="Uploading to storage")

        base_key = f"outputs/{ctx.job_id}"
        preview_s3_key = f"{base_key}/preview.mp3"
        wav_s3_key: str | None = f"{base_key}/master.wav"

        upload_to_s3(str(preview_path), preview_s3_key, content_type="audio/mpeg")

        render_wav = ctx.user_plan in ("pro", "studio") or ctx.output_quality == "professional"
        if render_wav:
            try:
                upload_to_s3(str(ctx.mastered_path), wav_s3_key, content_type="audio/wav")
            except Exception as e:
                logger.warning(
                    f"WAV upload failed (likely size-cap), continuing with MP3 only: {e}"
                )
                wav_s3_key = None
        else:
            wav_s3_key = None

        reporter.mark(self.name, "complete", 100)

        preview_url = get_signed_download_url(preview_s3_key, expires_in=86400)
        wav_url = get_signed_download_url(wav_s3_key, expires_in=86400) if wav_s3_key else None

        info = get_audio_info(str(ctx.mastered_path))
        ctx.output = {
            "preview_mp3_url":  preview_url,
            "full_wav_url":     wav_url,
            "full_mp3_url":     preview_url,
            "duration_seconds": info["duration"],
            "loudness_lufs":    ctx.mastering_meta.get("lufs")
                                or ctx.mastering_meta.get("mastering", {}).get("lufs"),
            "sample_rate":      info["sample_rate"],
            "bit_depth":        24 if ctx.output_quality == "professional" else 16,
            "file_size_bytes":  os.path.getsize(str(ctx.mastered_path)),
        }
        logger.info(f"[{ctx.job_id}] Job complete! Preview: {preview_url}")
