"""
Cleanup and maintenance Celery tasks for MASHFUSION AI.

These tasks run on the 'cleanup' queue, consumed by celery-cleanup-worker.
They are also triggered by Celery Beat on a periodic schedule
(defined in celery_worker.py beat_schedule).

Tasks:
  cleanup_job_temp_files       — delete /tmp workdir + S3 stem files for a specific job
  sweep_expired_temp_files     — periodic: find all expired temp rows in DB and delete
  sweep_expired_outputs        — periodic: delete S3 final outputs past their TTL
  prune_stale_worker_nodes     — periodic: mark offline workers not seen for >2 min
  record_job_cost              — record GPU/CPU seconds consumed by a completed job
  send_job_complete_notification — email user when job finishes
"""

import os
import shutil
import time
import httpx
from pathlib import Path
from celery.utils.log import get_task_logger

from workers.celery_worker import celery_app
from workers.routing import estimate_job_cost
from config import get_settings
from utils.s3_utils import delete_from_s3, list_s3_prefix

settings = get_settings()
logger   = get_task_logger(__name__)


# ═════════════════════════════════════════════════════════════════
# PER-JOB CLEANUP
# ═════════════════════════════════════════════════════════════════

@celery_app.task(
    bind=True,
    name="cleanup_job_temp_files",
    queue="cleanup",
    max_retries=3,
    default_retry_delay=120,
    ignore_result=True,
)
def cleanup_job_temp_files(self, job_id: str, user_plan: str = "free") -> None:
    """
    Delete the job's /tmp workdir and any S3 keys under
    processing/{job_id}/.

    Called automatically after job completion with a delay
    determined by the user's plan (routing.get_temp_ttl).
    """
    logger.info(f"[cleanup] Starting temp file cleanup for job {job_id}")
    errors: list[str] = []

    # 1. Local /tmp workdir
    work_dir = Path(settings.tmp_dir) / job_id
    if work_dir.exists():
        try:
            shutil.rmtree(str(work_dir), ignore_errors=False)
            logger.info(f"[cleanup] Deleted local workdir: {work_dir}")
        except Exception as exc:
            errors.append(f"local:{exc}")
            logger.warning(f"[cleanup] Failed to delete local workdir {work_dir}: {exc}")

    # 2. S3 processing/ prefix (intermediate stems uploaded during job)
    processing_prefix = f"processing/{job_id}/"
    try:
        keys = list_s3_prefix(processing_prefix)
        if keys:
            for key in keys:
                try:
                    delete_from_s3(key)
                except Exception as exc:
                    errors.append(f"s3:{key}:{exc}")
            logger.info(f"[cleanup] Deleted {len(keys)} S3 processing files for job {job_id}")
        else:
            logger.debug(f"[cleanup] No S3 processing files found for job {job_id}")
    except Exception as exc:
        errors.append(f"s3_list:{exc}")
        logger.warning(f"[cleanup] S3 list failed for job {job_id}: {exc}")

    # 3. Notify backend to mark temp files as deleted in DB
    try:
        with httpx.Client(timeout=10) as client:
            client.post(
                f"{settings.backend_url}/internal/cleanup-complete",
                json={"job_id": job_id, "errors": errors},
                headers={"X-Internal-API-Key": settings.internal_api_key},
            )
    except Exception as exc:
        logger.warning(f"[cleanup] Failed to notify backend of cleanup completion: {exc}")

    if errors:
        logger.warning(f"[cleanup] Job {job_id} cleanup completed with {len(errors)} error(s): {errors}")
    else:
        logger.info(f"[cleanup] Job {job_id} temp files fully cleaned")


# ═════════════════════════════════════════════════════════════════
# PERIODIC SWEEPS (triggered by Celery Beat)
# ═════════════════════════════════════════════════════════════════

@celery_app.task(
    name="sweep_expired_temp_files",
    queue="cleanup",
    ignore_result=True,
)
def sweep_expired_temp_files() -> None:
    """
    Periodic task: ask backend for all expired temp file records
    and delete them from S3 + local storage.

    Runs every 30 minutes via beat schedule.
    """
    logger.info("[sweep] Starting expired temp file sweep")
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(
                f"{settings.backend_url}/internal/expired-temp-files",
                headers={"X-Internal-API-Key": settings.internal_api_key},
                params={"limit": 200},
            )
            resp.raise_for_status()
            items: list[dict] = resp.json().get("items", [])
    except Exception as exc:
        logger.error(f"[sweep] Failed to fetch expired temp files: {exc}")
        return

    if not items:
        logger.debug("[sweep] No expired temp files found")
        return

    deleted_ids: list[int] = []
    for item in items:
        file_id      = item["id"]
        file_path    = item["file_path"]
        storage_back = item.get("storage_backend", "local")
        try:
            if storage_back == "s3":
                delete_from_s3(file_path)
            else:
                p = Path(file_path)
                if p.exists():
                    p.unlink()
            deleted_ids.append(file_id)
        except Exception as exc:
            logger.warning(f"[sweep] Could not delete {file_path}: {exc}")

    if deleted_ids:
        try:
            with httpx.Client(timeout=10) as client:
                client.post(
                    f"{settings.backend_url}/internal/mark-files-deleted",
                    json={"ids": deleted_ids},
                    headers={"X-Internal-API-Key": settings.internal_api_key},
                )
        except Exception as exc:
            logger.warning(f"[sweep] Failed to mark files deleted in DB: {exc}")

    logger.info(f"[sweep] Deleted {len(deleted_ids)} expired temp files")


@celery_app.task(
    name="sweep_expired_outputs",
    queue="cleanup",
    ignore_result=True,
)
def sweep_expired_outputs() -> None:
    """
    Periodic task: delete final output files (preview MP3, WAV, full MP3)
    whose S3 expiry has passed.

    Runs every 6 hours via beat schedule.
    Queries backend for final_outputs rows where expires_at < NOW().
    """
    logger.info("[sweep_outputs] Starting expired output sweep")
    try:
        with httpx.Client(timeout=30) as client:
            resp = client.get(
                f"{settings.backend_url}/internal/expired-outputs",
                headers={"X-Internal-API-Key": settings.internal_api_key},
                params={"limit": 100},
            )
            resp.raise_for_status()
            outputs: list[dict] = resp.json().get("outputs", [])
    except Exception as exc:
        logger.error(f"[sweep_outputs] Failed to fetch expired outputs: {exc}")
        return

    if not outputs:
        logger.debug("[sweep_outputs] No expired outputs found")
        return

    deleted_job_ids: list[str] = []
    for out in outputs:
        job_id = out["job_id"]
        for key_field in ("preview_mp3_url", "full_wav_url", "full_mp3_url"):
            s3_key = out.get(key_field)
            if s3_key:
                try:
                    delete_from_s3(s3_key)
                except Exception as exc:
                    logger.warning(f"[sweep_outputs] Could not delete {s3_key}: {exc}")
        deleted_job_ids.append(job_id)

    if deleted_job_ids:
        try:
            with httpx.Client(timeout=10) as client:
                client.post(
                    f"{settings.backend_url}/internal/mark-outputs-expired",
                    json={"job_ids": deleted_job_ids},
                    headers={"X-Internal-API-Key": settings.internal_api_key},
                )
        except Exception as exc:
            logger.warning(f"[sweep_outputs] Failed to mark outputs expired in DB: {exc}")

    logger.info(f"[sweep_outputs] Expired {len(deleted_job_ids)} output sets")


@celery_app.task(
    name="prune_stale_worker_nodes",
    queue="cleanup",
    ignore_result=True,
)
def prune_stale_worker_nodes() -> None:
    """
    Periodic task: mark workers as 'offline' if their last heartbeat
    was more than 2 minutes ago.

    Runs every 5 minutes via beat schedule.
    """
    logger.debug("[prune_workers] Running stale worker check")
    try:
        with httpx.Client(timeout=10) as client:
            client.post(
                f"{settings.backend_url}/internal/prune-stale-workers",
                json={"stale_threshold_seconds": 120},
                headers={"X-Internal-API-Key": settings.internal_api_key},
            )
    except Exception as exc:
        logger.warning(f"[prune_workers] Failed to prune stale workers: {exc}")


# ═════════════════════════════════════════════════════════════════
# COST RECORDING
# ═════════════════════════════════════════════════════════════════

@celery_app.task(
    name="record_job_cost",
    queue="cleanup",
    ignore_result=True,
)
def record_job_cost(
    job_id:         str,
    user_plan:      str,
    gpu_seconds:    int,
    cpu_seconds:    int,
    s3_bytes_temp:  int,
    s3_bytes_output:int,
    worker_hostname:str,
) -> None:
    """
    Record resource consumption for completed job.
    Called from tasks.py after Stage 7 completes.
    """
    cost_usd = estimate_job_cost(gpu_seconds, cpu_seconds)
    try:
        with httpx.Client(timeout=10) as client:
            client.post(
                f"{settings.backend_url}/internal/record-job-cost",
                json={
                    "job_id":           job_id,
                    "user_plan":        user_plan,
                    "gpu_seconds":      gpu_seconds,
                    "cpu_seconds":      cpu_seconds,
                    "s3_bytes_temp":    s3_bytes_temp,
                    "s3_bytes_output":  s3_bytes_output,
                    "estimated_cost_usd": cost_usd,
                    "worker_hostname":  worker_hostname,
                },
                headers={"X-Internal-API-Key": settings.internal_api_key},
            )
        logger.info(
            f"[cost] Job {job_id} cost recorded: "
            f"gpu={gpu_seconds}s cpu={cpu_seconds}s est=${cost_usd:.4f}"
        )
    except Exception as exc:
        logger.warning(f"[cost] Failed to record cost for job {job_id}: {exc}")


# ═════════════════════════════════════════════════════════════════
# JOB COMPLETION NOTIFICATION
# ═════════════════════════════════════════════════════════════════

@celery_app.task(
    name="send_job_complete_notification",
    queue="notifications",
    max_retries=3,
    default_retry_delay=60,
    ignore_result=True,
)
def send_job_complete_notification(
    job_id:      str,
    user_email:  str,
    user_name:   str,
    preview_url: str,
    plan:        str,
) -> None:
    """
    Dispatch email notification when a job completes successfully.
    Backend mailer.ts already has the HTML templates.
    We call the internal route to trigger it from there (single source of truth).
    """
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                f"{settings.backend_url}/internal/send-completion-email",
                json={
                    "job_id":      job_id,
                    "user_email":  user_email,
                    "user_name":   user_name,
                    "preview_url": preview_url,
                    "plan":        plan,
                },
                headers={"X-Internal-API-Key": settings.internal_api_key},
            )
            resp.raise_for_status()
        logger.info(f"[notify] Completion email sent for job {job_id} to {user_email}")
    except Exception as exc:
        logger.warning(f"[notify] Failed to send completion email for job {job_id}: {exc}")
        raise self.retry(exc=exc)
