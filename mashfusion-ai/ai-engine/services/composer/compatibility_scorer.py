"""
IOMIXO AI — CompatibilityScorer
================================
Stage 2: Cross-song compatibility scoring matrix

Evaluates every section of Song A against every section of Song B
across 6 musical dimensions and produces a ranked pairing list.

Scoring dimensions:
  1. Harmonic compatibility  (chroma cosine similarity + Camelot Wheel)
  2. Rhythmic compatibility  (BPM distance + beat grid alignment)
  3. Vocal density compatibility (avoid dual-vocal clash)
  4. Energy compatibility    (complementary energy levels)
  5. Emotional tension compatibility (narrative arc matching)
  6. Spectral space fit      (frequency bandwidth non-overlap)

Output:
  - SectionPairing list sorted by composite score descending
  - Overall track compatibility score
  - Recommended dominant track (A or B)
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from itertools import product
from loguru import logger

from .deep_analyzer import SongMap, SectionBlock


# ─────────────────────────────────────────────────────────────────────────────
# CAMELOT WHEEL
# ─────────────────────────────────────────────────────────────────────────────
# Maps musical key strings to Camelot positions.
# Compatible keys are those ±1 step on the wheel, or relative major/minor.

_CAMELOT_MAP: dict[str, tuple[int, str]] = {
    # (number, A=minor/B=major)
    "A♭ major": (1, "B"),  "G# major": (1, "B"),
    "E♭ minor": (1, "A"),  "D# minor": (1, "A"),
    "E♭ major": (2, "B"),  "D# major": (2, "B"),
    "B♭ minor": (2, "A"),  "A# minor": (2, "A"),
    "B♭ major": (3, "B"),  "A# major": (3, "B"),
    "F minor":  (3, "A"),
    "F major":  (4, "B"),
    "C minor":  (4, "A"),
    "C major":  (5, "B"),
    "G minor":  (5, "A"),
    "G major":  (6, "B"),
    "D minor":  (6, "A"),
    "D major":  (7, "B"),
    "A minor":  (7, "A"),
    "A major":  (8, "B"),
    "E minor":  (8, "A"),
    "E major":  (9, "B"),
    "B minor":  (9, "A"),
    "B major":  (10, "B"),
    "F# minor": (10, "A"), "G♭ minor": (10, "A"),
    "F# major": (11, "B"), "G♭ major": (11, "B"),
    "C# minor": (11, "A"), "D♭ minor": (11, "A"),
    "C# major": (12, "B"), "D♭ major": (12, "B"),
    "A♭ minor": (12, "A"), "G# minor": (12, "A"),
}

# Normalize key name: replace ♭/♯ with b/#
def _normalize_key(key: str) -> str:
    return key.replace("♭", "b").replace("♯", "#")


def _camelot_distance(key_a: str, key_b: str) -> float:
    """
    Returns harmonic distance (0.0=identical, 1.0=tritone/maximally incompatible).
    Uses Camelot Wheel: compatible = 0, adjacent = 1 step, incompatible = 6 steps.
    """
    a = _CAMELOT_MAP.get(_normalize_key(key_a))
    b = _CAMELOT_MAP.get(_normalize_key(key_b))
    if a is None or b is None:
        # Fallback: use chromatic semitone distance
        return 0.5

    num_a, mode_a = a
    num_b, mode_b = b

    if mode_a == mode_b:
        steps = min(abs(num_a - num_b), 12 - abs(num_a - num_b))
    else:
        # Relative major/minor = 0 distance; different mode adds 1
        steps = min(abs(num_a - num_b), 12 - abs(num_a - num_b)) + 1

    return round(float(np.clip(steps / 6.0, 0, 1)), 4)


def _chroma_cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Cosine similarity between two 12-dim chroma vectors."""
    a = np.array(vec_a, dtype=np.float32)
    b = np.array(vec_b, dtype=np.float32)
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-8:
        return 0.0
    return round(float(np.clip(np.dot(a, b) / denom, 0, 1)), 4)


# ─────────────────────────────────────────────────────────────────────────────
# DATA STRUCTURES
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SectionScore:
    """Breakdown of scores for a single dimension."""
    harmonic: float = 0.0
    rhythmic: float = 0.0
    vocal_density: float = 0.0
    energy: float = 0.0
    tension: float = 0.0
    spectral: float = 0.0

    @property
    def composite(self) -> float:
        """Weighted composite score."""
        return round(
            self.harmonic      * 0.30 +
            self.rhythmic      * 0.20 +
            self.vocal_density * 0.20 +
            self.energy        * 0.15 +
            self.tension       * 0.10 +
            self.spectral      * 0.05,
            4
        )


@dataclass
class SectionPairing:
    """
    A ranked pairing between one section of Song A and one section of Song B.
    Describes what goes ON TOP of what.
    """
    section_a: SectionBlock
    section_b: SectionBlock
    score: SectionScore
    pairing_type: str       # e.g. "A_vocals_over_B_instrumental"
    description: str        # human-readable explanation for the arranger
    rank: int = 0           # filled after sorting

    @property
    def composite_score(self) -> float:
        return self.score.composite


@dataclass
class CompatibilityReport:
    """Complete compatibility analysis between two tracks."""
    track_a_id: str
    track_b_id: str
    overall_score: float               # 0–1
    dominant_track: str                # "A" or "B"
    key_compatibility: float           # 0–1
    tempo_compatibility: float         # 0–1
    best_pairings: list[SectionPairing] = field(default_factory=list)
    all_pairings: list[SectionPairing] = field(default_factory=list)
    recommendation: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# COMPATIBILITY SCORER
# ─────────────────────────────────────────────────────────────────────────────

class CompatibilityScorer:
    """
    Scores musical compatibility between every section pair of Song A and Song B.

    Usage:
        scorer = CompatibilityScorer()
        report = scorer.score(song_map_a, song_map_b)
    """

    # Weights for composite scoring
    _W_HARMONIC      = 0.30
    _W_RHYTHMIC      = 0.20
    _W_VOCAL_DENSITY = 0.20
    _W_ENERGY        = 0.15
    _W_TENSION       = 0.10
    _W_SPECTRAL      = 0.05

    def score(self, map_a: SongMap, map_b: SongMap) -> CompatibilityReport:
        """
        Compute full compatibility report between two SongMaps.
        """
        logger.info(
            f"[CompatibilityScorer] Scoring {map_a.track_id} vs {map_b.track_id}"
        )

        # ── Track-level compatibility ────────────────────────────
        key_compat = self._key_compatibility(map_a, map_b)
        tempo_compat = self._tempo_compatibility(map_a, map_b)

        # ── Determine dominant track ─────────────────────────────
        dominant = self._determine_dominant(map_a, map_b)

        # ── Section-level pairing matrix ─────────────────────────
        all_pairings: list[SectionPairing] = []

        for sec_a, sec_b in product(map_a.sections, map_b.sections):
            pairing = self._score_section_pair(
                sec_a, sec_b, map_a, map_b, key_compat, tempo_compat
            )
            if pairing is not None:
                all_pairings.append(pairing)

        # ── Sort by composite score ──────────────────────────────
        all_pairings.sort(key=lambda p: p.composite_score, reverse=True)
        for rank, pairing in enumerate(all_pairings):
            pairing.rank = rank + 1

        # ── Top 20 best pairings ─────────────────────────────────
        best_pairings = all_pairings[:20]

        # ── Overall score ────────────────────────────────────────
        if all_pairings:
            top_scores = [p.composite_score for p in all_pairings[:10]]
            overall_score = round(float(np.mean(top_scores)), 4)
        else:
            overall_score = 0.0

        recommendation = self._build_recommendation(
            overall_score, key_compat, tempo_compat, dominant, map_a, map_b
        )

        logger.info(
            f"[CompatibilityScorer] Overall={overall_score:.3f} "
            f"Dominant={dominant} Pairings={len(all_pairings)}"
        )

        return CompatibilityReport(
            track_a_id=map_a.track_id,
            track_b_id=map_b.track_id,
            overall_score=overall_score,
            dominant_track=dominant,
            key_compatibility=key_compat,
            tempo_compatibility=tempo_compat,
            best_pairings=best_pairings,
            all_pairings=all_pairings,
            recommendation=recommendation,
        )

    # ─────────────────────────────────────────────────────────────────────
    # TRACK-LEVEL SCORING
    # ─────────────────────────────────────────────────────────────────────

    def _key_compatibility(self, map_a: SongMap, map_b: SongMap) -> float:
        """
        Composite key compatibility:
          - Camelot wheel proximity (70%)
          - Chroma vector cosine similarity (30%)
        """
        camelot_dist = _camelot_distance(map_a.musical_key, map_b.musical_key)
        camelot_score = 1.0 - camelot_dist  # 1 = identical, 0 = incompatible

        if map_a.chroma_vector and map_b.chroma_vector:
            chroma_sim = _chroma_cosine_similarity(
                map_a.chroma_vector, map_b.chroma_vector
            )
        else:
            chroma_sim = camelot_score  # fallback

        return round(0.70 * camelot_score + 0.30 * chroma_sim, 4)

    def _tempo_compatibility(self, map_a: SongMap, map_b: SongMap) -> float:
        """
        Tempo compatibility score.
        BPM ratios of 1:1, 2:1, 1:2 are maximally compatible.
        Returns 0–1 where 1 = perfect tempo alignment.
        """
        bpm_a = map_a.bpm
        bpm_b = map_b.bpm

        if bpm_a <= 0 or bpm_b <= 0:
            return 0.5

        # Check harmonic tempo relationships (1:1, 2:1, 1:2, 3:2)
        ratios = [1.0, 2.0, 0.5, 1.5, 2.0/3.0]
        best = max(
            1.0 - abs(bpm_a / bpm_b - r) / r
            for r in ratios
        )
        return round(float(np.clip(best, 0, 1)), 4)

    def _determine_dominant(self, map_a: SongMap, map_b: SongMap) -> str:
        """
        Decide which track should be emotionally dominant (provide main vocals).
        Prefers the track with:
          - Higher vocal energy ratio
          - Higher harmonic complexity
          - More vocal phrases
        """
        score_a = (
            map_a.vocal_energy_ratio * 0.50 +
            map_a.harmonic_complexity * 0.30 +
            (len(map_a.vocal_phrases) / max(len(map_b.vocal_phrases), 1)) * 0.20
        )
        score_b = (
            map_b.vocal_energy_ratio * 0.50 +
            map_b.harmonic_complexity * 0.30 +
            1.0 * 0.20  # normalized baseline
        )
        return "A" if score_a >= score_b else "B"

    # ─────────────────────────────────────────────────────────────────────
    # SECTION-LEVEL SCORING
    # ─────────────────────────────────────────────────────────────────────

    def _score_section_pair(
        self,
        sec_a: SectionBlock,
        sec_b: SectionBlock,
        map_a: SongMap,
        map_b: SongMap,
        key_compat: float,
        tempo_compat: float,
    ) -> SectionPairing | None:
        """
        Score compatibility between one section from A and one from B.
        Returns None if pairing makes no musical sense.
        """
        # Reject pairs with zero duration
        if (sec_a.end - sec_a.start) < 4.0 or (sec_b.end - sec_b.start) < 4.0:
            return None

        # ── 1. Harmonic ──────────────────────────────────────────
        harmonic_score = key_compat  # track-level key compat applies to all sections

        # ── 2. Rhythmic ──────────────────────────────────────────
        rhythmic_score = tempo_compat

        # ── 3. Vocal density ─────────────────────────────────────
        # Best pairings avoid two heavily vocal sections colliding
        # or put vocals from A over instrumental from B (or vice versa)
        vocal_density_score = self._vocal_density_score(sec_a, sec_b, map_a, map_b)

        # ── 4. Energy complementarity ────────────────────────────
        energy_score = self._energy_complementarity(sec_a, sec_b)

        # ── 5. Tension narrative ─────────────────────────────────
        tension_score = self._tension_narrative_score(sec_a, sec_b)

        # ── 6. Spectral non-overlap ──────────────────────────────
        spectral_score = self._spectral_space_score(
            sec_a, sec_b, map_a.spectral_centroid_mean, map_b.spectral_centroid_mean
        )

        score = SectionScore(
            harmonic=harmonic_score,
            rhythmic=rhythmic_score,
            vocal_density=vocal_density_score,
            energy=energy_score,
            tension=tension_score,
            spectral=spectral_score,
        )

        pairing_type = self._classify_pairing_type(sec_a, sec_b)
        description = self._build_description(sec_a, sec_b, score, pairing_type)

        return SectionPairing(
            section_a=sec_a,
            section_b=sec_b,
            score=score,
            pairing_type=pairing_type,
            description=description,
        )

    def _vocal_density_score(
        self,
        sec_a: SectionBlock,
        sec_b: SectionBlock,
        map_a: SongMap,
        map_b: SongMap,
    ) -> float:
        """
        Score based on vocal arrangement logic:
          - A_vocal + B_instrumental = very good (1.0)
          - A_instrumental + B_vocal = very good (1.0)
          - A_vocal + B_vocal = poor (0.1) — clash
          - A_instrumental + B_instrumental = moderate (0.6) — breakdown ok
        """
        a_is_vocal = sec_a.is_vocal
        b_is_vocal = sec_b.is_vocal

        if a_is_vocal and not b_is_vocal:
            return 1.00
        if not a_is_vocal and b_is_vocal:
            return 1.00
        if a_is_vocal and b_is_vocal:
            return 0.10  # vocal clash — penalize heavily
        # Both instrumental
        return 0.60

    def _energy_complementarity(
        self, sec_a: SectionBlock, sec_b: SectionBlock
    ) -> float:
        """
        Energy complementarity score.
        High + Low = excellent contrast (0.9)
        High + High = acceptable climax (0.7)
        Low + Low = acceptable breakdown (0.5)
        """
        e_a = sec_a.mean_energy
        e_b = sec_b.mean_energy
        diff = abs(e_a - e_b)

        # Complementary contrast is good
        if diff > 0.35:
            return 0.90
        if diff > 0.20:
            return 0.75
        # Both high-energy → climax collision (risky but impactful)
        if e_a > 0.65 and e_b > 0.65:
            return 0.70
        # Both low → smooth ambient blend
        if e_a < 0.40 and e_b < 0.40:
            return 0.55
        return 0.60

    def _tension_narrative_score(
        self, sec_a: SectionBlock, sec_b: SectionBlock
    ) -> float:
        """
        Tension narrative compatibility.
        Building tension + low tension = good (one drives while other supports)
        Both at same tension = natural blend
        """
        t_a = sec_a.mean_tension
        t_b = sec_b.mean_tension
        diff = abs(t_a - t_b)

        # One is very tense, other is calm → great contrast
        if diff > 0.40:
            return 0.85
        # Similar tension → smooth blend
        if diff < 0.15:
            return 0.75
        return 0.65

    def _spectral_space_score(
        self,
        sec_a: SectionBlock,
        sec_b: SectionBlock,
        centroid_a: float,
        centroid_b: float,
    ) -> float:
        """
        Tracks with different spectral centroids occupy different frequency
        ranges and blend better. Tracks with identical centroids may mask each other.
        """
        if centroid_a <= 0 or centroid_b <= 0:
            return 0.5
        ratio = min(centroid_a, centroid_b) / max(centroid_a, centroid_b)
        # ratio close to 1 = similar spectrum (less ideal)
        # ratio far from 1 = complementary spectrum (ideal)
        score = 1.0 - ratio  # 0 = identical, 1 = maximally different
        return round(float(np.clip(0.4 + score * 0.6, 0, 1)), 4)

    # ─────────────────────────────────────────────────────────────────────
    # PAIRING CLASSIFICATION
    # ─────────────────────────────────────────────────────────────────────

    def _classify_pairing_type(
        self, sec_a: SectionBlock, sec_b: SectionBlock
    ) -> str:
        """Classify the pairing into a human-readable arrangement type."""
        a_lbl = sec_a.label
        b_lbl = sec_b.label
        a_vocal = sec_a.is_vocal
        b_vocal = sec_b.is_vocal

        if a_vocal and not b_vocal:
            return f"A_{a_lbl}_vocals_over_B_{b_lbl}_instrumental"
        if not a_vocal and b_vocal:
            return f"B_{b_lbl}_vocals_over_A_{a_lbl}_instrumental"
        if a_vocal and b_vocal:
            return f"dual_vocals_{a_lbl}_A_plus_{b_lbl}_B"
        return f"instrumental_blend_{a_lbl}_A_plus_{b_lbl}_B"

    def _build_description(
        self,
        sec_a: SectionBlock,
        sec_b: SectionBlock,
        score: SectionScore,
        pairing_type: str,
    ) -> str:
        quality = (
            "excellent" if score.composite > 0.75
            else "good" if score.composite > 0.55
            else "moderate" if score.composite > 0.40
            else "poor"
        )
        return (
            f"[{quality.upper()}] {pairing_type.replace('_', ' ')} "
            f"— composite={score.composite:.2f} "
            f"(H={score.harmonic:.2f} R={score.rhythmic:.2f} "
            f"V={score.vocal_density:.2f} E={score.energy:.2f})"
        )

    # ─────────────────────────────────────────────────────────────────────
    # RECOMMENDATION
    # ─────────────────────────────────────────────────────────────────────

    def _build_recommendation(
        self,
        overall: float,
        key_compat: float,
        tempo_compat: float,
        dominant: str,
        map_a: SongMap,
        map_b: SongMap,
    ) -> str:
        issues = []
        if key_compat < 0.50:
            semitone_fix = "pitch-shift required"
            issues.append(f"low harmonic compatibility ({key_compat:.2f}) — {semitone_fix}")
        if tempo_compat < 0.50:
            issues.append(f"large tempo gap — time-stretch will be audible")
        issue_str = "; ".join(issues) if issues else "no critical issues"

        return (
            f"Overall compatibility: {overall:.2f}/1.0. "
            f"Dominant track: {dominant} (strongest vocals + energy). "
            f"Key compat: {key_compat:.2f}, Tempo compat: {tempo_compat:.2f}. "
            f"Issues: {issue_str}."
        )
