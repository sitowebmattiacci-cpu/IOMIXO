"""
IOMIXO Real AI Engine — local dev server (no Celery/Redis required).

Thin FastAPI shell. The actual generation logic lives in
:mod:`pipeline` as a stage-based :class:`PipelineOrchestrator`.
"""

import os
import sys
import socket
import asyncio
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
import httpx
from loguru import logger

# ── Add ai-engine dir to path ────────────────────────────────────────────────
_HERE = Path(__file__).parent
sys.path.insert(0, str(_HERE))

# Make sure HOME/bin is in PATH for ffmpeg / redis-server
_home_bin = str(Path.home() / "bin")
if _home_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _home_bin + ":" + os.environ.get("PATH", "")

from config import get_settings  # noqa: E402
from pipeline import PipelineOrchestrator, build_default_pipeline  # noqa: E402

settings = get_settings()
_WORKER_ID = socket.gethostname()

_executor = ThreadPoolExecutor(max_workers=2)

# ─────────────────────────────────────────────────────────────────────────────


def report_progress(
    job_id: str,
    status: str,
    progress: int,
    current_stage: str,
    stage_progress: dict,
    error_message: str | None = None,
    output: dict | None = None,
    analysis_a: dict | None = None,
    analysis_b: dict | None = None,
    cached_analysis: dict | None = None,
):
    """HTTP transport for pipeline progress events."""
    payload = {
        "job_id":          job_id,
        "status":          status,
        "progress":        progress,
        "current_stage":   current_stage,
        "stage_progress":  stage_progress,
        "error_message":   error_message,
        "output":          output,
        "analysis_a":      analysis_a,
        "analysis_b":      analysis_b,
        "cached_analysis": cached_analysis,
    }
    try:
        with httpx.Client(timeout=10) as client:
            client.post(
                f"{settings.backend_url}/internal/job-update",
                json=payload,
                headers={"X-Internal-API-Key": settings.internal_api_key},
            )
    except Exception as exc:
        logger.warning(f"[{job_id}] Failed to report progress: {exc}")


def run_pipeline(payload: dict) -> None:
    """Entry point used by the FastAPI handler / thread executor."""
    from pipeline import build_pipeline_for_mode  # noqa: WPS433
    mode = payload.get("mode", "full")
    orchestrator = PipelineOrchestrator(
        stages=build_pipeline_for_mode(mode),
        transport=report_progress,
        tmp_dir=settings.tmp_dir,
    )
    orchestrator.run(payload)


# ── FastAPI app ───────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("IOMIXO Real Engine starting")
    yield
    logger.info("IOMIXO Real Engine shutting down")
    _executor.shutdown(wait=False)


app = FastAPI(title="IOMIXO Real Engine", version="1.0.0", lifespan=lifespan)


def _verify_key(key: str | None):
    if key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health():
    return {"status": "ok", "mode": "real"}


class JobRequest(BaseModel):
    job_id:                 str
    project_id:             str
    user_id:                str
    track_a_s3_key:         str
    track_b_s3_key:         str
    remix_style:            str
    output_quality:         str
    user_plan:              str = "free"
    remix_director_params:  dict | None = None
    # Preview/Full split
    mode:                   str = "full"        # 'preview' | 'full'
    preview_duration_sec:   int = 30
    cached_analysis:        dict | None = None
    parent_job_id:          str | None = None


@app.post("/jobs/start")
@app.post("/api/v1/jobs/process")
async def start_job(
    req: JobRequest,
    x_internal_api_key: str | None = Header(default=None),
):
    _verify_key(x_internal_api_key)
    logger.info(f"Running pipeline synchronously for job {req.job_id}")
    # Run the full pipeline inline in a worker thread so the HTTP request stays
    # open for the entire duration. This prevents Cloud Run from scaling the
    # instance down mid-job (background threads do not survive scale-to-zero).
    await asyncio.get_event_loop().run_in_executor(
        _executor, run_pipeline, req.model_dump()
    )
    return {"job_id": req.job_id, "status": "complete"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
