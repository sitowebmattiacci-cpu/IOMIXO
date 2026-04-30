"""Shared mutable state passed between pipeline stages.

A single :class:`PipelineContext` instance is created per job and threaded
through every stage. Stages read inputs from it and write their outputs back
onto it, which keeps the orchestrator agnostic to stage internals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class PipelineContext:
    # ── job request inputs ────────────────────────────────────────────────
    job_id: str
    track_a_s3_key: str
    track_b_s3_key: str
    remix_style: str = "none"
    output_quality: str = "standard"
    user_plan: str = "free"
    pipeline_config: dict = field(default_factory=dict)
    # Preview / Full split — drives stage gating and output shape.
    mode: str = "full"                         # 'preview' | 'full'
    preview_duration_sec: int = 30
    cached_analysis: dict | None = None
    parent_job_id: str | None = None

    # ── filesystem ────────────────────────────────────────────────────────
    work_dir: Path | None = None
    track_a_path: Path | None = None
    track_b_path: Path | None = None

    # ── stage outputs ─────────────────────────────────────────────────────
    stems_a: dict | None = None
    stems_b: dict | None = None
    analysis_a: dict | None = None
    analysis_b: dict | None = None
    transform: dict | None = None

    mashup_path: Path | None = None
    composer_metadata: dict = field(default_factory=dict)

    styled_path: Path | None = None
    style_metadata: dict = field(default_factory=dict)

    mastered_path: Path | None = None
    mastering_meta: dict = field(default_factory=dict)

    output: dict = field(default_factory=dict)

    # ── orchestrator bookkeeping ──────────────────────────────────────────
    stages: dict = field(default_factory=dict)
    extras: dict[str, Any] = field(default_factory=dict)
