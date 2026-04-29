import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Request
from pydantic import BaseModel
from loguru import logger

from config import get_settings
from workers.tasks import process_mashup_job

settings = get_settings()

os.makedirs(settings.tmp_dir, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("IOMIXO Engine starting up")
    yield
    logger.info("IOMIXO Engine shutting down")


app = FastAPI(
    title="IOMIXO Engine",
    version="1.0.0",
    lifespan=lifespan,
)


def _verify_internal_key(key: str | None):
    if key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Health ─────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Dispatch job ───────────────────────────────────────────────
class JobRequest(BaseModel):
    job_id:         str
    project_id:     str
    user_id:        str
    track_a_s3_key: str
    track_b_s3_key: str
    remix_style:    str
    output_quality: str


@app.post("/api/v1/jobs/process")
async def dispatch_job(
    payload: JobRequest,
    x_internal_api_key: str | None = Header(default=None, alias="X-Internal-API-Key"),
):
    _verify_internal_key(x_internal_api_key)
    logger.info(f"Dispatching job {payload.job_id} to Celery")
    process_mashup_job.apply_async(
        args=[payload.model_dump()],
        task_id=payload.job_id,
    )
    return {"queued": True, "job_id": payload.job_id}
