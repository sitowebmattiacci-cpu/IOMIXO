import os
import base64
import io
import math
import wave
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header
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


# ── Prompt-based sound generation (compat endpoint) ─────────────
class GenerateSoundRequest(BaseModel):
    prompt: str
    bpm: float = 120.0
    duration: float = 2.0


def _render_simple_wave(duration: float, bpm: float, prompt: str) -> bytes:
    """Lightweight synthesis fallback so /ai-tools/generate-sound never 404s."""
    sr = 44100
    total = int(max(0.1, min(120.0, duration)) * sr)
    p = prompt.lower()
    if "kick" in p:
        freq = 55.0
    elif "bass" in p:
        freq = 80.0
    elif "snare" in p:
        freq = 200.0
    elif "pad" in p:
        freq = 320.0
    else:
        freq = 180.0

    attack = 0.005 if ("sharp" in p or "punchy" in p) else 0.02
    decay = 0.22 if ("short" in p or "gated" in p) else max(0.35, min(duration, 1.2))
    beat = max(0.5, bpm / 60.0)

    pcm = io.BytesIO()
    with wave.open(pcm, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        frames = bytearray()
        for i in range(total):
            t = i / sr
            env = min(1.0, t / attack) * math.exp(-t / decay)
            if "loop" in p:
                env *= 0.4 + 0.6 * max(0.0, math.sin(2 * math.pi * beat * t))
            f = freq
            if "kick" in p:
                f = max(30.0, freq * math.exp(-t * 7.5))
            s = math.sin(2 * math.pi * f * t) * env
            # headroom-safe soft clip
            s = math.tanh(s * 0.9)
            iv = int(max(-1.0, min(1.0, s)) * 32767.0)
            frames += int(iv).to_bytes(2, byteorder="little", signed=True)
        wf.writeframes(bytes(frames))
    return pcm.getvalue()


@app.post("/ai-tools/generate-sound")
async def generate_sound(
    payload: GenerateSoundRequest,
    x_internal_api_key: str | None = Header(default=None, alias="X-Internal-API-Key"),
):
    _verify_internal_key(x_internal_api_key)
    wav = _render_simple_wave(payload.duration, payload.bpm, payload.prompt)
    return {
        "audio_base64": base64.b64encode(wav).decode("ascii"),
        "duration": max(0.1, min(120.0, payload.duration)),
        "sample_rate": 44100,
    }
