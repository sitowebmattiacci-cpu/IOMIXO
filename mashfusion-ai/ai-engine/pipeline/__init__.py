"""Modular stage-based generation pipeline for the IOMIXO AI engine.

The :class:`PipelineOrchestrator` runs an ordered list of :class:`Stage`
implementations against a shared :class:`PipelineContext`. Each stage owns a
single concern (separation, analysis, composition, …) and can be swapped,
disabled, or extended without touching the others.
"""

from .context import PipelineContext
from .base import Stage
from .reporter import ProgressReporter
from .orchestrator import (
    PipelineOrchestrator,
    build_default_pipeline,
    build_preview_pipeline,
    build_pipeline_for_mode,
)

__all__ = [
    "PipelineContext",
    "Stage",
    "ProgressReporter",
    "PipelineOrchestrator",
    "build_default_pipeline",
    "build_preview_pipeline",
    "build_pipeline_for_mode",
]
