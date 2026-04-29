"""
Job routing logic for MASHFUSION AI workers.

Determines queue assignment, task priority, and processing gates
based on job type and user plan.

Queue topology:
  gpu_heavy    — Demucs 6s stem separation (GPU required, concurrency=1)
  cpu_standard — Analysis, harmonic match, composition, style, mastering
  rendering    — MP3/WAV export + S3 upload (I/O bound)
  cleanup      — Temp file deletion + S3 expiry sweeps (high concurrency)
  notifications— Email dispatch (low latency required)
"""

from __future__ import annotations
from enum import Enum


# ── Queue names ────────────────────────────────────────────────
class Queue(str, Enum):
    GPU_HEAVY     = "gpu_heavy"
    CPU_STANDARD  = "cpu_standard"
    RENDERING     = "rendering"
    CLEANUP       = "cleanup"
    NOTIFICATIONS = "notifications"


# ── Stage → queue mapping ──────────────────────────────────────
# Each pipeline stage is routed to the queue whose worker pool
# best suits the workload profile.
STAGE_QUEUE_MAP: dict[str, Queue] = {
    "stem_separation":    Queue.GPU_HEAVY,
    "music_analysis":     Queue.CPU_STANDARD,
    "harmonic_matching":  Queue.CPU_STANDARD,
    "mashup_composition": Queue.CPU_STANDARD,
    "sound_modernization":Queue.CPU_STANDARD,
    "mastering":          Queue.CPU_STANDARD,
    "rendering":          Queue.RENDERING,
    "cleanup":            Queue.CLEANUP,
    "notification":       Queue.NOTIFICATIONS,
}

# ── Priority — lower integer = higher priority (Celery) ────────
PLAN_PRIORITY: dict[str, int] = {
    "studio": 1,
    "pro":    5,
    "free":   10,
}

# ── Free user concurrency cap (per worker pool) ────────────────
# When active_free_jobs >= this threshold, new free jobs are
# pushed to the back of the queue (priority=10 is already low,
# but this flag lets the backend add a queue delay on dispatch).
FREE_CONCURRENCY_CAP = 2

# ── Output file gating by plan ─────────────────────────────────
# Controls whether full WAV master is rendered (heavy file).
WAV_ELIGIBLE_PLANS = frozenset({"pro", "studio"})

# ── S3 lifecycle windows (seconds) ────────────────────────────
# These values are used by cleanup tasks AND written into
# job_temp_files.expires_at on file creation.
TEMP_FILE_TTL: dict[str, int] = {
    "free":   7_200,     # 2 h  — stems deleted 2 h after completion
    "pro":    43_200,    # 12 h
    "studio": 86_400,    # 24 h
}

OUTPUT_FILE_TTL: dict[str, int] = {
    "free":   604_800,    # 7 days
    "pro":    2_592_000,  # 30 days
    "studio": 7_776_000,  # 90 days
}

# ── Estimated compute cost rates (USD/second) ─────────────────
# Used by job_cost_tracking. Based on RunPod spot pricing.
COST_RATE_GPU_USD_PER_SEC  = 0.00025   # RTX A4000 ~$0.90/hr spot
COST_RATE_CPU_USD_PER_SEC  = 0.000005  # 4-vCPU container

# ── Worker type → queues it must consume ──────────────────────
WORKER_QUEUE_MAP: dict[str, list[str]] = {
    "gpu":     [Queue.GPU_HEAVY],
    "cpu":     [Queue.CPU_STANDARD, Queue.RENDERING],
    "cleanup": [Queue.CLEANUP, Queue.NOTIFICATIONS],
    "beat":    [],
}


# ═════════════════════════════════════════════════════════════════
# Public API
# ═════════════════════════════════════════════════════════════════

def get_primary_queue(user_plan: str = "free") -> str:
    """
    Primary mashup jobs always enter on gpu_heavy.
    The GPU worker hands off subtasks to cpu_standard/rendering
    via enqueue_stage_subtask() once stem separation is done.
    """
    return Queue.GPU_HEAVY.value


def get_priority(user_plan: str) -> int:
    """Celery task priority for a given user plan."""
    return PLAN_PRIORITY.get(user_plan, PLAN_PRIORITY["free"])


def should_throttle_free_user(active_free_jobs: int) -> bool:
    """
    True when the number of actively processing free jobs has
    reached the concurrency cap.
    """
    return active_free_jobs >= FREE_CONCURRENCY_CAP


def should_render_wav(user_plan: str, output_quality: str) -> bool:
    """
    WAV master is only rendered for pro/studio users.
    Free users receive preview MP3 only.
    """
    if user_plan not in WAV_ELIGIBLE_PLANS:
        return False
    return output_quality in ("standard", "professional")


def get_temp_ttl(user_plan: str) -> int:
    """Seconds until temp/stem files should be deleted after job completion."""
    return TEMP_FILE_TTL.get(user_plan, TEMP_FILE_TTL["free"])


def get_output_ttl(user_plan: str) -> int:
    """Seconds final output files remain accessible in S3."""
    return OUTPUT_FILE_TTL.get(user_plan, OUTPUT_FILE_TTL["free"])


def estimate_job_cost(gpu_seconds: int, cpu_seconds: int) -> float:
    """
    Rough USD cost estimate for a completed job.
    Written to job_cost_tracking for infra analytics.
    """
    return round(
        gpu_seconds * COST_RATE_GPU_USD_PER_SEC
        + cpu_seconds * COST_RATE_CPU_USD_PER_SEC,
        6,
    )


def get_queues_for_worker_type(worker_type: str) -> list[str]:
    """Return the list of queues a worker of this type should consume."""
    return [q.value for q in WORKER_QUEUE_MAP.get(worker_type, [])]
