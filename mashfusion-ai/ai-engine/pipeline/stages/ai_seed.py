"""AI Seed stage — produces an initial arrangement JSON for the workstation.

This replaces the old SmartCompositionStage in the new product. The AI no
longer renders a final audio mashup automatically. It only proposes a
starter timeline (an arrangement) that the user then edits in the browser
remix workstation. Final audio is only produced by user-triggered renders
through the Phase 1 render-from-arrangement engine.

Inputs (from PipelineContext, populated by upstream stages):
  - analysis_a / analysis_b — BPM, key, sections, beats
  - transform               — tempo + pitch transform from harmonic_matching
  - stems_a_keys / stems_b_keys — Supabase storage keys for persisted stems
  - project_id              — required to persist the arrangement

Output:
  - ctx.output['arrangement'] — the seed arrangement JSON (also POSTed to
    the backend so it lands in the `arrangements` table with source='ai_seed')
"""

from __future__ import annotations

import os
import uuid
from typing import Any

import requests
from loguru import logger

from config import get_settings
from schemas.arrangement import Arrangement, Clip, Track

from ..base import Stage
from ..context import PipelineContext
from ..reporter import ProgressReporter

_settings = get_settings()


# Preferred visual ordering for known stems; unknown stems are appended
# alphabetically so we never hard-limit lane generation.
_PREFERRED_STEM_ORDER = ("vocals", "drums", "bass", "other")


def _track_duration_from_analysis(analysis: dict | None) -> float:
    if not analysis:
        return 0.0
    sections = analysis.get("sections") or []
    if sections:
        return float(sections[-1].get("end") or 0.0)
    beats = analysis.get("beat_timestamps") or []
    if beats:
        return float(beats[-1])
    return 0.0


def _build_track_lanes(
    side: str,
    side_label: str,
    stem_keys: dict[str, str],
    duration_sec: float,
    start_lane: int,
) -> list[Track]:
    """One Track per stem; one full-length Clip per Track."""
    tracks: list[Track] = []
    if duration_sec <= 0:
        return tracks

    preferred_idx = {name: i for i, name in enumerate(_PREFERRED_STEM_ORDER)}
    sorted_stems = sorted(
        stem_keys.items(),
        key=lambda item: (0, preferred_idx[item[0]]) if item[0] in preferred_idx else (1, item[0]),
    )

    for offset, (stem_name, s3_key) in enumerate(sorted_stems):
        if not s3_key:
            continue
        clip = Clip(
            id=str(uuid.uuid4()),
            asset_kind="stem",
            asset_ref=s3_key,
            start_sec=0.0,
            end_sec=duration_sec,
            offset_sec=0.0,
            # Drums and bass placed prominently; vocals slightly down to leave
            # mixing headroom; "other" attenuated since it usually overlaps.
            gain_db={"vocals": -1.5, "drums": 0.0, "bass": -1.0, "other": -3.0}.get(stem_name, -2.0),
        )
        pretty_name = stem_name.replace("_", " ").replace("-", " ").title()
        tracks.append(Track(
            id=str(uuid.uuid4()),
            name=f"{pretty_name} {side_label}",
            lane=start_lane + offset,
            source={"side": side, "stem_name": stem_name, "s3_key": s3_key},
            user_created=False,
            clips=[clip],
            # Mute B-side by default; users solo what they want to keep.
            mute=(side == "b"),
        ))
    return tracks


def build_seed_arrangement(ctx: PipelineContext) -> Arrangement:
    """Pure function — useful for tests and offline replays."""
    if not ctx.project_id:
        raise ValueError("project_id is required to build an AI seed arrangement")

    dur_a = _track_duration_from_analysis(ctx.analysis_a)
    dur_b = _track_duration_from_analysis(ctx.analysis_b)
    duration_sec = max(dur_a, dur_b, 30.0)

    bpm = float((ctx.analysis_a or {}).get("bpm") or (ctx.analysis_b or {}).get("bpm") or 120.0)
    musical_key = (ctx.analysis_a or {}).get("musical_key")

    # Remix mode: user is the creative director. We separate Track A's stems
    # and pre-place them on the timeline so the user opens the workstation
    # to a decomposed version of their song (vocals / drums / bass / other).
    # This is the Splice/Moises-style starting state — much more intuitive
    # than an empty timeline with stems hidden in a side panel.
    if ctx.project_mode == "remix":
        tracks: list[Track] = []
        tracks += _build_track_lanes(
            "a", "A", ctx.stems_a_keys or {}, dur_a or duration_sec, start_lane=0
        )
        # Unmute everything in remix mode — there's only one source so there's
        # no A/B split to manage.
        for t in tracks:
            t.mute = False
        return Arrangement(
            project_id=ctx.project_id,
            bpm=bpm,
            musical_key=musical_key,
            duration_sec=duration_sec,
            lanes=tracks,
            tracks=tracks,
        )

    tracks: list[Track] = []
    tracks += _build_track_lanes("a", "A", ctx.stems_a_keys or {}, dur_a or duration_sec, start_lane=0)
    tracks += _build_track_lanes("b", "B", ctx.stems_b_keys or {}, dur_b or duration_sec, start_lane=len(tracks))

    return Arrangement(
        project_id=ctx.project_id,
        bpm=bpm,
        musical_key=musical_key,
        duration_sec=duration_sec,
        lanes=tracks,
        tracks=tracks,
    )


def _post_arrangement_seed(job_id: str, project_id: str, arrangement: Arrangement) -> None:
    """POST the seed to the backend so it lands in `arrangements` table."""
    backend_url = getattr(_settings, "backend_url", None) or os.environ.get("BACKEND_URL")
    api_key = getattr(_settings, "internal_api_key", None) or os.environ.get("AI_ENGINE_API_KEY")
    if not backend_url or not api_key:
        # Hard fail so the orchestrator marks the job failed instead of completing
        # silently with no persisted arrangement (which leaves the workstation
        # polling forever on "Building your starting arrangement…").
        raise RuntimeError(
            f"[{job_id}] AI seed cannot persist: BACKEND_URL or AI_ENGINE_API_KEY not configured"
        )

    logger.info(
        f"[{job_id}] Posting arrangement seed → {backend_url}/internal/arrangement-seed "
        f"(tracks={len(arrangement.tracks)}, duration={arrangement.duration_sec:.1f}s)"
    )
    try:
        resp = requests.post(
            f"{backend_url}/internal/arrangement-seed",
            json={
                "job_id":      job_id,
                "project_id":  project_id,
                "arrangement": arrangement.model_dump(),
            },
            headers={"X-Internal-API-Key": api_key},
            timeout=30,
        )
        if not resp.ok:
            # Log status + body so misconfigured auth or schema rejection
            # is visible without enabling DEBUG.
            body = (resp.text or "")[:500]
            logger.error(
                f"[{job_id}] Arrangement seed POST rejected: "
                f"status={resp.status_code} body={body}"
            )
            resp.raise_for_status()
        logger.info(f"[{job_id}] Seed arrangement persisted (status {resp.status_code})")
    except Exception as exc:
        logger.error(f"[{job_id}] Failed to persist seed arrangement: {exc}")
        raise


class AISeedStage(Stage):
    """Builds the starter arrangement and persists it via the backend."""

    name = "ai_seed"

    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None:
        reporter.update(self.name, "running", 0, 70, "AI seed",
                        message="Generating starter arrangement")

        if not (ctx.stems_a_keys or ctx.stems_b_keys):
            raise RuntimeError("AISeedStage requires persisted stem keys (Phase 0 stem upload)")

        arrangement = build_seed_arrangement(ctx)

        reporter.update(self.name, "running", 60, 80, "AI seed", message="Saving arrangement")
        _post_arrangement_seed(ctx.job_id, ctx.project_id, arrangement)

        # Surface in ctx.output so the orchestrator's final 'complete' webhook
        # can include the arrangement (the workstation can pick it up via the
        # standard /projects/:id/arrangement endpoint).
        ctx.output = {
            "arrangement_id":      None,  # backend sets the row id; UI just refetches
            "arrangement_version": arrangement.version,
            "track_count":         len(arrangement.tracks),
            "duration_sec":        arrangement.duration_sec,
        }

        reporter.mark(self.name, "complete", 100)
        logger.info(
            f"[{ctx.job_id}] AI seed complete: {len(arrangement.tracks)} tracks, "
            f"{arrangement.duration_sec:.1f}s @ {arrangement.bpm} BPM"
        )
