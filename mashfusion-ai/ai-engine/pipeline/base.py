"""Abstract base class for pipeline stages."""

from __future__ import annotations

from abc import ABC, abstractmethod

from .context import PipelineContext
from .reporter import ProgressReporter


class Stage(ABC):
    """A single isolated step in the generation pipeline.

    Subclasses implement :meth:`run` and declare a ``name`` matching the key
    used in the legacy ``stage_progress`` map (so existing clients keep
    working unchanged).
    """

    name: str = ""

    def should_run(self, ctx: PipelineContext) -> bool:
        return True

    @abstractmethod
    def run(self, ctx: PipelineContext, reporter: ProgressReporter) -> None: ...
