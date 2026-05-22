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
    track_b_s3_key: str | None = None  # None/empty when project_mode == 'remix'
    project_id: str | None = None
    user_id: str | None = None
    remix_style: str = "none"
    output_quality: str = "standard"
    user_plan: str = "free"
    pipeline_config: dict = field(default_factory=dict)
    # Retained for callsite compatibility but ignored by the orchestrator —
    # there is only one upload-time pipeline (stem separation → analysis →
    # harmonic matching → AI seed). Final audio is produced by user-driven
    # renders via /render/arrangement, not here.
    mode: str = "full"
    # Product mode: 'mashup' = two tracks → AI seeds an arrangement with
    # pre-placed clips. 'remix' = one track → stems only, empty timeline.
    project_mode: str = "mashup"
    cached_analysis: dict | None = None

    # ── filesystem ────────────────────────────────────────────────────────
    work_dir: Path | None = None
    track_a_path: Path | None = None
    track_b_path: Path | None = None

    # ── stage outputs ─────────────────────────────────────────────────────
    stems_a: dict | None = None
    stems_b: dict | None = None
    # Persisted stem storage keys (Supabase Storage, stems bucket).
    # Shape: {stem_name: storage_key}, populated by StemSeparationStage when
    # project_id is present. Consumed by AISeedStage and the workstation API.
    stems_a_keys: dict[str, str] = field(default_factory=dict)
    stems_b_keys: dict[str, str] = field(default_factory=dict)
    analysis_a: dict | None = None
    analysis_b: dict | None = None
    transform: dict | None = None

    output: dict = field(default_factory=dict)

    # ── orchestrator bookkeeping ──────────────────────────────────────────
    stages: dict = field(default_factory=dict)
    extras: dict[str, Any] = field(default_factory=dict)
