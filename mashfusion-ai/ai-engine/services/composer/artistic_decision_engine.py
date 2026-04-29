"""
IOMIXO AI — ArtisticDecisionEngine
=====================================
Stage 3: Simulated producer reasoning

Takes the CompatibilityReport and both SongMaps and decides:
  - Which track dominates emotionally
  - Which vocals are strongest hooks
  - Where the climax should land
  - The full dramatic narrative arc:
      intro → build → first_payoff → emotional_rise → climax → release → outro

Outputs a NarrativePlan: an ordered sequence of dramatic "acts" with
section selections from A and B that serve each act's emotional purpose.

This is the artistic brain of the engine.
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from loguru import logger

from .deep_analyzer import SongMap, SectionBlock
from .compatibility_scorer import CompatibilityReport, SectionPairing


# ─────────────────────────────────────────────────────────────────────────────
# NARRATIVE DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

# The 7 dramatic acts of a professional mashup
NARRATIVE_ACTS = [
    "intro",
    "build",
    "first_payoff",
    "emotional_rise",
    "climax",
    "release",
    "outro",
]

# Target energy levels for each act (0–1)
_ACT_ENERGY_TARGETS: dict[str, float] = {
    "intro":          0.25,
    "build":          0.50,
    "first_payoff":   0.75,
    "emotional_rise": 0.65,
    "climax":         1.00,
    "release":        0.45,
    "outro":          0.20,
}

# Preferred section labels for each act (in priority order)
_ACT_PREFERRED_LABELS: dict[str, list[str]] = {
    "intro":          ["intro", "verse"],
    "build":          ["pre-chorus", "verse"],
    "first_payoff":   ["chorus", "pre-chorus"],
    "emotional_rise": ["verse", "pre-chorus", "bridge"],
    "climax":         ["chorus", "breakdown"],
    "release":        ["bridge", "breakdown", "verse"],
    "outro":          ["outro", "bridge", "verse"],
}


@dataclass
class ActAssignment:
    """
    Mapping of a single narrative act to specific sections from A and B.
    """
    act: str
    primary_section: SectionBlock      # the section providing main emotional content
    primary_track: str                 # "A" or "B"
    support_section: SectionBlock | None  # optional supporting section
    support_track: str | None             # "A" or "B" or None
    pairing: SectionPairing | None        # the underlying scored pairing
    target_energy: float
    actual_energy: float
    notes: str = ""                     # artistic notes for the arranger


@dataclass
class NarrativePlan:
    """
    Complete artistic plan for the mashup.
    Contains the full dramatic arc with section assignments.
    """
    dominant_track: str                    # "A" or "B"
    narrative_acts: list[ActAssignment] = field(default_factory=list)
    estimated_duration: float = 0.0       # seconds
    emotional_arc_description: str = ""
    hook_moments: list[float] = field(default_factory=list)   # timestamps of key emotional peaks
    transition_points: list[float] = field(default_factory=list)  # timestamps where transitions happen


# ─────────────────────────────────────────────────────────────────────────────
# ARTISTIC DECISION ENGINE
# ─────────────────────────────────────────────────────────────────────────────

class ArtisticDecisionEngine:
    """
    Simulates a senior producer making intentional arrangement decisions.

    Strategy:
      1. Identify the best available section from each song for each act
      2. Ensure the energy arc follows: low → rise → peak → fall → low
      3. Prefer dominant track's vocals for emotionally important acts
      4. Use best compatibility pairings where possible
      5. Avoid repeating the same section pair more than twice

    Usage:
        engine = ArtisticDecisionEngine()
        plan = engine.plan(map_a, map_b, compatibility_report)
    """

    def plan(
        self,
        map_a: SongMap,
        map_b: SongMap,
        report: CompatibilityReport,
    ) -> NarrativePlan:
        """
        Build the NarrativePlan from compatibility data.
        """
        logger.info(
            f"[ArtisticDecisionEngine] Building narrative plan — "
            f"dominant={report.dominant_track}"
        )

        dominant = report.dominant_track
        non_dominant = "B" if dominant == "A" else "A"
        map_dom = map_a if dominant == "A" else map_b
        map_sup = map_b if dominant == "A" else map_a

        acts: list[ActAssignment] = []
        used_pairs: list[tuple[str, str]] = []  # (label_a, label_b) used

        for act_name in NARRATIVE_ACTS:
            assignment = self._assign_act(
                act_name=act_name,
                map_dom=map_dom,
                map_sup=map_sup,
                dominant=dominant,
                non_dominant=non_dominant,
                all_pairings=report.all_pairings,
                used_pairs=used_pairs,
            )
            if assignment:
                acts.append(assignment)
                if assignment.pairing:
                    used_pairs.append((
                        assignment.pairing.section_a.label,
                        assignment.pairing.section_b.label,
                    ))

        # ── Calculate estimated duration ─────────────────────────
        # Each act is proportional: intro/outro = short, climax = long
        act_durations = {
            "intro":          18.0,
            "build":          30.0,
            "first_payoff":   30.0,
            "emotional_rise": 24.0,
            "climax":         36.0,
            "release":        24.0,
            "outro":          18.0,
        }
        total_dur = sum(act_durations.get(a.act, 24.0) for a in acts)

        # ── Find hook moments ─────────────────────────────────────
        hook_moments = self._identify_hooks(acts, act_durations)

        # ── Transition points ─────────────────────────────────────
        transition_points = self._compute_transitions(acts, act_durations)

        # ── Emotional arc description ─────────────────────────────
        arc_desc = self._describe_arc(acts, dominant, map_dom, map_sup)

        logger.info(
            f"[ArtisticDecisionEngine] Plan ready — "
            f"{len(acts)} acts, ~{total_dur:.0f}s, {len(hook_moments)} hooks"
        )

        return NarrativePlan(
            dominant_track=dominant,
            narrative_acts=acts,
            estimated_duration=round(total_dur, 1),
            emotional_arc_description=arc_desc,
            hook_moments=hook_moments,
            transition_points=transition_points,
        )

    # ─────────────────────────────────────────────────────────────────────
    # ACT ASSIGNMENT
    # ─────────────────────────────────────────────────────────────────────

    def _assign_act(
        self,
        act_name: str,
        map_dom: SongMap,
        map_sup: SongMap,
        dominant: str,
        non_dominant: str,
        all_pairings: list[SectionPairing],
        used_pairs: list[tuple[str, str]],
    ) -> ActAssignment | None:
        """
        Select the best section pair for a given act.
        Strategy:
          - dominant track provides primary emotional content
          - support track fills the instrumental/pad layer
        """
        preferred_labels = _ACT_PREFERRED_LABELS[act_name]
        target_energy = _ACT_ENERGY_TARGETS[act_name]

        # ── Find best section from dominant track for this act ───
        dom_section = self._best_section_for_act(
            map_dom.sections, preferred_labels, target_energy, act_name
        )
        if dom_section is None:
            # Fallback: use any section from dominant track
            dom_section = self._closest_energy_section(
                map_dom.sections, target_energy
            )

        # ── Find best support section from non-dominant track ────
        # Support should be complementary: if dom is vocal, sup is instrumental
        sup_section = self._best_support_section(
            map_sup.sections, dom_section, preferred_labels, target_energy
        )

        # ── Find the scored pairing that matches these sections ──
        pairing = self._find_pairing(
            all_pairings,
            dom_section,
            sup_section,
            dominant,
            used_pairs,
        )

        actual_energy = dom_section.mean_energy if dom_section else 0.0
        notes = self._generate_notes(act_name, dom_section, sup_section, dominant)

        return ActAssignment(
            act=act_name,
            primary_section=dom_section,
            primary_track=dominant,
            support_section=sup_section,
            support_track=non_dominant,
            pairing=pairing,
            target_energy=target_energy,
            actual_energy=round(actual_energy, 3),
            notes=notes,
        )

    def _best_section_for_act(
        self,
        sections: list[SectionBlock],
        preferred_labels: list[str],
        target_energy: float,
        act_name: str,
    ) -> SectionBlock | None:
        """
        Score each section for suitability in this act.
        Combines label match + energy proximity.
        """
        if not sections:
            return None

        scored: list[tuple[float, SectionBlock]] = []

        for sec in sections:
            # Label match bonus (higher = better match)
            if sec.label in preferred_labels:
                label_score = 1.0 - (preferred_labels.index(sec.label) * 0.2)
            else:
                label_score = 0.0

            # Energy proximity (how close to target)
            energy_score = 1.0 - abs(sec.mean_energy - target_energy)

            # Prefer vocal sections for emotionally important acts
            vocal_bonus = 0.0
            if act_name in ("first_payoff", "climax", "emotional_rise"):
                vocal_bonus = 0.2 if sec.is_vocal else 0.0
            elif act_name in ("intro", "release", "outro"):
                vocal_bonus = 0.1 if not sec.is_vocal else 0.0

            composite = label_score * 0.40 + energy_score * 0.45 + vocal_bonus * 0.15
            scored.append((composite, sec))

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1] if scored else None

    def _best_support_section(
        self,
        support_sections: list[SectionBlock],
        primary: SectionBlock | None,
        preferred_labels: list[str],
        target_energy: float,
    ) -> SectionBlock | None:
        """
        Find support section that complements the primary section.
        If primary is vocal → prefer non-vocal support.
        If primary is instrumental → prefer vocal support.
        """
        if not support_sections or primary is None:
            return None

        want_vocal = not primary.is_vocal
        target_sup_energy = 1.0 - primary.mean_energy  # complementary energy

        # Clamp: support energy should not be below 0.1 or above 0.9
        target_sup_energy = float(np.clip(target_sup_energy, 0.1, 0.9))

        scored: list[tuple[float, SectionBlock]] = []
        for sec in support_sections:
            vocal_match = 1.0 if (sec.is_vocal == want_vocal) else 0.0
            energy_prox = 1.0 - abs(sec.mean_energy - target_sup_energy)
            label_match = 0.3 if sec.label in preferred_labels else 0.0
            composite = vocal_match * 0.50 + energy_prox * 0.35 + label_match * 0.15
            scored.append((composite, sec))

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1] if scored else None

    def _closest_energy_section(
        self, sections: list[SectionBlock], target: float
    ) -> SectionBlock | None:
        if not sections:
            return None
        return min(sections, key=lambda s: abs(s.mean_energy - target))

    def _find_pairing(
        self,
        all_pairings: list[SectionPairing],
        dom_section: SectionBlock | None,
        sup_section: SectionBlock | None,
        dominant: str,
        used_pairs: list[tuple[str, str]],
    ) -> SectionPairing | None:
        """
        Find a scored pairing that matches the chosen primary + support sections.
        Falls back to best unused pairing with matching labels.
        """
        if dom_section is None or sup_section is None:
            return None

        for pairing in all_pairings:
            if dominant == "A":
                a_match = pairing.section_a.label == dom_section.label
                b_match = pairing.section_b.label == sup_section.label
            else:
                a_match = pairing.section_a.label == sup_section.label
                b_match = pairing.section_b.label == dom_section.label

            pair_key = (pairing.section_a.label, pairing.section_b.label)
            if a_match and b_match and used_pairs.count(pair_key) < 2:
                return pairing

        # Fallback: return top-ranked unused pairing
        for pairing in all_pairings:
            pair_key = (pairing.section_a.label, pairing.section_b.label)
            if used_pairs.count(pair_key) < 2:
                return pairing

        return all_pairings[0] if all_pairings else None

    # ─────────────────────────────────────────────────────────────────────
    # HOOK + TRANSITION DETECTION
    # ─────────────────────────────────────────────────────────────────────

    def _identify_hooks(
        self,
        acts: list[ActAssignment],
        act_durations: dict[str, float],
    ) -> list[float]:
        """
        Hook moments are the timestamps of first_payoff, climax, and emotional_rise acts.
        These are the moments that must have maximum impact.
        """
        hooks: list[float] = []
        t = 0.0
        for act in acts:
            dur = act_durations.get(act.act, 24.0)
            if act.act in ("first_payoff", "climax", "emotional_rise"):
                hooks.append(round(t, 2))
            t += dur
        return hooks

    def _compute_transitions(
        self,
        acts: list[ActAssignment],
        act_durations: dict[str, float],
    ) -> list[float]:
        """
        Transition points are the boundaries between acts.
        Arranger will place transition FX at these timestamps.
        """
        transitions: list[float] = []
        t = 0.0
        for i, act in enumerate(acts):
            dur = act_durations.get(act.act, 24.0)
            t += dur
            if i < len(acts) - 1:
                transitions.append(round(t, 2))
        return transitions

    # ─────────────────────────────────────────────────────────────────────
    # HUMAN-READABLE ARC DESCRIPTION
    # ─────────────────────────────────────────────────────────────────────

    def _generate_notes(
        self,
        act_name: str,
        primary: SectionBlock | None,
        support: SectionBlock | None,
        dominant: str,
    ) -> str:
        if primary is None:
            return f"No suitable section found for {act_name}"

        p_lbl = primary.label
        p_vocal = "vocal" if primary.is_vocal else "instrumental"
        s_lbl = support.label if support else "none"
        s_vocal = ("vocal" if support.is_vocal else "instrumental") if support else ""

        notes_map = {
            "intro":          f"Open with track {dominant} {p_vocal} {p_lbl}. Low energy atmospheric entry.",
            "build":          f"Layer track {dominant} {p_vocal} {p_lbl} over support {s_vocal} {s_lbl}. Tension rising.",
            "first_payoff":   f"FIRST DROP: track {dominant} {p_vocal} {p_lbl} unleashed. High impact entry.",
            "emotional_rise": f"Emotional arc continues: {dominant} {p_lbl} with {s_lbl} support. Intimacy zone.",
            "climax":         f"CLIMAX: Maximum energy. {dominant} {p_vocal} {p_lbl} + full support from {s_lbl}.",
            "release":        f"Release tension. {dominant} {p_vocal} {p_lbl} breathing room. Let emotion settle.",
            "outro":          f"Fade: {dominant} {p_lbl} slowly dissolves into silence.",
        }
        return notes_map.get(act_name, f"{act_name}: {p_lbl} + {s_lbl}")

    def _describe_arc(
        self,
        acts: list[ActAssignment],
        dominant: str,
        map_dom: SongMap,
        map_sup: SongMap,
    ) -> str:
        dom_key = map_dom.musical_key
        dom_bpm = map_dom.bpm
        sup_key = map_sup.musical_key

        act_names = [a.act.replace("_", " ") for a in acts]
        arc_str = " → ".join(act_names)

        return (
            f"Mashup narrative arc: {arc_str}. "
            f"Dominant track: {dominant} ({dom_key}, {dom_bpm:.0f} BPM). "
            f"Support track: {map_sup.track_id} ({sup_key}). "
            f"Estimated duration: ~{sum(_ACT_ENERGY_TARGETS.get(a.act, 0.5) * 30 for a in acts):.0f}s."
        )
