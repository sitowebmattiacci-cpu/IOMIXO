"""
IOMIXO AI — Autonomous Mashup Composer Engine
==============================================
Sub-package containing the full intelligence pipeline for musical mashup generation.

Module execution order:
  1. deep_analyzer        → SongMap per traccia
  2. compatibility_scorer → SectionPairing matrix
  3. artistic_decision    → NarrativePlan
  4. arrangement_builder  → ArrangementTimeline
  5. transition_fx_engine → TransitionMarker list
  6. vocal_micro_aligner  → VocalPlacement list
  7. quality_evaluator    → QualityReport + best plan selection
"""

from .deep_analyzer import DeepAnalyzer, SongMap
from .compatibility_scorer import CompatibilityScorer, SectionPairing
from .artistic_decision_engine import ArtisticDecisionEngine, NarrativePlan
from .arrangement_builder import ArrangementBuilder, ArrangementTimeline
from .transition_fx_engine import TransitionFXEngine
from .vocal_micro_aligner import VocalMicroAligner
from .quality_evaluator import QualityEvaluator, QualityReport

__all__ = [
    "DeepAnalyzer", "SongMap",
    "CompatibilityScorer", "SectionPairing",
    "ArtisticDecisionEngine", "NarrativePlan",
    "ArrangementBuilder", "ArrangementTimeline",
    "TransitionFXEngine",
    "VocalMicroAligner",
    "QualityEvaluator", "QualityReport",
]
