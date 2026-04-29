"""
IOMIXO Real AI Engine — local dev server (no Celery/Redis required).
Runs the full 7-stage pipeline in a background thread.
Requires: demucs, librosa, soundfile, scipy, pydub, ffmpeg in PATH.
"""

import os
import sys
import time
import socket
import traceback
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
from utils.s3_utils import download_from_s3, upload_to_s3, get_signed_download_url  # noqa: E402
from services.stem_separator import separate_stems  # noqa: E402
from services.music_analyzer import analyze_track  # noqa: E402
from services.harmonic_matcher import compute_transform_plan  # noqa: E402
from services.mashup_composer import compose_mashup, run_full_composer_engine  # noqa: E402
from services.mastering_engine import master_audio  # noqa: E402
from services.remix_director_adapter import apply_director_params, build_default_pipeline_config  # noqa: E402
from utils.audio_utils import export_preview_mp3, get_audio_info  # noqa: E402

try:
    from services.style_engine import apply_commercial_style
    _HAS_STYLE_ENGINE = True
except Exception:
    _HAS_STYLE_ENGINE = False
    logger.warning("Style engine not available — skipping sound modernization stage")

try:
    from services.sound_modernizer import apply_style_preset
    _HAS_LEGACY_STYLE = True
except Exception:
    _HAS_LEGACY_STYLE = False

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
        logger.warning(f"[{job_id}] Failed to report progress: {exc}")


def _stage(stages: dict, name: str, status: str, progress: int = 0, message: str | None = None) -> dict:
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


def run_pipeline(payload: dict):
    """Full 7-stage pipeline — runs synchronously in thread pool."""
    job_id         = payload["job_id"]
    track_a_key    = payload["track_a_s3_key"]
    track_b_key    = payload["track_b_s3_key"]
    remix_style    = payload.get("remix_style", "none")
    output_quality = payload.get("output_quality", "standard")
    user_plan      = payload.get("user_plan", "free")

    director_params = payload.get("remix_director_params") or {}
    pipeline_config = apply_director_params(
        director_params,
        build_default_pipeline_config(),
    )

    work_dir = Path(settings.tmp_dir) / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    stages = {
        s: {"status": "pending", "progress": 0, "started_at": None, "completed_at": None, "message": None}
        for s in [
            "stem_separation", "music_analysis", "harmonic_matching",
            "mashup_composition", "sound_modernization", "mastering", "rendering"
        ]
    }
    if remix_style == "none":
        stages["sound_modernization"]["status"] = "skipped"

    try:
        # ── Stage 1: Download + Stem separation ─────────────────
        track_a_path = work_dir / "track_a_original.wav"
        track_b_path = work_dir / "track_b_original.wav"

        stages = _stage(stages, "stem_separation", "running", 0, "Downloading audio files")
        report_progress(job_id, "processing", 2, "Downloading audio", stages)

        logger.info(f"[{job_id}] Downloading track A: {track_a_key}")
        download_from_s3(track_a_key, str(track_a_path))
        logger.info(f"[{job_id}] Downloading track B: {track_b_key}")
        download_from_s3(track_b_key, str(track_b_path))

        stages = _stage(stages, "stem_separation", "running", 20, "Separating stems — Track A")
        report_progress(job_id, "processing", 5, "Stem separation", stages)

        logger.info(f"[{job_id}] Separating stems — Track A (this takes a few minutes on CPU)")
        stems_a = separate_stems(str(track_a_path), str(work_dir / "stems_a"))

        stages = _stage(stages, "stem_separation", "running", 60, "Separating stems — Track B")
        report_progress(job_id, "processing", 12, "Stem separation", stages)

        logger.info(f"[{job_id}] Separating stems — Track B")
        stems_b = separate_stems(str(track_b_path), str(work_dir / "stems_b"))

        stages = _stage(stages, "stem_separation", "complete", 100)
        report_progress(job_id, "processing", 20, "Stem separation complete", stages)
        logger.info(f"[{job_id}] Stage 1 done. Stems A: {list(stems_a.keys())}")

        # ── Stage 2: Music analysis ──────────────────────────────
        stages = _stage(stages, "music_analysis", "running", 0, "Analyzing Track A")
        report_progress(job_id, "processing", 22, "Analyzing audio", stages)

        analysis_a = analyze_track(str(track_a_path))
        stages = _stage(stages, "music_analysis", "running", 50, "Analyzing Track B")
        report_progress(job_id, "processing", 28, "Analyzing audio", stages)

        analysis_b = analyze_track(str(track_b_path))
        stages = _stage(stages, "music_analysis", "complete", 100)
        report_progress(job_id, "processing", 35, "Analysis complete", stages,
                        analysis_a=analysis_a, analysis_b=analysis_b)
        logger.info(f"[{job_id}] Stage 2 done. A: {analysis_a.get('bpm')} BPM {analysis_a.get('key')} | B: {analysis_b.get('bpm')} BPM {analysis_b.get('key')}")

        # ── Stage 3: Harmonic matching ───────────────────────────
        stages = _stage(stages, "harmonic_matching", "running", 0, "Computing harmonic transform")
        report_progress(job_id, "processing", 36, "Harmonic matching", stages)

        transform = compute_transform_plan(analysis_a, analysis_b)
        stages = _stage(stages, "harmonic_matching", "complete", 100)
        report_progress(job_id, "processing", 45, "Harmonic matching complete", stages)
        logger.info(f"[{job_id}] Stage 3 done. Transform: {transform}")

        # ── Stage 4: Mashup composition ──────────────────────────
        stages = _stage(stages, "mashup_composition", "running", 0, "Building arrangement")
        report_progress(job_id, "processing", 46, "Composing mashup", stages)

        mashup_path = work_dir / "mashup_raw.wav"
        composer_metadata: dict = {}

        def _composition_progress(p: int) -> None:
            report_progress(
                job_id, "processing", 46 + int(p * 0.14),
                "Composing mashup",
                _stage(stages, "mashup_composition", "running", p),
            )

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
            logger.info(f"[{job_id}] Stage 4 (full composer) done.")
        except Exception as e:
            logger.warning(f"[{job_id}] Full composer failed ({e}), falling back to legacy")
            compose_mashup(
                stems_a=stems_a,
                stems_b=stems_b,
                analysis_a=analysis_a,
                analysis_b=analysis_b,
                transform=transform,
                output_path=str(mashup_path),
                progress_cb=_composition_progress,
            )
            logger.info(f"[{job_id}] Stage 4 (legacy composer) done.")

        stages = _stage(stages, "mashup_composition", "complete", 100)
        report_progress(job_id, "processing", 60, "Composition complete", stages)

        # ── Stage 5: Sound modernization / Style ─────────────────
        mastered_path = mashup_path
        mastering_meta: dict = {}
        style_metadata: dict = {}

        if remix_style != "none":
            stages = _stage(stages, "sound_modernization", "running", 0,
                            f"Applying style: {remix_style}")
            report_progress(job_id, "processing", 61, "Commercial style engine", stages)

            styled_path = work_dir / "mashup_styled.wav"

            _drums_np = None
            if _HAS_STYLE_ENGINE:
                try:
                    import librosa as _lr
                    _drum_key = stems_a.get("drums")
                    if _drum_key and os.path.isfile(_drum_key):
                        _drums_np, _ = _lr.load(_drum_key, sr=44100, mono=True)
                except Exception:
                    pass

                def _style_progress(pct: float, msg: str) -> None:
                    report_progress(
                        job_id, "processing", 61 + int(pct * 0.20),
                        "Commercial style engine",
                        _stage(stages, "sound_modernization", "running", int(pct), msg),
                    )

                try:
                    style_metadata = apply_commercial_style(
                        input_path=str(mashup_path),
                        output_path=str(styled_path),
                        preset_name=remix_style,
                        transition_markers=composer_metadata.get("transition_markers", []),
                        quality=output_quality,
                        bpm=float(analysis_a.get("bpm", 120.0)),
                        drums_stem=_drums_np,
                        progress_cb=_style_progress,
                    )
                    mastered_path = styled_path
                    mastering_meta = style_metadata.get("mastering", {})
                    logger.info(f"[{job_id}] Stage 5 (style engine) done.")
                except Exception as se:
                    logger.warning(f"[{job_id}] Style engine failed ({se}), trying legacy")
                    if _HAS_LEGACY_STYLE:
                        try:
                            from services.sound_modernizer import apply_style_preset
                            apply_style_preset(str(mashup_path), str(styled_path), remix_style)
                            mastered_path = styled_path
                        except Exception as le:
                            logger.error(f"[{job_id}] Legacy style also failed: {le}")
            elif _HAS_LEGACY_STYLE:
                from services.sound_modernizer import apply_style_preset
                apply_style_preset(str(mashup_path), str(styled_path), remix_style)
                mastered_path = styled_path

            stages = _stage(stages, "sound_modernization", "complete", 100)
            report_progress(job_id, "processing", 81, "Style applied", stages)

        # ── Stage 6: Mastering ────────────────────────────────────
        _already_mastered = (remix_style != "none" and mastered_path != mashup_path
                             and bool(mastering_meta))

        if _already_mastered:
            stages = _stage(stages, "mastering", "skipped", 100, "Handled by style engine")
        else:
            stages = _stage(stages, "mastering", "running", 0, "Mastering audio")
            report_progress(job_id, "processing", 73, "Mastering", stages)

            master_output = work_dir / "mashup_mastered_final.wav"
            mastering_meta = master_audio(
                str(mastered_path), str(master_output), output_quality,
                target_lufs=pipeline_config["mastering"].get("target_lufs", -14.0),
                ceiling_dbtp=pipeline_config["mastering"].get("ceiling_dbtp", -1.0),
                warmth=pipeline_config["mastering"].get("warmth", 0.5),
                brightness=pipeline_config["mastering"].get("brightness", 0.5),
            )
            mastered_path = master_output
            stages = _stage(stages, "mastering", "complete", 100)
            logger.info(f"[{job_id}] Stage 6 done. LUFS: {mastering_meta.get('lufs')}")

        report_progress(job_id, "processing", 85, "Mastering complete", stages)

        # ── Stage 7: Render + Upload ──────────────────────────────
        stages = _stage(stages, "rendering", "running", 0, "Exporting preview MP3")
        report_progress(job_id, "processing", 86, "Rendering exports", stages)

        preview_path = work_dir / "preview.mp3"
        export_preview_mp3(str(mastered_path), str(preview_path), bitrate="192k")

        stages = _stage(stages, "rendering", "running", 40, "Uploading to storage")
        report_progress(job_id, "processing", 90, "Uploading", stages)

        base_key       = f"outputs/{job_id}"
        preview_s3_key = f"{base_key}/preview.mp3"
        wav_s3_key     = f"{base_key}/master.wav"

        upload_to_s3(str(preview_path), preview_s3_key, content_type="audio/mpeg")

        # WAV for pro/studio only
        _render_wav = user_plan in ("pro", "studio") or output_quality == "professional"
        if _render_wav:
            upload_to_s3(str(mastered_path), wav_s3_key, content_type="audio/wav")
        else:
            wav_s3_key = None

        stages = _stage(stages, "rendering", "complete", 100)

        # Generate signed download URLs
        preview_url = get_signed_download_url(preview_s3_key, expires_in=86400)
        wav_url     = get_signed_download_url(wav_s3_key, expires_in=86400) if wav_s3_key else None

        info = get_audio_info(str(mastered_path))
        output = {
            "preview_mp3_url":  preview_url,
            "full_wav_url":     wav_url,
            "full_mp3_url":     preview_url,
            "duration_seconds": info["duration"],
            "loudness_lufs":    mastering_meta.get("lufs") or mastering_meta.get("mastering", {}).get("lufs"),
            "sample_rate":      info["sample_rate"],
            "bit_depth":        24 if output_quality == "professional" else 16,
            "file_size_bytes":  os.path.getsize(str(mastered_path)),
        }

        report_progress(job_id, "complete", 100, "Complete", stages,
                        output=output, analysis_a=analysis_a, analysis_b=analysis_b)
        logger.info(f"[{job_id}] Job complete! Preview: {preview_url}")

    except Exception as exc:
        logger.error(f"[{job_id}] Pipeline failed: {exc}\n{traceback.format_exc()}")
        stages_failed = {
            k: ({**v, "status": "failed"} if v.get("status") == "running" else v)
            for k, v in stages.items()
        }
        report_progress(job_id, "failed", 0, "Failed", stages_failed, error_message=str(exc))

    finally:
        # Clean up temp files after success (keep on failure for debugging)
        pass


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


@app.post("/jobs/start", status_code=202)
@app.post("/api/v1/jobs/process", status_code=202)
async def start_job(
    req: JobRequest,
    x_internal_api_key: str | None = Header(default=None),
):
    _verify_key(x_internal_api_key)
    logger.info(f"Dispatching real pipeline for job {req.job_id}")
    _executor.submit(run_pipeline, req.model_dump())
    return {"job_id": req.job_id, "status": "queued"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
