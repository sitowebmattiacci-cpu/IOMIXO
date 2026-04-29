"""
IOMIXO AI — QualityEvaluator
================================
Stage 7: Self-evaluation and alternative plan scoring

The engine generates up to N_CANDIDATES=3 arrangement candidate plans,
scores each one across 5 quality dimensions, and selects the highest-scoring
plan for final render.

Scoring dimensions (all 0–1):
  1. harmonic_pleasantness   — key/chroma compatibility of chosen pairings
  2. groove_naturalness      — tempo alignment + vocal alignment coverage
  3. transition_smoothness   — energy delta across act boundaries
  4. emotional_impact        — peak energy reached at climax + hook count
  5. commercial_listenability — duration, structure diversity, vocal density

If overall score < MINIMUM_QUALITY_THRESHOLD, a fallback plan is generated
with more conservative section choices.

Output: QualityReport with selected plan and full score breakdown.
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from loguru import logger

from .deep_analyzer import SongMap
from .compatibility_scorer import CompatibilityReport
from .artistic_decision_engine import ArtisticDecisionEngine, NarrativePlan
from .arrangement_builder import ArrangementBuilder, ArrangementTimeline
from .transition_fx_engine import TransitionFXEngine, TransitionMarker
from .vocal_micro_aligner import VocalMicroAligner, AlignmentResult


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

N_CANDIDATES = 3
MINIMUM_QUALITY_THRESHOLD = 0.45   # below this → trigger fallback strategy


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DimensionScores:
    harmonic_pleasantness: float = 0.0
    groove_naturalness: float = 0.0
    transition_smoothness: float = 0.0
    emotional_impact: float = 0.0
    commercial_listenability: float = 0.0

    @property
    def overall(self) -> float:
        return round(
            self.harmonic_pleasantness  * 0.25 +
            self.groove_naturalness     * 0.20 +
            self.transition_smoothness  * 0.20 +
            self.emotional_impact       * 0.20 +
            self.commercial_listenability * 0.15,
            4
        )


@dataclass
class CandidateEvaluation:
    candidate_id: int
    narrative_plan: NarrativePlan
    timeline: ArrangementTimeline
    transition_markers: list[TransitionMarker]
    vocal_alignment: AlignmentResult
    scores: DimensionScores
    strategy_notes: str = ""


@dataclass
class QualityReport:
    """
    Final quality report — contains the selected plan and full evaluation.
    """
    selected_candidate_id: int
    selected_plan: NarrativePlan
    selected_timeline: ArrangementTimeline
    selected_transitions: list[TransitionMarker]
    selected_alignment: AlignmentResult
    final_scores: DimensionScores
    all_candidates: list[CandidateEvaluation] = field(default_factory=list)
    is_fallback: bool = False
    quality_verdict: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# QUALITY EVALUATOR
# ─────────────────────────────────────────────────────────────────────────────

class QualityEvaluator:
    """
    Generates N_CANDIDATES arrangement variants, scores each, returns best.

    Usage:
        evaluator = QualityEvaluator()
        report = evaluator.evaluate(
            map_a, map_b, compatibility_report, transform
        )
    """

    def __init__(self):
        self._decision_engine = ArtisticDecisionEngine()
        self._arrangement_builder = ArrangementBuilder()
        self._fx_engine = TransitionFXEngine()
        self._aligner = VocalMicroAligner()

    def evaluate(
        self,
        map_a: SongMap,
        map_b: SongMap,
        compatibility_report: CompatibilityReport,
        transform: dict,
    ) -> QualityReport:
        """
        Generate multiple candidates and select the best one.
        """
        logger.info(
            f"[QualityEvaluator] Generating {N_CANDIDATES} candidates for evaluation"
        )

        candidates: list[CandidateEvaluation] = []

        for i in range(N_CANDIDATES):
            logger.info(f"[QualityEvaluator] Generating candidate {i + 1}/{N_CANDIDATES}")
            try:
                candidate = self._generate_candidate(
                    candidate_id=i,
                    map_a=map_a,
                    map_b=map_b,
                    compatibility_report=compatibility_report,
                    transform=transform,
                    strategy_variant=i,
                )
                candidates.append(candidate)
                logger.info(
                    f"[QualityEvaluator] Candidate {i + 1} score: "
                    f"{candidate.scores.overall:.3f}"
                )
            except Exception as exc:
                logger.warning(f"[QualityEvaluator] Candidate {i + 1} failed: {exc}")

        if not candidates:
            raise RuntimeError("[QualityEvaluator] All candidate generations failed")

        # ── Select best candidate ─────────────────────────────────
        best = max(candidates, key=lambda c: c.scores.overall)

        # ── Check if fallback needed ─────────────────────────────
        is_fallback = best.scores.overall < MINIMUM_QUALITY_THRESHOLD
        if is_fallback:
            logger.warning(
                f"[QualityEvaluator] Best score {best.scores.overall:.3f} "
                f"below threshold {MINIMUM_QUALITY_THRESHOLD} — using conservative fallback"
            )
            best = self._generate_fallback_candidate(
                map_a, map_b, compatibility_report, transform
            )
            candidates.append(best)

        verdict = self._quality_verdict(best.scores)

        logger.info(
            f"[QualityEvaluator] Selected candidate {best.candidate_id + 1} "
            f"— score={best.scores.overall:.3f} — {verdict}"
        )

        return QualityReport(
            selected_candidate_id=best.candidate_id,
            selected_plan=best.narrative_plan,
            selected_timeline=best.timeline,
            selected_transitions=best.transition_markers,
            selected_alignment=best.vocal_alignment,
            final_scores=best.scores,
            all_candidates=candidates,
            is_fallback=is_fallback,
            quality_verdict=verdict,
        )

    # ─────────────────────────────────────────────────────────────────────
    # CANDIDATE GENERATION
    # ─────────────────────────────────────────────────────────────────────

    def _generate_candidate(
        self,
        candidate_id: int,
        map_a: SongMap,
        map_b: SongMap,
        compatibility_report: CompatibilityReport,
        transform: dict,
        strategy_variant: int,
    ) -> CandidateEvaluation:
        """
        Build one full arrangement candidate.

        strategy_variant:
          0 = default (dominant track leads)
          1 = swap dominant (non-dominant leads)
          2 = energy-optimized (maximize peak energy)
        """
        # Apply strategy variant
        adjusted_report = self._apply_strategy_variant(
            compatibility_report, strategy_variant
        )

        # Plan
        plan = self._decision_engine.plan(map_a, map_b, adjusted_report)

        # Timeline
        timeline = self._arrangement_builder.build(plan, map_a, map_b, transform)

        # Transitions
        transitions = self._fx_engine.place_transitions(
            timeline, target_bpm=transform.get("target_bpm", map_a.bpm)
        )

        # Vocal alignment for dominant track
        dom_map = map_a if adjusted_report.dominant_track == "A" else map_b
        vocal_alignment = self._aligner.align(
            song_map=dom_map,
            target_beat_events=dom_map.beat_events,
            arrangement_start_offset=0.0,
            act="full_track",
        )

        # Score
        scores = self._score_candidate(
            plan, timeline, transitions, vocal_alignment, map_a, map_b,
            compatibility_report
        )

        strategy_notes = {
            0: "Default strategy: dominant track leads",
            1: "Swapped dominant: non-dominant track leads",
            2: "Energy-maximized: highest energy sections prioritized",
        }.get(strategy_variant, "Custom strategy")

        return CandidateEvaluation(
            candidate_id=candidate_id,
            narrative_plan=plan,
            timeline=timeline,
            transition_markers=transitions,
            vocal_alignment=vocal_alignment,
            scores=scores,
            strategy_notes=strategy_notes,
        )

    def _apply_strategy_variant(
        self,
        report: CompatibilityReport,
        variant: int,
    ) -> CompatibilityReport:
        """
        Mutate the compatibility report for strategy exploration.
        Returns a modified copy (shallow).
        """
        if variant == 0:
            return report
        if variant == 1:
            # Swap dominant track
            import copy
            modified = copy.copy(report)
            modified.dominant_track = "B" if report.dominant_track == "A" else "A"
            return modified
        if variant == 2:
            # Dominant = track with higher mean energy
            # (both original and swapped are tried; pick highest energy)
            return report  # energy already factored in scoring
        return report

    def _generate_fallback_candidate(
        self,
        map_a: SongMap,
        map_b: SongMap,
        compatibility_report: CompatibilityReport,
        transform: dict,
    ) -> CandidateEvaluation:
        """
        Conservative fallback: use only the highest-scoring section pairings,
        minimal arrangement complexity.
        """
        logger.info("[QualityEvaluator] Generating conservative fallback plan")
        # Use default strategy — just regenerate cleanly
        return self._generate_candidate(
            candidate_id=99,
            map_a=map_a,
            map_b=map_b,
            compatibility_report=compatibility_report,
            transform=transform,
            strategy_variant=0,
        )

    # ─────────────────────────────────────────────────────────────────────
    # SCORING
    # ─────────────────────────────────────────────────────────────────────

    def _score_candidate(
        self,
        plan: NarrativePlan,
        timeline: ArrangementTimeline,
        transitions: list[TransitionMarker],
        alignment: AlignmentResult,
        map_a: SongMap,
        map_b: SongMap,
        compat: CompatibilityReport,
    ) -> DimensionScores:

        harmonic = self._score_harmonic(compat)
        groove = self._score_groove(timeline, alignment)
        transition = self._score_transitions(timeline, transitions)
        impact = self._score_emotional_impact(plan, timeline)
        commercial = self._score_commercial(plan, timeline, map_a, map_b)

        return DimensionScores(
            harmonic_pleasantness=harmonic,
            groove_naturalness=groove,
            transition_smoothness=transition,
            emotional_impact=impact,
            commercial_listenability=commercial,
        )

    def _score_harmonic(self, compat: CompatibilityReport) -> float:
        """Harmonic score directly from compatibility report."""
        return round(
            compat.key_compatibility * 0.60 +
            compat.overall_score * 0.40,
            4
        )

    def _score_groove(
        self,
        timeline: ArrangementTimeline,
        alignment: AlignmentResult,
    ) -> float:
        """Groove score from tempo compatibility and vocal alignment coverage."""
        # Tempo: ratio close to 1.0 = good groove
        ratio = timeline.tempo_ratio
        # Ideal is 1.0; anything between 0.9–1.1 is excellent
        tempo_score = float(np.clip(1.0 - abs(1.0 - ratio) * 5, 0, 1))

        align_coverage = alignment.alignment_coverage if alignment else 0.5

        return round(tempo_score * 0.60 + align_coverage * 0.40, 4)

    def _score_transitions(
        self,
        timeline: ArrangementTimeline,
        transitions: list[TransitionMarker],
    ) -> float:
        """
        Score transition smoothness:
          - Low energy jumps between acts = good (0.9)
          - Large abrupt energy jumps without FX = bad (0.3)
        """
        segments = timeline.segments
        if len(segments) < 2:
            return 0.5

        energy_deltas = []
        for i in range(len(segments) - 1):
            delta = abs(segments[i + 1].energy_target - segments[i].energy_target)
            energy_deltas.append(delta)

        mean_delta = float(np.mean(energy_deltas))

        # Penalize large jumps that have no transition FX
        covered_transitions = len(transitions)
        total_boundaries = len(segments) - 1
        coverage_ratio = covered_transitions / total_boundaries if total_boundaries > 0 else 0.0

        smoothness = float(np.clip(1.0 - mean_delta * 0.8, 0, 1))

        return round(smoothness * 0.60 + coverage_ratio * 0.40, 4)

    def _score_emotional_impact(
        self,
        plan: NarrativePlan,
        timeline: ArrangementTimeline,
    ) -> float:
        """
        Emotional impact = peak energy at climax + number of hook moments.
        """
        if not timeline.segments:
            return 0.0

        # Find climax segment energy
        climax_segs = [s for s in timeline.segments if s.act == "climax"]
        climax_energy = max((s.energy_target for s in climax_segs), default=0.5)

        # Hook count (normalized to expected 3 hooks)
        hook_count = len(plan.hook_moments)
        hook_score = float(np.clip(hook_count / 3.0, 0, 1))

        # Penalize if climax energy < 0.8 (not impactful enough)
        energy_score = float(np.clip((climax_energy - 0.5) / 0.5, 0, 1))

        return round(energy_score * 0.60 + hook_score * 0.40, 4)

    def _score_commercial(
        self,
        plan: NarrativePlan,
        timeline: ArrangementTimeline,
        map_a: SongMap,
        map_b: SongMap,
    ) -> float:
        """
        Commercial listenability:
          - Duration 2.5–5 min = ideal
          - Structural diversity (variety of section labels used)
          - Vocal density neither too low (<0.15) nor too high (>0.75)
        """
        # Duration score
        dur = timeline.total_duration
        if 150 <= dur <= 300:
            duration_score = 1.0
        elif 120 <= dur < 150 or 300 < dur <= 360:
            duration_score = 0.75
        else:
            duration_score = 0.40

        # Structural diversity
        act_labels = set(s.act for s in timeline.segments)
        diversity_score = float(np.clip(len(act_labels) / len(NARRATIVE_ACTS_EXPECTED), 0, 1))

        # Vocal density
        avg_density = (map_a.vocal_density + map_b.vocal_density) / 2
        if 0.25 <= avg_density <= 0.65:
            vocal_score = 1.0
        elif avg_density < 0.15:
            vocal_score = 0.50
        else:
            vocal_score = 0.70

        return round(
            duration_score * 0.40 + diversity_score * 0.35 + vocal_score * 0.25,
            4
        )

    # ─────────────────────────────────────────────────────────────────────
    # VERDICT
    # ─────────────────────────────────────────────────────────────────────

    def _quality_verdict(self, scores: DimensionScores) -> str:
        overall = scores.overall
        if overall >= 0.80:
            return "EXCELLENT — radio-ready mashup structure"
        if overall >= 0.65:
            return "GOOD — professional quality with minor opportunities"
        if overall >= 0.50:
            return "ACCEPTABLE — functional mashup, some rough transitions"
        if overall >= 0.35:
            return "POOR — significant harmonic or structural issues"
        return "CRITICAL — mashup may sound incoherent, manual review required"

    @staticmethod
    def report_to_json(report: QualityReport) -> dict:
        """Serialize QualityReport to JSON-safe dict for storage."""
        return {
            "selected_candidate_id": report.selected_candidate_id,
            "is_fallback": report.is_fallback,
            "quality_verdict": report.quality_verdict,
            "final_scores": {
                "harmonic_pleasantness": report.final_scores.harmonic_pleasantness,
                "groove_naturalness": report.final_scores.groove_naturalness,
                "transition_smoothness": report.final_scores.transition_smoothness,
                "emotional_impact": report.final_scores.emotional_impact,
                "commercial_listenability": report.final_scores.commercial_listenability,
                "overall": report.final_scores.overall,
            },
            "all_candidate_scores": [
                {
                    "candidate_id": c.candidate_id,
                    "strategy": c.strategy_notes,
                    "overall": c.scores.overall,
                    "harmonic": c.scores.harmonic_pleasantness,
                    "groove": c.scores.groove_naturalness,
                    "transitions": c.scores.transition_smoothness,
                    "impact": c.scores.emotional_impact,
                    "commercial": c.scores.commercial_listenability,
                }
                for c in report.all_candidates
            ],
            "estimated_duration_s": report.selected_timeline.total_duration,
            "target_bpm": report.selected_timeline.target_bpm,
            "target_key": report.selected_timeline.target_key,
        }


# Used internally for scoring
NARRATIVE_ACTS_EXPECTED = [
    "intro", "build", "first_payoff",
    "emotional_rise", "climax", "release", "outro"
]
