"""
Redis-based job checkpointing for MASHFUSION AI pipeline.

After each pipeline stage completes, the worker writes a checkpoint
to Redis. If the Celery task fails and is retried (max_retries=2),
the task resumes from the last completed stage instead of restarting
from scratch — saving GPU time and avoiding duplicate S3 uploads.

Key format:  mf:checkpoint:{job_id}
TTL:         48 hours (covers longest job + max retry window)
"""

from __future__ import annotations

import json
import time
from typing import Any

import redis as redis_lib

from config import get_settings

settings = get_settings()

_CHECKPOINT_PREFIX = "mf:checkpoint:"
_CHECKPOINT_TTL    = 172_800   # 48 hours in seconds
_LOCK_PREFIX       = "mf:cp_lock:"
_LOCK_TTL          = 30        # seconds


def _client() -> redis_lib.Redis:
    return redis_lib.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )


# ─────────────────────────────────────────────────────────────────
# Core checkpoint operations
# ─────────────────────────────────────────────────────────────────

def save_checkpoint(
    job_id:      str,
    stage:       str,
    stages:      dict,
    extra:       dict | None = None,
    worker_id:   str | None = None,
) -> None:
    """
    Persist stage completion state to Redis after a stage finishes.

    Args:
        job_id:    render_jobs UUID
        stage:     name of the just-completed stage
        stages:    full stage_progress dict (all stages, all statuses)
        extra:     arbitrary kv pairs saved alongside (e.g. intermediate S3 keys)
        worker_id: celery worker hostname for traceability
    """
    try:
        client = _client()
        key    = f"{_CHECKPOINT_PREFIX}{job_id}"

        existing_raw = client.get(key)
        existing     = json.loads(existing_raw) if existing_raw else {}

        payload = {
            "job_id":                job_id,
            "last_completed_stage":  stage,
            "stages":                stages,
            "extra":                 {**(existing.get("extra") or {}), **(extra or {})},
            "retry_count":           existing.get("retry_count", 0),
            "worker_id":             worker_id or existing.get("worker_id"),
            "saved_at":              time.time(),
        }

        client.setex(key, _CHECKPOINT_TTL, json.dumps(payload))
    except Exception:
        # Checkpoint failures must never break the pipeline
        pass


def increment_retry(job_id: str) -> int:
    """
    Atomically increment the retry counter inside the checkpoint.
    Called at the start of each task attempt.
    Returns the new retry count.
    """
    try:
        client = _client()
        key    = f"{_CHECKPOINT_PREFIX}{job_id}"
        raw    = client.get(key)

        if raw:
            data = json.loads(raw)
        else:
            data = {"job_id": job_id, "retry_count": 0, "stages": {}, "extra": {}}

        data["retry_count"] = data.get("retry_count", 0) + 1
        client.setex(key, _CHECKPOINT_TTL, json.dumps(data))
        return data["retry_count"]
    except Exception:
        return 0


def load_checkpoint(job_id: str) -> dict | None:
    """
    Load the checkpoint for a job.
    Returns None if no checkpoint exists (first attempt or already cleared).
    """
    try:
        client = _client()
        raw    = client.get(f"{_CHECKPOINT_PREFIX}{job_id}")
        return json.loads(raw) if raw else None
    except Exception:
        return None


def clear_checkpoint(job_id: str) -> None:
    """Remove checkpoint after successful job completion."""
    try:
        _client().delete(f"{_CHECKPOINT_PREFIX}{job_id}")
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────
# Checkpoint inspection helpers
# ─────────────────────────────────────────────────────────────────

def get_completed_stages(checkpoint: dict | None) -> set[str]:
    """
    Return set of stage names already finished in the checkpoint.
    A stage is considered done if status is 'complete' or 'skipped'.
    """
    if not checkpoint:
        return set()
    return {
        name
        for name, data in checkpoint.get("stages", {}).items()
        if data.get("status") in ("complete", "skipped")
    }


def get_extra(checkpoint: dict | None, key: str, default: Any = None) -> Any:
    """Retrieve a value from the checkpoint's extra dict."""
    if not checkpoint:
        return default
    return (checkpoint.get("extra") or {}).get(key, default)


def get_intermediate_key(checkpoint: dict | None, name: str) -> str | None:
    """
    Get a previously uploaded S3 key stored in the checkpoint.
    Prevents re-uploading stems that were already written on a previous attempt.
    """
    return get_extra(checkpoint, f"s3_key_{name}")


def save_intermediate_key(job_id: str, name: str, s3_key: str) -> None:
    """Store an intermediate S3 key so retries can skip re-upload."""
    try:
        client = _client()
        key    = f"{_CHECKPOINT_PREFIX}{job_id}"
        raw    = client.get(key)
        data   = json.loads(raw) if raw else {
            "job_id": job_id, "stages": {}, "extra": {}, "retry_count": 0
        }
        extra  = data.get("extra") or {}
        extra[f"s3_key_{name}"] = s3_key
        data["extra"] = extra
        client.setex(key, _CHECKPOINT_TTL, json.dumps(data))
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────
# Stage skip helper — used in tasks.py
# ─────────────────────────────────────────────────────────────────

def should_skip_stage(stage_name: str, completed: set[str]) -> bool:
    """
    Returns True if this stage was already completed in a prior attempt
    and should be skipped on the current retry run.
    """
    return stage_name in completed
