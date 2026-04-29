"""
IOMIXO AI Engine — Mock Server for local development.

Simulates the full 7-stage pipeline with realistic progress updates.
Requires only: pip install fastapi uvicorn httpx

Usage:
  cd mashfusion-ai/ai-engine
  python3 mock_server.py
"""

import time
import threading
import os
import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="IOMIXO Engine (MOCK)", version="1.0.0-mock")

BACKEND_URL     = os.getenv("BACKEND_URL",       "http://localhost:4000")
INTERNAL_KEY    = os.getenv("AI_ENGINE_API_KEY", "change-me-to-a-random-internal-key")

# Fake output audio — a silent 3-second MP3 encoded as base64 (publicly accessible sample)
MOCK_PREVIEW_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
MOCK_WAV_URL     = MOCK_PREVIEW_URL

STAGES = [
    ("stem_separation",    "Separating stems",      15, 8),
    ("music_analysis",     "Analysing BPM & key",   30, 4),
    ("harmonic_matching",  "Matching harmonics",     45, 3),
    ("mashup_composition", "Composing arrangement",  65, 5),
    ("sound_modernization","Applying style preset",  78, 3),
    ("mastering",          "Mastering audio",        90, 4),
    ("rendering",          "Rendering final output", 100, 3),
]


def _post_update(payload: dict):
    try:
        with httpx.Client(timeout=10) as client:
            r = client.post(
                f"{BACKEND_URL}/internal/job-update",
                json=payload,
                headers={"X-Internal-API-Key": INTERNAL_KEY},
            )
            print(f"[mock] job-update → {r.status_code}: {payload.get('status')} {payload.get('progress')}%")
    except Exception as e:
        print(f"[mock] job-update FAILED: {e}")


def _run_job(job_id: str, project_id: str, user_id: str, remix_style: str):
    print(f"[mock] Starting job {job_id} (style={remix_style})")

    stage_progress: dict = {}

    for stage_key, stage_label, progress, duration in STAGES:
        # Report stage start
        stage_progress[stage_key] = {"status": "processing", "label": stage_label}
        _post_update({
            "job_id":         job_id,
            "status":         "processing",
            "progress":       max(progress - 10, 1),
            "current_stage":  stage_key,
            "stage_progress": stage_progress,
        })

        # Simulate work
        time.sleep(duration)

        # Report stage complete
        stage_progress[stage_key] = {"status": "done", "label": stage_label}
        _post_update({
            "job_id":         job_id,
            "status":         "processing",
            "progress":       progress,
            "current_stage":  stage_key,
            "stage_progress": stage_progress,
        })

    # Final complete update with output URLs
    _post_update({
        "job_id":         job_id,
        "status":         "complete",
        "progress":       100,
        "current_stage":  "done",
        "stage_progress": stage_progress,
        "output": {
            "preview_mp3_url":  MOCK_PREVIEW_URL,
            "full_wav_url":     MOCK_WAV_URL,
            "full_mp3_url":     MOCK_PREVIEW_URL,
            "duration_seconds": 210.0,
            "loudness_lufs":    -14.0,
            "sample_rate":      44100,
            "bit_depth":        16,
            "file_size_bytes":  8400000,
        },
        "analysis_a": {"bpm": 124.0, "key": "G major", "duration": 195.0},
        "analysis_b": {"bpm": 132.0, "key": "A minor", "duration": 200.0},
    })
    print(f"[mock] Job {job_id} complete ✅")


# ── Endpoints ──────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "mode": "mock"}


class JobRequest(BaseModel):
    job_id:         str
    project_id:     str
    user_id:        str
    track_a_s3_key: str
    track_b_s3_key: str
    remix_style:    str
    output_quality: str = "preview"


@app.post("/api/v1/jobs/process", status_code=202)
@app.post("/process", status_code=202)  # legacy alias
def dispatch_job(
    body: JobRequest,
    x_internal_api_key: str | None = Header(default=None),
):
    if x_internal_api_key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Run in background thread so we return 202 immediately
    t = threading.Thread(
        target=_run_job,
        args=(body.job_id, body.project_id, body.user_id, body.remix_style),
        daemon=True,
    )
    t.start()

    return {"queued": True, "job_id": body.job_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
