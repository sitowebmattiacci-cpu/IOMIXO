"""
IOMIXO Real AI Engine — local dev server (no Celery/Redis required).

Thin FastAPI shell. The actual generation logic lives in
:mod:`pipeline` as a stage-based :class:`PipelineOrchestrator`.
"""

import os
import sys
import socket
import asyncio
import base64
import io
import math
import wave
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header
from fastapi.staticfiles import StaticFiles
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
_GENERATED_SOUND_DIR = Path(settings.tmp_dir) / "generated_sounds"
_GENERATED_SOUND_DIR.mkdir(parents=True, exist_ok=True)

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
    project_mode = payload.get("project_mode", "mashup")
    orchestrator = PipelineOrchestrator(
        stages=build_pipeline_for_mode(project_mode),
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
    track_b_s3_key:         str | None = None
    remix_style:            str = "none"
    output_quality:         str = "standard"
    user_plan:              str = "free"
    remix_director_params:  dict | None = None
    cached_analysis:        dict | None = None
    # Legacy field retained for callsite compatibility — ignored by the
    # post-pivot orchestrator, which always runs the seed pipeline.
    mode:                   str = "full"
    # Product mode picked in the wizard:
    #   'mashup' (default) → two tracks, AI seeds clips on the timeline
    #   'remix'            → single track, stems separated, empty timeline
    project_mode:           str = "mashup"


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


# ── Render-from-arrangement (Phase 1) ────────────────────────────────────────
class ArrangementRenderRequest(BaseModel):
    job_id:         str
    project_id:     str
    user_id:        str
    arrangement:    dict          # validated as schemas.arrangement.Arrangement
    user_plan:      str = "free"
    output_quality: str = "standard"


def _run_arrangement_render(payload: dict) -> dict:
    from schemas.arrangement import Arrangement
    from services.arrangement_renderer import render_and_upload

    arrangement = Arrangement.model_validate(payload["arrangement"])
    job_id = payload["job_id"]

    report_progress(
        job_id, "processing", 5, "rendering", {"rendering": {"status": "running", "progress": 5}},
    )
    try:
        result = render_and_upload(
            arrangement,
            job_id=job_id,
            user_plan=payload.get("user_plan", "free"),
            output_quality=payload.get("output_quality", "standard"),
        )
    except Exception as exc:
        logger.error(f"[{job_id}] Arrangement render failed: {exc}")
        report_progress(
            job_id, "failed", 0, "rendering", {"rendering": {"status": "failed"}},
            error_message=str(exc),
        )
        raise

    output = {
        "preview_mp3_url": result["preview_mp3_url"],
        "full_mp3_url":    result["preview_mp3_url"],
        "full_wav_url":    result.get("full_wav_url"),
        "duration_sec":    result.get("duration_sec"),
        "lufs":            result.get("lufs"),
    }
    report_progress(
        job_id, "complete", 100, "rendering", {"rendering": {"status": "complete", "progress": 100}},
        output=output,
    )
    return output


@app.post("/render/arrangement")
async def render_arrangement(
    req: ArrangementRenderRequest,
    x_internal_api_key: str | None = Header(default=None),
):
    _verify_key(x_internal_api_key)
    logger.info(f"Rendering arrangement for job {req.job_id} (project {req.project_id})")
    output = await asyncio.get_event_loop().run_in_executor(
        _executor, _run_arrangement_render, req.model_dump()
    )
    return {"job_id": req.job_id, "status": "complete", "output": output}


# ── Sync-to-beat (clip-level audio analysis) ────────────────────────────────
class SyncToBeatClip(BaseModel):
    clip_id:    str
    asset_kind: str
    asset_ref:  str
    start_sec:  float
    end_sec:    float
    offset_sec: float


class SyncToBeatRequest(BaseModel):
    project_bpm: float
    grid:        str  # 'bar' | 'beat' | 'half'
    clips:       list[SyncToBeatClip]


def _run_sync_to_beat(payload: dict) -> list[dict]:
    from services.clip_sync_analyzer import analyze_clip_for_sync

    results: list[dict] = []
    for clip in payload["clips"]:
        try:
            results.append(analyze_clip_for_sync(
                clip_id=clip["clip_id"],
                asset_kind=clip["asset_kind"],
                asset_ref=clip["asset_ref"],
                project_bpm=float(payload["project_bpm"]),
                grid=payload["grid"],
                start_sec=float(clip["start_sec"]),
                end_sec=float(clip["end_sec"]),
                offset_sec=float(clip["offset_sec"]),
            ))
        except Exception as exc:
            logger.warning(f"sync-to-beat failed for clip {clip.get('clip_id')}: {exc}")
            results.append({
                "clip_id":              clip["clip_id"],
                "bpm":                  None,
                "confidence":           0.0,
                "suggested_start_sec":  float(clip["start_sec"]),
                "suggested_offset_sec": float(clip["offset_sec"]),
                "time_stretch_ratio":   1.0,
                "fade_in_sec":          0.0,
            })
    return results


@app.post("/ai-tools/sync-to-beat")
async def sync_to_beat(
    req: SyncToBeatRequest,
    x_internal_api_key: str | None = Header(default=None),
):
    _verify_key(x_internal_api_key)
    if not req.clips:
        raise HTTPException(status_code=400, detail="No clips provided")
    suggestions = await asyncio.get_event_loop().run_in_executor(
        _executor, _run_sync_to_beat, req.model_dump()
    )
    return {"suggestions": suggestions}


# ── Prompt-based sound generation (MVP synthesis) ─────────────────────────────
class GenerateSoundRequest(BaseModel):
    prompt: str
    bpm: float = 120.0
    duration: float = 2.0


def _synth_from_prompt(payload: dict) -> dict:
    prompt = str(payload.get("prompt", "")).lower()
    bpm = max(20.0, min(300.0, float(payload.get("bpm", 120.0))))
    duration = max(0.1, min(120.0, float(payload.get("duration", 2.0))))
    sr = 44100
    total = int(duration * sr)

    is_kick = "kick" in prompt
    is_snare = "snare" in prompt
    is_bass = "bass" in prompt
    is_pad = "pad" in prompt
    is_fx = "fx" in prompt or "riser" in prompt or "transition" in prompt
    is_loop = "loop" in prompt

    attack_ms = 5.0
    decay_s = 0.25
    if "soft" in prompt:
        attack_ms = 20.0
    if "sharp" in prompt or "punchy" in prompt:
        attack_ms = 2.0
    if "long" in prompt or "ambient" in prompt:
        decay_s = max(decay_s, duration * 0.9)
    if "short" in prompt or "gated" in prompt:
        decay_s = min(decay_s, 0.18)

    # Base frequency profile by sound role.
    base_hz = 220.0
    if is_kick:
        base_hz = 58.0
    elif is_snare:
        base_hz = 190.0
    elif is_bass:
        base_hz = 72.0
    elif is_pad:
        base_hz = 330.0
    elif is_fx:
        base_hz = 440.0

    # Energy and texture shaping.
    drive = 0.9
    if "high" in prompt:
        drive = 1.25
    elif "low" in prompt:
        drive = 0.65
    noise_mix = 0.02
    if "gritty" in prompt:
        noise_mix = 0.08
    elif "clean" in prompt:
        noise_mix = 0.0

    # Build waveform in float [-1, 1].
    data: list[float] = [0.0] * total
    rnd = 1103515245  # deterministic LCG seed for stable output
    attack_s = max(0.001, attack_ms / 1000.0)
    beat_hz = bpm / 60.0

    for i in range(total):
        t = i / sr
        env_attack = min(1.0, t / attack_s)
        env_decay = math.exp(-t / max(0.01, decay_s))
        env = env_attack * env_decay

        # Optional loop gating for rhythmic one-shots/loops.
        if is_loop:
            gate = 0.5 + 0.5 * math.sin(2 * math.pi * beat_hz * t)
            env *= 0.35 + 0.65 * max(0.0, gate)

        # Slight movement when requested.
        mod = 1.0
        if "evolving" in prompt or "modulated" in prompt:
            mod = 1.0 + 0.02 * math.sin(2 * math.pi * 0.3 * t)
        freq = base_hz * mod
        if is_kick:
            freq = max(30.0, base_hz * math.exp(-t * 8.5))

        osc = math.sin(2 * math.pi * freq * t)
        if is_pad:
            osc = 0.6 * osc + 0.4 * math.sin(2 * math.pi * (freq * 0.5) * t)
        if is_fx:
            osc = 0.55 * osc + 0.45 * math.sin(2 * math.pi * (freq + t * 160.0) * t)

        # Lightweight deterministic noise without numpy/random dependency.
        rnd = (rnd * 1103515245 + 12345) & 0x7FFFFFFF
        noise = ((rnd / 0x7FFFFFFF) * 2.0 - 1.0) * noise_mix

        sample = (osc + noise) * env * drive
        # Soft clip to keep it mix-ready and avoid hard clipping.
        data[i] = math.tanh(sample)

    # Normalize with conservative headroom.
    peak = max(1e-6, max(abs(v) for v in data))
    norm = min(0.85 / peak, 1.0)

    pcm = io.BytesIO()
    with wave.open(pcm, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        frames = bytearray()
        for v in data:
            s = max(-1.0, min(1.0, v * norm))
            iv = int(s * 32767.0)
            frames += int(iv).to_bytes(2, byteorder="little", signed=True)
        wf.writeframes(bytes(frames))

    raw = pcm.getvalue()
    filename = f"{uuid.uuid4()}.wav"
    out_path = _GENERATED_SOUND_DIR / filename
    out_path.write_bytes(raw)

    return {
        "audio_base64": base64.b64encode(raw).decode("ascii"),
        "audio_path": str(out_path),
        "audio_url": f"/generated-audio/{filename}",
        "duration": duration,
        "sample_rate": sr,
    }


@app.post("/ai-tools/generate-sound")
async def generate_sound(
    req: GenerateSoundRequest,
    x_internal_api_key: str | None = Header(default=None),
):
    _verify_key(x_internal_api_key)
    payload = await asyncio.get_event_loop().run_in_executor(
        _executor, _synth_from_prompt, req.model_dump()
    )
    return payload


app.mount(
    "/generated-audio",
    StaticFiles(directory=str(_GENERATED_SOUND_DIR)),
    name="generated-audio",
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
