"""Intelligent preview snippet selector.

Scores every candidate window across an arranged AI mashup timeline and returns
the strongest 25-35 second segment for use as a monetisation teaser. Replaces
naive truncation: previews are the main emotional trigger for upgrade
conversion, so the window must land on hooks, drops, harmonic payoffs and
clean transitions — never on dead air or audible artifacts.

The selector operates on a rendered mono mix (the arranged output of one AI
variant). It is stem-aware when the caller supplies ``vocal_stem`` /
``drum_stem`` / ``bass_stem`` arrays, otherwise it derives surrogate signals
via harmonic-percussive source separation.

Public API
----------
- ``score_timeline``     : per-frame feature curves over the arranged audio
- ``select_best_window`` : highest-scoring 25-35 s window (with diversity)
- ``polish_clip``        : micro fade-in / outro tail so previews never start
                           or end abruptly
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
from loguru import logger


# ── Feature extraction ──────────────────────────────────────────────────────

# Frame hop for scoring — 0.5s gives ~60 frames per 30s window which is plenty
# for differentiating hooks/drops without breaking the wall-clock budget.
DEFAULT_HOP_SEC = 0.5
EPS = 1e-9


@dataclass
class TimelineFeatures:
    """Per-frame feature curves aligned to ``frame_times`` (seconds)."""
    sr: int
    hop_sec: float
    frame_times: np.ndarray              # (T,)
    vocal_density: np.ndarray            # vocal RMS / hook proxy
    beat_impact: np.ndarray              # percussive RMS
    low_energy: np.ndarray               # sub-bass RMS (drop proxy)
    spectral_flux: np.ndarray            # transition novelty
    harmonic_balance: np.ndarray         # harmonic↔percussive coherence
    artifact_penalty: np.ndarray         # clipping + silence + spectral spikes
    total_duration_sec: float


def _frame_rms(x: np.ndarray, hop: int, win: int) -> np.ndarray:
    """RMS energy per hop. Window is symmetric (centered)."""
    if x.size == 0:
        return np.zeros(0, dtype=np.float32)
    pad = win // 2
    xp = np.pad(x.astype(np.float32), (pad, pad), mode="constant")
    n_frames = 1 + (len(x) - 1) // hop
    out = np.empty(n_frames, dtype=np.float32)
    for i in range(n_frames):
        s = i * hop
        seg = xp[s:s + win]
        out[i] = float(np.sqrt(np.mean(seg * seg) + EPS))
    return out


def _normalize01(x: np.ndarray) -> np.ndarray:
    if x.size == 0:
        return x
    lo = float(np.percentile(x, 5))
    hi = float(np.percentile(x, 95))
    if hi - lo < EPS:
        return np.zeros_like(x)
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def _spectral_flux(x: np.ndarray, sr: int, hop: int, win: int) -> np.ndarray:
    """Onset-style novelty curve via STFT magnitude differences."""
    if x.size < win:
        return np.zeros(1, dtype=np.float32)
    try:
        import librosa
        S = np.abs(librosa.stft(x, n_fft=win, hop_length=hop, center=True))
        diff = np.diff(S, axis=1, prepend=S[:, :1])
        flux = np.maximum(diff, 0.0).sum(axis=0)
        return flux.astype(np.float32)
    except Exception as exc:
        logger.warning(f"spectral_flux fallback (librosa unavailable: {exc})")
        # Time-domain surrogate: absolute first difference RMS
        d = np.abs(np.diff(x, prepend=x[:1]))
        pad = win // 2
        dp = np.pad(d, (pad, pad))
        n = 1 + (len(d) - 1) // hop
        out = np.empty(n, dtype=np.float32)
        for i in range(n):
            s = i * hop
            out[i] = float(dp[s:s + win].mean())
        return out


def _hpss(x: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Split into harmonic + percussive surrogates via librosa.

    Returns ``(harmonic, percussive)`` as same-length float32 arrays. Falls
    back to a copy/zero pair if librosa is unavailable.
    """
    try:
        import librosa
        h, p = librosa.effects.hpss(x.astype(np.float32))
        return h.astype(np.float32), p.astype(np.float32)
    except Exception as exc:
        logger.warning(f"HPSS fallback (no librosa): {exc}")
        return x.astype(np.float32), np.zeros_like(x, dtype=np.float32)


def _lowpass_energy(x: np.ndarray, sr: int, cutoff_hz: float = 180.0) -> np.ndarray:
    """One-pole IIR low-pass; cheap drop / sub-bass detector."""
    if x.size == 0:
        return x
    # Exponential smoother — sufficient for a sub-bass envelope proxy.
    rc = 1.0 / (2.0 * np.pi * cutoff_hz)
    dt = 1.0 / sr
    alpha = dt / (rc + dt)
    out = np.empty_like(x, dtype=np.float32)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha * (float(x[i]) - acc)
        out[i] = acc
    return out


def _clipping_mask(x: np.ndarray, threshold: float = 0.985) -> np.ndarray:
    return (np.abs(x) >= threshold).astype(np.float32)


def score_timeline(
    audio: np.ndarray,
    sr: int,
    *,
    vocal_stem: np.ndarray | None = None,
    drum_stem: np.ndarray | None = None,
    bass_stem: np.ndarray | None = None,
    hop_sec: float = DEFAULT_HOP_SEC,
) -> TimelineFeatures:
    """Compute frame-level excitement features for an arranged output mix."""
    if audio.ndim > 1:
        audio = audio.mean(axis=-1)
    audio = audio.astype(np.float32)
    total_dur = len(audio) / float(sr) if sr > 0 else 0.0

    hop = max(1, int(round(hop_sec * sr)))
    win = max(hop * 2, int(round(0.05 * sr)))   # ~50 ms analysis frame minimum

    # Stem-aware features when supplied; surrogate via HPSS otherwise.
    if vocal_stem is None or drum_stem is None:
        harm, perc = _hpss(audio, sr)
    else:
        harm = vocal_stem.astype(np.float32) if vocal_stem.ndim == 1 else vocal_stem.mean(axis=-1).astype(np.float32)
        perc = drum_stem.astype(np.float32) if drum_stem.ndim == 1 else drum_stem.mean(axis=-1).astype(np.float32)
        # Trim to common length
        m = min(len(audio), len(harm), len(perc))
        audio, harm, perc = audio[:m], harm[:m], perc[:m]

    bass = bass_stem if bass_stem is not None else audio
    if bass.ndim > 1:
        bass = bass.mean(axis=-1)
    bass = bass.astype(np.float32)[:len(audio)]

    vocal_density = _frame_rms(harm, hop, win)
    beat_impact   = _frame_rms(perc, hop, win)
    full_rms      = _frame_rms(audio, hop, win)
    bass_lp       = _lowpass_energy(bass, sr, cutoff_hz=180.0)
    low_energy    = _frame_rms(bass_lp, hop, win)

    flux = _spectral_flux(audio, sr, hop=hop, win=max(2048, win))
    # Align flux length to RMS frame count
    T = len(full_rms)
    if len(flux) < T:
        flux = np.pad(flux, (0, T - len(flux)))
    flux = flux[:T]

    # Harmonic balance — windows where vocal AND beat both contribute strongly
    # are the rare "everything lands" moments. Subtract the gap; positive when
    # both present, negative when one dominates.
    vd_n = _normalize01(vocal_density)
    bi_n = _normalize01(beat_impact)
    harmonic_balance = (1.0 - np.abs(vd_n - bi_n)) * np.minimum(vd_n, bi_n)

    # Artifacts — frame-level penalty
    clip_frames = _frame_rms(_clipping_mask(audio), hop, win)
    silence = (full_rms < 1e-3).astype(np.float32)
    # Spectral flux extreme spikes (>p99) often indicate stem-edge artifacts.
    if T > 5:
        flux_spike_thr = float(np.percentile(flux, 99.5))
        flux_spikes = (flux > flux_spike_thr * 1.6).astype(np.float32)
    else:
        flux_spikes = np.zeros(T, dtype=np.float32)
    artifact = np.clip(clip_frames * 1.5 + silence * 1.0 + flux_spikes * 0.7, 0.0, 2.0)

    frame_times = np.arange(T, dtype=np.float32) * hop_sec

    return TimelineFeatures(
        sr=sr,
        hop_sec=hop_sec,
        frame_times=frame_times,
        vocal_density=_normalize01(vocal_density),
        beat_impact=_normalize01(beat_impact),
        low_energy=_normalize01(low_energy),
        spectral_flux=_normalize01(flux),
        harmonic_balance=harmonic_balance.astype(np.float32),
        artifact_penalty=artifact.astype(np.float32),
        total_duration_sec=total_dur,
    )


# ── Window scoring ──────────────────────────────────────────────────────────


@dataclass
class ScoredWindow:
    start_sec: float
    end_sec: float
    score: float
    components: dict = field(default_factory=dict)

    @property
    def duration_sec(self) -> float:
        return self.end_sec - self.start_sec


# Default scoring weights — tuned for monetisation teasers. Vocal hooks and
# drop impact dominate; transitions add excitement; artifacts are punitive.
DEFAULT_WEIGHTS = {
    "vocal_hook":    0.32,
    "beat_impact":   0.26,
    "low_drop":      0.14,
    "harmonic":      0.12,
    "transitions":   0.10,
    "head_pop":      0.06,   # bonus for a strong first 4s (immediate hook)
}
ARTIFACT_WEIGHT = 0.55


def _window_indices(features: TimelineFeatures, start_sec: float, end_sec: float) -> tuple[int, int]:
    if features.frame_times.size == 0:
        return 0, 0
    s = int(np.searchsorted(features.frame_times, start_sec, side="left"))
    e = int(np.searchsorted(features.frame_times, end_sec, side="right"))
    return max(0, s), max(s + 1, e)


def _score_window(
    features: TimelineFeatures,
    start_sec: float,
    end_sec: float,
    weights: dict[str, float],
) -> tuple[float, dict]:
    s, e = _window_indices(features, start_sec, end_sec)
    if e <= s:
        return -1e9, {}

    def seg(arr: np.ndarray) -> np.ndarray:
        return arr[s:e]

    vocal = float(seg(features.vocal_density).mean())
    beat  = float(seg(features.beat_impact).mean())
    low   = float(seg(features.low_energy).mean())
    harm  = float(seg(features.harmonic_balance).mean())
    flux  = float(seg(features.spectral_flux).mean())
    art   = float(seg(features.artifact_penalty).mean())

    # Head pop: average excitement of the first ~4s of the window — a strong
    # opening dramatically improves teaser conversion.
    head_end_sec = min(end_sec, start_sec + 4.0)
    hs, he = _window_indices(features, start_sec, head_end_sec)
    if he > hs:
        head_pop = float(
            (features.vocal_density[hs:he].mean() * 0.6
             + features.beat_impact[hs:he].mean() * 0.4)
        )
    else:
        head_pop = 0.0

    components = {
        "vocal_hook":  vocal,
        "beat_impact": beat,
        "low_drop":    low,
        "harmonic":    harm,
        "transitions": flux,
        "head_pop":    head_pop,
        "artifact":    art,
    }

    score = (
        weights["vocal_hook"]  * vocal
        + weights["beat_impact"] * beat
        + weights["low_drop"]    * low
        + weights["harmonic"]    * harm
        + weights["transitions"] * flux
        + weights["head_pop"]    * head_pop
        - ARTIFACT_WEIGHT        * art
    )
    return float(score), components


def _is_excluded(start_sec: float, end_sec: float, exclusions: Sequence[tuple[float, float]], min_gap_sec: float) -> bool:
    """Return True if window overlaps (with ``min_gap_sec`` margin) any exclusion."""
    for ex_s, ex_e in exclusions:
        if start_sec < ex_e + min_gap_sec and end_sec > ex_s - min_gap_sec:
            return True
    return False


def select_best_window(
    audio: np.ndarray,
    sr: int,
    *,
    target_min_sec: float = 25.0,
    target_max_sec: float = 35.0,
    hop_sec: float = DEFAULT_HOP_SEC,
    exclusions: Sequence[tuple[float, float]] | None = None,
    diversity_gap_sec: float = 8.0,
    weights: dict[str, float] | None = None,
    features: TimelineFeatures | None = None,
    vocal_stem: np.ndarray | None = None,
    drum_stem: np.ndarray | None = None,
    bass_stem: np.ndarray | None = None,
) -> ScoredWindow:
    """Slide a 25-35 s window over ``audio`` and return the highest-scoring one.

    ``exclusions`` lets the caller forbid windows that overlap previously
    chosen variants — encourages cross-version diversity. Each entry is a
    ``(start_sec, end_sec)`` tuple; windows within ``diversity_gap_sec`` of
    any exclusion are skipped (with a graceful relaxation if everything is
    excluded).
    """
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    exclusions = list(exclusions or [])

    if features is None:
        features = score_timeline(
            audio, sr,
            vocal_stem=vocal_stem, drum_stem=drum_stem, bass_stem=bass_stem,
            hop_sec=hop_sec,
        )

    total_dur = features.total_duration_sec
    if total_dur < target_min_sec:
        # Audio shorter than the minimum window — return the whole thing.
        score, comps = _score_window(features, 0.0, total_dur, weights)
        return ScoredWindow(0.0, total_dur, score, comps)

    # Search over multiple window lengths within [min, max] for flexibility.
    candidate_lens = sorted({
        target_min_sec,
        (target_min_sec + target_max_sec) / 2.0,
        target_max_sec,
    })

    # Slide step — half the hop is wasteful; one hop is the natural grid.
    step_sec = max(hop_sec, 0.5)

    # Enumerate every candidate once, then progressively relax the diversity
    # gap if no window survives. Guarantees that 3 calls with the same
    # exclusions never return identical picks unless the timeline is
    # degenerate (e.g. completely silent).
    candidates: list[ScoredWindow] = []
    for win_len in candidate_lens:
        max_start = max(0.0, total_dur - win_len)
        n_steps = int(max_start / step_sec) + 1
        for i in range(n_steps):
            s = round(i * step_sec, 4)
            e = s + win_len
            if e > total_dur + 1e-3:
                continue
            score, comps = _score_window(features, s, e, weights)
            candidates.append(ScoredWindow(s, e, score, comps))

    if not candidates:
        return ScoredWindow(0.0, total_dur, 0.0, {})

    candidates.sort(key=lambda w: w.score, reverse=True)

    # Try strict gap, then progressively halve it; finally accept any window
    # whose midpoint differs from every exclusion's midpoint.
    for gap in (diversity_gap_sec, diversity_gap_sec / 2.0, 0.0):
        for cand in candidates:
            if not _is_excluded(cand.start_sec, cand.end_sec, exclusions, gap):
                return cand

    # Last resort: return the highest-scoring window whose start differs from
    # every exclusion start by at least one hop.
    for cand in candidates:
        if all(abs(cand.start_sec - ex_s) > step_sec for ex_s, _ in exclusions):
            return cand

    return candidates[0]


def select_diverse_windows(
    audio: np.ndarray,
    sr: int,
    *,
    n: int = 3,
    target_min_sec: float = 25.0,
    target_max_sec: float = 35.0,
    diversity_gap_sec: float = 8.0,
    hop_sec: float = DEFAULT_HOP_SEC,
    weights: dict[str, float] | None = None,
    vocal_stem: np.ndarray | None = None,
    drum_stem: np.ndarray | None = None,
    bass_stem: np.ndarray | None = None,
) -> list[ScoredWindow]:
    """Greedy top-N pick with diversity exclusions.

    Useful when N variants share a single arranged timeline and we want each
    teaser to highlight a different musical moment.
    """
    features = score_timeline(
        audio, sr,
        vocal_stem=vocal_stem, drum_stem=drum_stem, bass_stem=bass_stem,
        hop_sec=hop_sec,
    )
    chosen: list[ScoredWindow] = []
    exclusions: list[tuple[float, float]] = []
    for _ in range(n):
        w = select_best_window(
            audio, sr,
            target_min_sec=target_min_sec, target_max_sec=target_max_sec,
            hop_sec=hop_sec, exclusions=exclusions,
            diversity_gap_sec=diversity_gap_sec, weights=weights,
            features=features,
        )
        chosen.append(w)
        exclusions.append((w.start_sec, w.end_sec))
    return chosen


# ── Preview composition polish ──────────────────────────────────────────────


def polish_clip(
    audio: np.ndarray,
    sr: int,
    *,
    intro_threshold: float = 0.18,
    outro_threshold: float = 0.18,
    intro_max_sec: float = 2.0,
    outro_max_sec: float = 2.0,
) -> np.ndarray:
    """Apply micro intro fade-in / outro tail when a clip starts or ends abruptly.

    "Abrupt" is measured by comparing the boundary RMS to the median RMS of
    the clip body. If the boundary is significantly louder than the floor the
    clip would clip the listener's ear — apply an exponential fade so the
    teaser feels intentionally crafted rather than truncated.
    """
    if audio.size == 0 or sr <= 0:
        return audio
    out = audio.astype(np.float32, copy=True)
    n = len(out)

    # Body reference RMS (middle 60% to avoid dragging in boundaries).
    body_lo = int(n * 0.2)
    body_hi = int(n * 0.8)
    body = out[body_lo:body_hi] if body_hi > body_lo else out
    body_rms = float(np.sqrt(np.mean(body * body) + EPS))
    if body_rms < EPS:
        return out

    head_n = min(int(0.4 * sr), n // 4)
    tail_n = min(int(0.4 * sr), n // 4)
    head_rms = float(np.sqrt(np.mean(out[:head_n] ** 2) + EPS)) if head_n > 0 else 0.0
    tail_rms = float(np.sqrt(np.mean(out[-tail_n:] ** 2) + EPS)) if tail_n > 0 else 0.0

    # Intro: exponential fade-in if head energy is close to body energy.
    if head_n > 0 and head_rms > body_rms * (1.0 - intro_threshold):
        fade_n = min(int(intro_max_sec * sr), n // 3)
        if fade_n > 0:
            ramp = 1.0 - np.exp(-np.linspace(0.0, 4.0, fade_n, dtype=np.float32))
            out[:fade_n] *= ramp

    # Outro: exponential fade-out giving a satisfying tail.
    if tail_n > 0 and tail_rms > body_rms * (1.0 - outro_threshold):
        fade_n = min(int(outro_max_sec * sr), n // 3)
        if fade_n > 0:
            ramp = np.exp(-np.linspace(0.0, 4.0, fade_n, dtype=np.float32))
            out[-fade_n:] *= ramp

    return out


__all__ = [
    "TimelineFeatures",
    "ScoredWindow",
    "score_timeline",
    "select_best_window",
    "select_diverse_windows",
    "polish_clip",
    "DEFAULT_WEIGHTS",
]
