"""
Celery application factory for MASHFUSION AI.

Queue topology:
  gpu_heavy     — Demucs stem separation (GPU workers only, concurrency=1)
  cpu_standard  — Analysis, composition, style, mastering (CPU workers)
  rendering     — MP3/WAV export + S3 upload (CPU workers, I/O bound)
  cleanup       — Temp file + S3 expiry deletions (high concurrency)
  notifications — Email / webhook dispatch

Beat schedule:
  Every 30 min  — sweep_expired_temp_files
  Every 6 h     — sweep_expired_outputs
  Every 5 min   — prune_stale_worker_nodes
"""

from celery import Celery
from celery.schedules import crontab
from config import get_settings

settings = get_settings()

celery_app = Celery(
    "mashfusion",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "workers.tasks",
        "workers.cleanup_tasks",
    ],
)

celery_app.conf.update(
    # ── Serialization ────────────────────────────────────────────
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    # ── Time & timezone ──────────────────────────────────────────
    timezone="UTC",
    enable_utc=True,

    # ── Reliability ──────────────────────────────────────────────
    # task_acks_late=True: message only removed from queue after task
    # returns, NOT when it's received. Crash-safe.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,          # one task at a time per slot
    worker_max_tasks_per_child=20,         # recycle worker after N tasks (free GPU/CPU memory)

    # ── Time limits ──────────────────────────────────────────────
    task_time_limit=4200,                  # 70 min hard kill (Demucs on long tracks)
    task_soft_time_limit=4000,             # 66 min soft — raises SoftTimeLimitExceeded

    # ── Result backend ───────────────────────────────────────────
    result_expires=86_400,                 # store results for 24 h then auto-expire

    # ── Queue definitions ────────────────────────────────────────
    # Separate queues allow separate worker pools. Priority within
    # each queue is enforced via task.apply_async(priority=N).
    task_queues={
        "gpu_heavy":     {"exchange": "gpu_heavy",    "routing_key": "gpu_heavy"},
        "cpu_standard":  {"exchange": "cpu_standard", "routing_key": "cpu_standard"},
        "rendering":     {"exchange": "rendering",    "routing_key": "rendering"},
        "cleanup":       {"exchange": "cleanup",      "routing_key": "cleanup"},
        "notifications": {"exchange": "notifications","routing_key": "notifications"},
    },
    task_default_queue="cpu_standard",
    task_default_exchange="cpu_standard",
    task_default_routing_key="cpu_standard",

    # ── Task routing (task name → queue) ─────────────────────────
    task_routes={
        "process_mashup_job":              {"queue": "gpu_heavy"},
        "cleanup_job_temp_files":          {"queue": "cleanup"},
        "sweep_expired_temp_files":        {"queue": "cleanup"},
        "sweep_expired_outputs":           {"queue": "cleanup"},
        "prune_stale_worker_nodes":        {"queue": "cleanup"},
        "record_job_cost":                 {"queue": "cleanup"},
        "send_job_complete_notification":  {"queue": "notifications"},
    },

    # ── Beat schedule (periodic tasks) ───────────────────────────
    beat_schedule={
        "sweep-expired-temp-files": {
            "task":     "sweep_expired_temp_files",
            "schedule": 1800,   # every 30 minutes
            "options":  {"queue": "cleanup"},
        },
        "sweep-expired-outputs": {
            "task":     "sweep_expired_outputs",
            "schedule": crontab(minute=0, hour="*/6"),   # every 6 hours
            "options":  {"queue": "cleanup"},
        },
        "prune-stale-workers": {
            "task":     "prune_stale_worker_nodes",
            "schedule": 300,    # every 5 minutes
            "options":  {"queue": "cleanup"},
        },
    },
)
