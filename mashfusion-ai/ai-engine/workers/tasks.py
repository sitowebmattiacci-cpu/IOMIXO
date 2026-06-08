"""
Full 7-stage mashup processing pipeline:
  1. stem_separation   — Demucs 6-stem separation for both tracks
  2. music_analysis    — librosa BPM, key, beats, section detection
  3. harmonic_matching — transposition + tempo sync plan
  4. mashup_composition— arrangement timeline builder
  5. sound_modernization—preset-based sound treatment (optional)
  6. mastering         — EQ, compression, LUFS normalization
  7. rendering         — final export MP3 preview + WAV master
"""

import os
import json
import time
import shutil
import socket
import traceback
from pathlib import Path
from celery.utils.log import get_task_logger
import httpx

from workers.celery_worker import celery_app
from workers.checkpointing import (
    save_checkpoint, load_checkpoint, clear_checkpoint,
    increment_retry, get_completed_stages, get_extra,
    save_intermediate_key, get_intermediate_key, should_skip_stage,
)
from workers.routing import (
    get_temp_ttl, get_output_ttl, should_render_wav, estimate_job_cost,
)
from config import get_settings
from utils.s3_utils import download_from_s3, upload_to_s3
from services.stem_separator import separate_stems
from services.music_analyzer import analyze_track
from services.harmonic_matcher import compute_transform_plan
from services.mashup_composer import compose_mashup, run_full_composer_engine
from services.sound_modernizer import apply_style_preset
from services.mastering_engine import master_audio
from services.style_engine import apply_commercial_style
from services.remix_director_adapter import apply_director_params, build_default_pipeline_config
from utils.audio_utils import export_preview_mp3, get_audio_info

settings    = get_settings()
logger      = get_task_logger(__name__)
_WORKER_ID  = socket.gethostname()


def report_progress(
    job_id:        str,
    status:        str,
    progress:      int,
    current_stage: str,
    stage_progress: dict,
    error_message:  str | None = None,
    output:         dict | None = None,
    analysis_a:     dict | None = None,
    analysis_b:     dict | None = None,
):
    payload = {
        "job_id":         job_id,
        "status":         status,
        "progress":       progress,
        "current_stage":  current_stage,
        "stage_progress": stage_progress,
        "error_message":  error_message,
        "output":         output,
        "analysis_a":     analysis_a,
        "analysis_b":     analysis_b,
    }
    try:
        with httpx.Client(timeout=10) as client:
            client.post(
                f"{settings.backend_url}/internal/job-update",
                json=payload,
                headers={"X-Internal-API-Key": settings.internal_api_key},
            )
    except Exception as exc:
        logger.warning(f"Failed to report progress for {job_id}: {exc}")


def stage_ctx(stages: dict, name: str, status: str, progress: int = 0, message: str | None = None) -> dict:
    stages = dict(stages)
    stages[name] = {
        **stages.get(name, {}),
        "status":       status,
        "progress":     progress,
        "message":      message,
        "started_at":   stages[name].get("started_at") or (time.time() if status == "running" else None),
        "completed_at": time.time() if status in ("complete", "skipped", "failed") else None,
    }
    return stages


@celery_app.task(
    bind=True,
    name="process_mashup_job",
    queue="gpu_heavy",
    max_retries=2,
    default_retry_delay=30,
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_mashup_job(self, payload: dict):
    job_id         = payload["job_id"]
    track_a_key    = payload["track_a_s3_key"]
    track_b_key    = payload["track_b_s3_key"]
    remix_style    = payload["remix_style"]
    output_quality = payload["output_quality"]
    user_plan      = payload.get("user_plan", "free")

    # ── Remix Director params ─────────────────────────────────
    # Build the pipeline config. If director_params are present,
    # they override defaults (energy curve, vocal mix, mastering, etc.)
    director_params = payload.get("remix_director_params") or {}
    pipeline_config = apply_director_params(
        director_params,
        build_default_pipeline_config(),
    )
    if director_params:
        logger.info(f"[{job_id}] RemixDirector active: style={director_params.get('style_profile')} energy={director_params.get('target_energy')}")

    # ── Checkpoint resume ─────────────────────────────────────
    # On retry: load existing checkpoint and skip completed stages.
    # On first attempt: checkpoint will be None.
    retry_count = increment_retry(job_id)
    checkpoint  = load_checkpoint(job_id) if retry_count > 1 else None
    completed   = get_completed_stages(checkpoint)
    if completed:
        logger.info(f"[{job_id}] Resuming from checkpoint. Completed stages: {completed}")

    work_dir = Path(settings.tmp_dir) / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    # Timing for cost tracking
    _job_start_time = time.time()

    stages = {
        s: {"status": "pending", "progress": 0, "started_at": None, "completed_at": None, "message": None}
        for s in [
            "stem_separation", "music_analysis", "harmonic_matching",
            "mashup_composition", "sound_modernization", "mastering", "rendering"
        ]
    }
    if remix_style == "none":
        stages["sound_modernization"]["status"] = "skipped"

    # Restore stage states from checkpoint (so UI shows correct progress on retry)
    if checkpoint and checkpoint.get("stages"):
        for sname, sdata in checkpoint["stages"].items():
            if sname in stages:
                stages[sname] = sdata

    try:
        # ── Stage 1: Stem separation ────────────────────────────
        # ── Stage 1: Stem separation ────────────────────────────
        track_a_path = work_dir / "track_a_original.wav"
        track_b_path = work_dir / "track_b_original.wav"

        if should_skip_stage("stem_separation", completed):
            logger.info(f"[{job_id}] Skipping stem_separation (checkpoint)")
            # Restore stems paths from checkpoint extra
            stems_a = get_extra(checkpoint, "stems_a") or {}
            stems_b = get_extra(checkpoint, "stems_b") or {}
            # Re-download originals if workdir was wiped
            if not track_a_path.exists():
                download_from_s3(track_a_key, str(track_a_path))
            if not track_b_path.exists():
                download_from_s3(track_b_key, str(track_b_path))
        else:
            stages = stage_ctx(stages, "stem_separation", "running", 0, "Downloading audio files")
            report_progress(job_id, "processing", 2, "Downloading audio", stages)

            download_from_s3(track_a_key, str(track_a_path))
            download_from_s3(track_b_key, str(track_b_path))

            stages = stage_ctx(stages, "stem_separation", "running", 20, "Separating stems — Track A")
            report_progress(job_id, "processing", 5, "Stem separation", stages)

            stems_a = separate_stems(str(track_a_path), str(work_dir / "stems_a"))
            stages = stage_ctx(stages, "stem_separation", "running", 60, "Separating stems — Track B")
            report_progress(job_id, "processing", 12, "Stem separation", stages)

            stems_b = separate_stems(str(track_b_path), str(work_dir / "stems_b"))
            stages = stage_ctx(stages, "stem_separation", "complete", 100)
            save_checkpoint(job_id, "stem_separation", stages,
                            extra={"stems_a": stems_a, "stems_b": stems_b},
                            worker_id=_WORKER_ID)
            report_progress(job_id, "processing", 20, "Stem separation complete", stages)

        # ── Stage 2: Music analysis ─────────────────────────────
        if should_skip_stage("music_analysis", completed):
            logger.info(f"[{job_id}] Skipping music_analysis (checkpoint)")
            analysis_a = get_extra(checkpoint, "analysis_a") or {}
            analysis_b = get_extra(checkpoint, "analysis_b") or {}
        else:
            stages = stage_ctx(stages, "music_analysis", "running", 0, "Analyzing Track A")
            report_progress(job_id, "processing", 22, "Analyzing audio", stages)

            analysis_a = analyze_track(str(track_a_path))
            stages = stage_ctx(stages, "music_analysis", "running", 50, "Analyzing Track B")
            report_progress(job_id, "processing", 28, "Analyzing audio", stages)

            analysis_b = analyze_track(str(track_b_path))
            stages = stage_ctx(stages, "music_analysis", "complete", 100)
            save_checkpoint(job_id, "music_analysis", stages,
                            extra={"analysis_a": analysis_a, "analysis_b": analysis_b},
                            worker_id=_WORKER_ID)
            report_progress(job_id, "processing", 35, "Analysis complete", stages,
                            analysis_a=analysis_a, analysis_b=analysis_b)

        # ── Stage 3: Harmonic matching ──────────────────────────
        if should_skip_stage("harmonic_matching", completed):
            logger.info(f"[{job_id}] Skipping harmonic_matching (checkpoint)")
            transform = get_extra(checkpoint, "transform") or {}
        else:
            stages = stage_ctx(stages, "harmonic_matching", "running", 0, "Computing harmonic transform")
            report_progress(job_id, "processing", 36, "Harmonic matching", stages)

            transform = compute_transform_plan(analysis_a, analysis_b,
                                              tempo_mode=pipeline_config["harmonic_matching"].get("tempo_mode", "original"),
                                              stretch_factor=pipeline_config["harmonic_matching"].get("stretch_factor"))
            stages = stage_ctx(stages, "harmonic_matching", "complete", 100)
            save_checkpoint(job_id, "harmonic_matching", stages,
                            extra={"transform": transform},
                            worker_id=_WORKER_ID)
            report_progress(job_id, "processing", 45, "Harmonic matching complete", stages)

        # ── Stage 4: Mashup composition (Autonomous Engine) ────────────────
        stages = stage_ctx(stages, "mashup_composition", "running", 0, "Building arrangement with AI engine")
        report_progress(job_id, "processing", 46, "Composing mashup", stages)

        mashup_path = work_dir / "mashup_raw.wav"

        def _composition_progress(p: int) -> None:
            report_progress(
                job_id, "processing", 46 + int(p * 0.14),
                "Composing mashup",
                stage_ctx(stages, "mashup_composition", "running", p),
            )

        # Use full autonomous engine when conditions allow
        # Fallback to legacy compose_mashup if engine raises an error
        composer_metadata: dict = {}
        try:
            composer_metadata = run_full_composer_engine(
                mix_path_a=str(track_a_path),
                mix_path_b=str(track_b_path),
                stems_a=stems_a,
                stems_b=stems_b,
                transform=transform,
                output_path=str(mashup_path),
                progress_cb=_composition_progress,
                vocal_mix_ratio=pipeline_config["composition"].get("vocal_mix_ratio", 0.5),
                energy_curve=pipeline_config["composition"].get("energy_curve", "steady"),
                transition_density=pipeline_config["composition"].get("transition_density", "smooth"),
                finale_intensity=pipeline_config["composition"].get("finale_intensity", "standard"),
                arrangement_complexity=pipeline_config["composition"].get("arrangement_complexity", 0.5),
                surprise_factor=pipeline_config["composition"].get("surprise_factor", 0.0),
            )
            logger.info(
                f"[Stage 4] Autonomous engine complete — "
                f"quality={composer_metadata.get('quality_report', {}).get('final_scores', {}).get('overall', 'n/a')}"
            )
        except Exception as engine_exc:
            logger.warning(
                f"[Stage 4] Autonomous engine failed ({engine_exc}), "
                f"falling back to legacy composer"
            )
            compose_mashup(
                stems_a=stems_a,
                stems_b=stems_b,
                analysis_a=analysis_a,
                analysis_b=analysis_b,
                transform=transform,
                output_path=str(mashup_path),
                progress_cb=_composition_progress,
            )

        stages = stage_ctx(stages, "mashup_composition", "complete", 100)
        save_checkpoint(job_id, "mashup_composition", stages, worker_id=_WORKER_ID)
        report_progress(job_id, "processing", 60, "Composition complete", stages)

        # ── Stage 5: Premium style engine (+ integrated mastering) ────────
        mastered_path  = work_dir / "mashup_mastered.wav"
        mastering_meta: dict = {}
        style_metadata: dict = {}

        if remix_style != "none":
            stages = stage_ctx(stages, "sound_modernization", "running", 0,
                               f"Applying commercial style: {remix_style}")
            report_progress(job_id, "processing", 61, "Commercial style engine", stages)

            styled_path = work_dir / "mashup_styled.wav"

            # Attempt to load drums stem for accurate sidechain detection
            _drums_np = None
            try:
                import librosa as _lr
                _drum_key = (stems_a or {}).get("drums")
                if _drum_key and os.path.isfile(_drum_key):
                    _drums_np, _ = _lr.load(_drum_key, sr=44100, mono=True)
            except Exception:
                pass

            def _style_progress(pct: float, msg: str) -> None:
                report_progress(
                    job_id, "processing", 61 + int(pct * 0.20),
                    "Commercial style engine",
                    stage_ctx(stages, "sound_modernization", "running", int(pct), msg),
                )

            try:
                style_metadata = apply_commercial_style(
                    input_path         = str(mashup_path),
                    output_path        = str(styled_path),
                    preset_name        = remix_style,
                    transition_markers = composer_metadata.get("transition_markers", []),
                    quality            = output_quality,
                    bpm                = float(analysis_a.get("bpm", 120.0)),
                    drums_stem         = _drums_np,
                    progress_cb        = _style_progress,
                )
                mastered_path  = styled_path
                mastering_meta = style_metadata.get("mastering", {})
                if style_metadata.get("errors"):
                    logger.warning(
                        f"[Stage 5] Style engine non-fatal errors: "
                        f"{style_metadata['errors']}"
                    )
                logger.info(
                    f"[Stage 5] Style engine complete — "
                    f"preset={style_metadata.get('preset_id')}, "
                    f"lufs={mastering_meta.get('mastering', {}).get('lufs', 'n/a')}"
                )
            except Exception as style_exc:
                logger.warning(
                    f"[Stage 5] Commercial style engine failed ({style_exc}), "
                    f"falling back to apply_style_preset + master_audio"
                )
                modernized_path = work_dir / "mashup_styled_legacy.wav"
                try:
                    apply_style_preset(str(mashup_path), str(modernized_path), remix_style)
                    mastered_path = modernized_path
                except Exception as legacy_exc:
                    logger.error(f"[Stage 5] Legacy apply_style_preset also failed: {legacy_exc}")
                    # Pass through raw mashup to mastering
                    mastered_path = mashup_path   # will be mastered in Stage 6 below

            stages = stage_ctx(stages, "sound_modernization", "complete", 100)
            save_checkpoint(job_id, "sound_modernization", stages, worker_id=_WORKER_ID)
            report_progress(job_id, "processing", 81, "Style preset applied", stages)

        # ── Stage 6: Mastering ──────────────────────────────────
        # Only run standalone master_audio if the style engine did NOT already master the file
        # (style engine with remix_style != "none" already ran apply_mastering_chain internally)
        _already_mastered = (remix_style != "none" and mastered_path != mashup_path
                             and bool(mastering_meta))

        stages = stage_ctx(stages, "mastering",
                           "skipped" if _already_mastered else "running",
                           100 if _already_mastered else 0,
                           "Mastering handled by style engine" if _already_mastered else "Mastering audio")
        if not _already_mastered:
            report_progress(job_id, "processing", 73, "Mastering", stages)
            _master_input  = mastered_path if mastered_path != mashup_path else mashup_path
            _master_output = work_dir / "mashup_mastered_final.wav"
            mastering_meta = master_audio(str(_master_input), str(_master_output), output_quality,
                                          target_lufs=pipeline_config["mastering"].get("target_lufs", -14.0),
                                          ceiling_dbtp=pipeline_config["mastering"].get("ceiling_dbtp", -1.0),
                                          warmth=pipeline_config["mastering"].get("warmth", 0.5),
                                          brightness=pipeline_config["mastering"].get("brightness", 0.5))
            mastered_path  = _master_output
            stages = stage_ctx(stages, "mastering", "complete", 100)
            save_checkpoint(job_id, "mastering", stages, worker_id=_WORKER_ID)

        report_progress(job_id, "processing", 85, "Mastering complete", stages)

        # ── Stage 7: Rendering & upload ─────────────────────────
        stages = stage_ctx(stages, "rendering", "running", 0, "Exporting preview MP3")
        report_progress(job_id, "processing", 86, "Rendering exports", stages)

        preview_path = work_dir / "preview.mp3"
        export_preview_mp3(str(mastered_path), str(preview_path), bitrate="192k")

        stages = stage_ctx(stages, "rendering", "running", 40, "Uploading to S3")
        report_progress(job_id, "processing", 90, "Uploading", stages)

        base_key        = f"outputs/{job_id}"
        preview_s3_key  = f"{base_key}/preview.mp3"
        wav_s3_key      = f"{base_key}/master.wav"

        upload_to_s3(str(preview_path), preview_s3_key, content_type="audio/mpeg")

        # WAV master: only for pro/studio users — free gets MP3 preview only
        if should_render_wav(user_plan, output_quality):
            upload_to_s3(str(mastered_path), wav_s3_key, content_type="audio/wav")
        else:
            wav_s3_key = None   # free users: no WAV
            logger.info(f"[{job_id}] WAV skipped (plan={user_plan})")

        stages = stage_ctx(stages, "rendering", "complete", 100)

        info = get_audio_info(str(mastered_path))
        output = {
            "preview_mp3_url":  preview_s3_key,
            "full_wav_url":     wav_s3_key,
            "duration_seconds": info["duration"],
            "loudness_lufs":    mastering_meta.get("lufs") or mastering_meta.get("mastering", {}).get("lufs"),
            "sample_rate":      info["sample_rate"],
            "bit_depth":        24 if output_quality == "professional" else 16,
            "file_size_bytes":  os.path.getsize(str(mastered_path)),
            "composer_metadata": composer_metadata or {},
            "style_metadata":    style_metadata or {},
        }

        report_progress(job_id, "complete", 100, "Complete", stages, output=output)
        logger.info(f"Job {job_id} completed successfully")

        # ── Post-completion: clear checkpoint, record cost, schedule cleanup ──
        clear_checkpoint(job_id)

        _total_seconds = int(time.time() - _job_start_time)
        # GPU time is roughly stem separation proportion (~40% of total)
        _gpu_seconds = int(_total_seconds * 0.4)
        _cpu_seconds = int(_total_seconds * 0.6)
        _output_bytes = os.path.getsize(str(mastered_path)) + os.path.getsize(str(preview_path))

        from workers.cleanup_tasks import record_job_cost, cleanup_job_temp_files
        record_job_cost.apply_async(
            kwargs={
                "job_id":          job_id,
                "user_plan":       user_plan,
                "gpu_seconds":     _gpu_seconds,
                "cpu_seconds":     _cpu_seconds,
                "s3_bytes_temp":   0,
                "s3_bytes_output": _output_bytes,
                "worker_hostname": _WORKER_ID,
            },
            queue="cleanup",
        )

        # Schedule temp file cleanup after plan-appropriate delay
        cleanup_job_temp_files.apply_async(
            args=[job_id, user_plan],
            queue="cleanup",
            countdown=get_temp_ttl(user_plan),
        )

    except Exception as exc:
        logger.error(f"Job {job_id} failed: {exc}\n{traceback.format_exc()}")
        stages_failed = {
            k: ({**v, "status": "failed"} if v.get("status") == "running" else v)
            for k, v in stages.items()
        }
        # Save failed checkpoint so retry picks up from last good stage
        save_checkpoint(job_id, "__failed__", stages_failed, worker_id=_WORKER_ID)
        report_progress(job_id, "failed", 0, "Failed", stages_failed, error_message=str(exc))
        raise self.retry(exc=exc)

    finally:
        # Only clean up local /tmp on SUCCESS (cleanup task handles S3).
        # On failure/retry we keep the workdir so the next attempt can
        # resume (stems directories will still exist).
        if not self.request.is_eager and self.request.retries >= self.max_retries:
            try:
                shutil.rmtree(str(work_dir), ignore_errors=True)
            except Exception:
                pass
