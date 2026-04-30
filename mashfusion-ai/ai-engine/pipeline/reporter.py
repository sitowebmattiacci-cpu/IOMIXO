"""Progress reporting helper used by every stage.

Wraps the legacy ``report_progress`` HTTP call so stages do not need to know
about the backend transport. Holds a reference to the live ``stages`` dict so
that each report carries the full per-stage progress map.
"""

from __future__ import annotations

import time
from typing import Callable

from loguru import logger


class ProgressReporter:
    def __init__(self, job_id: str, transport: Callable[..., None], ctx) -> None:
        self.job_id = job_id
        self._transport = transport
        self._ctx = ctx

    # ── stage-state mutation ─────────────────────────────────────────────
    def mark(
        self,
        stage_name: str,
        status: str,
        progress: int = 0,
        message: str | None = None,
    ) -> None:
        stages = self._ctx.stages
        existing = stages.get(stage_name, {})
        stages[stage_name] = {
            **existing,
            "status": status,
            "progress": progress,
            "message": message,
            "started_at": existing.get("started_at")
            or (time.time() if status == "running" else None),
            "completed_at": time.time()
            if status in ("complete", "skipped", "failed")
            else None,
        }

    # ── transport ────────────────────────────────────────────────────────
    def report(
        self,
        status: str,
        overall_progress: int,
        current_stage: str,
        *,
        error_message: str | None = None,
        output: dict | None = None,
        analysis_a: dict | None = None,
        analysis_b: dict | None = None,
        cached_analysis: dict | None = None,
    ) -> None:
        try:
            self._transport(
                job_id=self.job_id,
                status=status,
                progress=overall_progress,
                current_stage=current_stage,
                stage_progress=self._ctx.stages,
                error_message=error_message,
                output=output,
                analysis_a=analysis_a,
                analysis_b=analysis_b,
                cached_analysis=cached_analysis,
            )
        except Exception as exc:  # pragma: no cover — transport is best-effort
            logger.warning(f"[{self.job_id}] reporter transport failed: {exc}")

    # ── convenience ──────────────────────────────────────────────────────
    def update(
        self,
        stage_name: str,
        status: str,
        stage_progress: int,
        overall_progress: int,
        current_stage_label: str,
        message: str | None = None,
        **report_kwargs,
    ) -> None:
        self.mark(stage_name, status, stage_progress, message)
        self.report("processing", overall_progress, current_stage_label, **report_kwargs)
