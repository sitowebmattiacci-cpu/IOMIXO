"""
IOMIXO AI — Mashup Composer (Orchestrator Layer)
==================================================
This module is the audio rendering engine.

Architecture:
  - The INTELLIGENCE (arrangement decisions, section scoring, narrative arc,
    vocal alignment, quality evaluation) lives in services/composer/
  - This module EXECUTES the render blueprint produced by that engine:
    reads stems, applies time-stretch/pitch-shift, places each AudioSegment
    at the correct output timeline position, applies FX markers, writes WAV.

Entry points:
  compose_mashup()           — legacy-compatible simple blend (fallback)
  compose_from_timeline()    — full intelligent composition using ArrangementTimeline
  run_full_composer_engine() — end-to-end: analysis → plan → quality eval → render
"""

import numpy as np
import librosa
import soundfile as sf
from loguru import logger
from typing import Callable, Optional

# ── Autonomous Composer Engine ──────────────────────────────────────────────
from services.composer.deep_analyzer import DeepAnalyzer
from services.composer.compatibility_scorer import CompatibilityScorer
from services.composer.artistic_decision_engine import ArtisticDecisionEngine
from services.composer.arrangement_builder import ArrangementBuilder, ArrangementTimeline, AudioSegment
from services.composer.transition_fx_engine import TransitionFXEngine, TransitionMarker
from services.composer.vocal_micro_aligner import VocalMicroAligner
from services.composer.quality_evaluator import QualityEvaluator, QualityReport


def _load_and_transform(
    stem_path: str,
    tempo_ratio: float,
    pitch_shift: int,
    target_sr: int = 44100,
) -> np.ndarray:
    """Load a stem (preserving stereo), time-stretch + pitch-shift to match target tempo/key."""
    # Load as mono=False to preserve stereo; result shape: (channels, samples) or (samples,)
    y, sr = librosa.load(stem_path, sr=target_sr, mono=False)

    # Ensure 2-D: (channels, samples)
    if y.ndim == 1:
        y = np.stack([y, y])

    if abs(tempo_ratio - 1.0) > 0.01:
        y = np.stack([
            librosa.effects.time_stretch(y[0], rate=tempo_ratio),
            librosa.effects.time_stretch(y[1], rate=tempo_ratio),
        ])

    if pitch_shift != 0:
        y = np.stack([
            librosa.effects.pitch_shift(y[0], sr=target_sr, n_steps=pitch_shift),
            librosa.effects.pitch_shift(y[1], sr=target_sr, n_steps=pitch_shift),
        ])

    return y  # shape: (2, samples)


def _load_stereo(stem_path: str, target_sr: int = 44100) -> np.ndarray:
    """Load a stem preserving stereo. Returns (2, samples)."""
    y, _ = librosa.load(stem_path, sr=target_sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y  # shape: (2, samples)


def _pad_or_loop(y: np.ndarray, target_len: int) -> np.ndarray:
    """Loop (tile) a stem until it reaches target_len samples, then trim."""
    # y shape: (2, samples)
    n_samples = y.shape[1]
    if n_samples >= target_len:
        return y[:, :target_len]
    reps = int(np.ceil(target_len / n_samples))
    return np.tile(y, (1, reps))[:, :target_len]


def compose_mashup(
    stems_a:    dict[str, str],
    stems_b:    dict[str, str],
    analysis_a: dict,
    analysis_b: dict,
    transform:  dict,
    output_path: str,
    progress_cb: Callable[[int], None] | None = None,
    target_sr:   int = 44100,
) -> None:
    """
    Build mashup:
      - Track A provides: vocals + bass
      - Track B provides: drums + guitar + piano + other  (time+pitch aligned)
    Then blend into a single true-stereo WAV.
    """
    pitch_shift = transform["pitch_shift_semitones"]
    tempo_ratio = transform["tempo_ratio"]

    if progress_cb: progress_cb(5)

    # ── Load Track A stems (no transform — A is reference) ─────
    layers: list[np.ndarray] = []

    for stem_name in ("vocals", "bass"):
        if stem_name in stems_a:
            y = _load_stereo(stems_a[stem_name], target_sr)
            layers.append(y)
            logger.debug(f"Loaded A/{stem_name}: {y.shape}")

    if progress_cb: progress_cb(25)

    # ── Load Track B stems (transformed to A's tempo/key) ──────
    for stem_name in ("drums", "guitar", "piano", "other"):
        if stem_name in stems_b:
            y = _load_and_transform(stems_b[stem_name], tempo_ratio, pitch_shift, target_sr)
            layers.append(y)
            logger.debug(f"Loaded+transformed B/{stem_name}: {y.shape}")

    if progress_cb: progress_cb(65)

    if not layers:
        raise ValueError("No audio stems available to compose")

    # ── Determine target length: use longest layer, loop shorter ones ──
    max_len = max(l.shape[1] for l in layers)
    layers  = [_pad_or_loop(l, max_len) for l in layers]

    # ── Sum stereo layers and normalize ────────────────────────
    mixed = np.zeros((2, max_len), dtype=np.float32)
    for layer in layers:
        mixed += layer.astype(np.float32)

    # Peak normalize to -1 dBFS per channel
    peak = np.max(np.abs(mixed))
    if peak > 0:
        mixed = mixed / peak * 0.891  # ~-1 dBFS

    if progress_cb: progress_cb(90)

    # ── Write stereo WAV: soundfile expects (samples, channels) ─
    sf.write(output_path, mixed.T, target_sr, subtype="PCM_24")
    duration = max_len / target_sr
    logger.info(f"Mashup written to {output_path} ({duration:.1f}s, stereo)")

    if progress_cb: progress_cb(100)


# ─────────────────────────────────────────────────────────────────────────────
# INTELLIGENT RENDER: compose_from_timeline
# ─────────────────────────────────────────────────────────────────────────────

def compose_from_timeline(
    stems_a: dict[str, str],
    stems_b: dict[str, str],
    timeline: ArrangementTimeline,
    transition_markers: list[TransitionMarker],
    output_path: str,
    progress_cb: Optional[Callable[[int], None]] = None,
    target_sr: int = 44100,
) -> None:
    """
    Render the final mashup WAV by executing the ArrangementTimeline blueprint.

    For each AudioSegment:
      - Load the specified stems from the correct source track
      - Apply pitch-shift + time-stretch per the segment's layer parameters
      - Place the audio at the correct output_start timestamp
      - Apply fade_in / fade_out envelopes
      - Mix all layers together into a stereo output buffer

    Transition FX markers are applied as gain automation (attack/decay) at
    their specified positions. Full DSP synthesis of FX (risers, cymbal hits)
    is handled separately by the mastering_engine post-processing step.
    """
    logger.info(
        f"[compose_from_timeline] Rendering {len(timeline.segments)} segments "
        f"into {output_path}"
    )

    total_samples = int(timeline.total_duration * target_sr) + target_sr  # +1s safety buffer
    output = np.zeros((2, total_samples), dtype=np.float32)

    if progress_cb:
        progress_cb(5)

    for seg_idx, seg in enumerate(timeline.segments):
        _render_segment(
            seg=seg,
            stems_a=stems_a,
            stems_b=stems_b,
            output=output,
            target_sr=target_sr,
        )
        if progress_cb:
            pct = 5 + int((seg_idx + 1) / len(timeline.segments) * 80)
            progress_cb(pct)

    # ── Apply transition gain automation ────────────────────────────────
    for marker in transition_markers:
        _apply_transition_gain(marker, output, target_sr)

    if progress_cb:
        progress_cb(90)

    # ── Peak normalize ───────────────────────────────────────────────────
    peak = np.max(np.abs(output))
    if peak > 0:
        output = output / peak * 0.891  # ~-1 dBFS headroom for mastering

    # ── Write ────────────────────────────────────────────────────────────
    sf.write(output_path, output.T, target_sr, subtype="PCM_24")
    duration = total_samples / target_sr
    logger.info(
        f"[compose_from_timeline] Rendered {duration:.1f}s stereo WAV → {output_path}"
    )

    if progress_cb:
        progress_cb(100)


def _render_segment(
    seg: AudioSegment,
    stems_a: dict[str, str],
    stems_b: dict[str, str],
    output: np.ndarray,
    target_sr: int,
) -> None:
    """
    Render a single AudioSegment into the output buffer.
    Loads stems from the specified tracks, transforms, and mixes.
    """
    out_start_sample = int(seg.output_start * target_sr)
    out_end_sample = int(seg.output_end * target_sr)
    seg_samples = out_end_sample - out_start_sample

    if seg_samples <= 0:
        return

    layers: list[np.ndarray] = []

    for layer_def, stem_dict in [(seg.layer_a, stems_a), (seg.layer_b, stems_b)]:
        if layer_def is None:
            continue

        for stem_name in layer_def.stems:
            path = stem_dict.get(stem_name)
            if path is None:
                continue

            y = _load_and_transform_stem(
                stem_path=path,
                tempo_ratio=layer_def.tempo_ratio,
                pitch_shift=layer_def.pitch_shift,
                target_sr=target_sr,
            )

            # Slice from source position
            src_start_sample = int(
                (seg.source_a_start if layer_def.track == "A" else seg.source_b_start)
                * target_sr
            )
            y = y[:, src_start_sample:] if y.shape[1] > src_start_sample else y

            # Loop / pad to segment length
            y = _pad_or_loop(y, seg_samples)

            # Apply gain
            y = y * layer_def.gain

            layers.append(y)

    if not layers:
        return

    # Sum layers
    mixed = np.zeros((2, seg_samples), dtype=np.float32)
    for layer in layers:
        mixed += layer.astype(np.float32)

    # Apply fade envelopes
    if seg.fade_in > 0:
        fade_in_samples = min(int(seg.fade_in * target_sr), seg_samples)
        fade_env = np.linspace(0.0, 1.0, fade_in_samples)
        mixed[:, :fade_in_samples] *= fade_env

    if seg.fade_out > 0:
        fade_out_samples = min(int(seg.fade_out * target_sr), seg_samples)
        fade_env = np.linspace(1.0, 0.0, fade_out_samples)
        mixed[:, seg_samples - fade_out_samples:] *= fade_env

    # Write into output buffer (add, not overwrite — supports crossfades)
    end_sample = min(out_start_sample + seg_samples, output.shape[1])
    actual_samples = end_sample - out_start_sample
    output[:, out_start_sample:end_sample] += mixed[:, :actual_samples]


def _apply_transition_gain(
    marker: TransitionMarker,
    output: np.ndarray,
    target_sr: int,
) -> None:
    """
    Apply a gain automation curve at the transition marker position.
    For now: brief duck (gain reduction) at the transition point to
    simulate the "breathing space" before a new section hits.
    Full FX synthesis (risers, reverb tails) is done in the mastering stage.
    """
    if "silence_cut" in marker.fx_chain:
        # Insert a short silence gap
        silence_params = marker.params.get("silence_cut", {})
        silence_ms = silence_params.get("silence_duration_ms", 80)
        silence_samples = int((silence_ms / 1000.0) * target_sr)
        cut_sample = int(marker.position * target_sr)
        end_sample = min(cut_sample + silence_samples, output.shape[1])
        output[:, cut_sample:end_sample] *= 0.0

    elif "impact" in marker.fx_chain:
        # Boost gain at impact moment (compensate for the drop hit)
        impact_params = marker.params.get("impact", {})
        impact_sample = int(marker.position * target_sr)
        decay_samples = int((impact_params.get("decay_ms", 120) / 1000.0) * target_sr)
        end_sample = min(impact_sample + decay_samples, output.shape[1])
        gain_env = np.linspace(1.15, 1.0, end_sample - impact_sample).astype(np.float32)
        output[:, impact_sample:end_sample] *= gain_env


# ─────────────────────────────────────────────────────────────────────────────
# FULL END-TO-END PIPELINE: run_full_composer_engine
# ─────────────────────────────────────────────────────────────────────────────

def run_full_composer_engine(
    mix_path_a: str,
    mix_path_b: str,
    stems_a: dict[str, str],
    stems_b: dict[str, str],
    transform: dict,
    output_path: str,
    progress_cb: Optional[Callable[[int], None]] = None,
    target_sr: int = 44100,
) -> dict:
    """
    End-to-end intelligent mashup composition:

    1. DeepAnalyzer          → SongMap A + SongMap B
    2. CompatibilityScorer   → CompatibilityReport
    3. QualityEvaluator      → generates N_CANDIDATES plans, picks best
       (internally calls ArtisticDecisionEngine + ArrangementBuilder +
        TransitionFXEngine + VocalMicroAligner)
    4. compose_from_timeline → renders the selected ArrangementTimeline to WAV

    Returns dict with render metadata and quality report for the job record.
    """
    logger.info("[run_full_composer_engine] Starting autonomous mashup composition")

    if progress_cb:
        progress_cb(2)

    # ── Stage 1: Deep analysis ───────────────────────────────────────────
    analyzer = DeepAnalyzer(sr=target_sr)
    logger.info("[run_full_composer_engine] Analyzing Track A")
    map_a = analyzer.analyze(
        mix_path=mix_path_a,
        vocal_stem_path=stems_a.get("vocals"),
        track_id="A",
    )

    if progress_cb:
        progress_cb(15)

    logger.info("[run_full_composer_engine] Analyzing Track B")
    map_b = analyzer.analyze(
        mix_path=mix_path_b,
        vocal_stem_path=stems_b.get("vocals"),
        track_id="B",
    )

    if progress_cb:
        progress_cb(30)

    # ── Stage 2: Compatibility scoring ───────────────────────────────────
    logger.info("[run_full_composer_engine] Scoring compatibility")
    scorer = CompatibilityScorer()
    compat_report = scorer.score(map_a, map_b)

    if progress_cb:
        progress_cb(40)

    # ── Stage 3: Quality evaluation (generates 3 candidates, picks best) ─
    logger.info("[run_full_composer_engine] Evaluating arrangement candidates")
    evaluator = QualityEvaluator()
    quality_report: QualityReport = evaluator.evaluate(
        map_a=map_a,
        map_b=map_b,
        compatibility_report=compat_report,
        transform=transform,
    )

    if progress_cb:
        progress_cb(60)

    # ── Stage 4: Render selected timeline ────────────────────────────────
    logger.info(
        f"[run_full_composer_engine] Rendering selected candidate "
        f"{quality_report.selected_candidate_id + 1} "
        f"(score={quality_report.final_scores.overall:.3f})"
    )
    compose_from_timeline(
        stems_a=stems_a,
        stems_b=stems_b,
        timeline=quality_report.selected_timeline,
        transition_markers=quality_report.selected_transitions,
        output_path=output_path,
        progress_cb=lambda p: progress_cb(60 + int(p * 0.38)) if progress_cb else None,
        target_sr=target_sr,
    )

    if progress_cb:
        progress_cb(100)

    # ── Return metadata for job record ───────────────────────────────────
    return {
        "quality_report": QualityEvaluator.report_to_json(quality_report),
        "arrangement_timeline": quality_report.selected_timeline.to_render_instructions(),
        "transition_markers": TransitionFXEngine().to_json(
            quality_report.selected_transitions
        ),
        "vocal_alignment": VocalMicroAligner.to_json(quality_report.selected_alignment),
        "compatibility": {
            "overall_score": compat_report.overall_score,
            "dominant_track": compat_report.dominant_track,
            "key_compatibility": compat_report.key_compatibility,
            "tempo_compatibility": compat_report.tempo_compatibility,
            "recommendation": compat_report.recommendation,
        },
        "song_maps": {
            "track_a": {
                "bpm": map_a.bpm,
                "key": map_a.musical_key,
                "vocal_density": map_a.vocal_density,
                "sections": len(map_a.sections),
            },
            "track_b": {
                "bpm": map_b.bpm,
                "key": map_b.musical_key,
                "vocal_density": map_b.vocal_density,
                "sections": len(map_b.sections),
            },
        },
    }
