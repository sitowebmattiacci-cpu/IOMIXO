"""
sidechain_engine.py — Simulates sidechain compression pumping.

Sidechain compression is the signature sound of modern electronic music:
the bass/pad/other layers duck in gain every time the kick hits, creating
a rhythmic "pumping" feel.

Algorithm:
  1. Extract kick transients from the drums stem (or detect them from full mix
     via onset strength if no stems are available)
  2. Build a gain reduction envelope:  fast attack → exponential release
  3. Apply the envelope to target stems (bass, pads, other)

The SidechainEngine works on numpy arrays and does NOT re-read any file.
All audio is passed in as float32 stereo (samples, 2) or mono (samples,).

Usage::

    engine  = SidechainEngine(sr=44100)
    ducked  = engine.apply(audio, drums_stem, preset.sidechain, bpm=128.0)
"""

from __future__ import annotations

import numpy as np
from typing import Optional
from loguru import logger
from scipy import signal as scipy_signal

from .preset_loader import SidechainConfig


_DEFAULT_SR = 44100

# Onset detection frame parameters
_HOP  = 512
_FRSZ = 2048


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _kick_onsets(drums: np.ndarray, sr: int, bpm: float,
                 kick_rate: str = "1/4") -> np.ndarray:
    """
    Detect kick drum onsets from a drums stem or full mix.
    Returns array of onset times in seconds.

    Args:
        drums:      Mono float32 array (drums stem or mix mono).
        sr:         Sample rate.
        bpm:        Track BPM.
        kick_rate:  "1/4" or "1/8" for beat subdivision.

    Returns:
        np.ndarray of float onset times (seconds).
    """
    import librosa   # local import to keep module fast at import time

    # Low-pass to isolate kick sub energy (<150 Hz)
    nyq = sr / 2.0
    sos = scipy_signal.butter(4, 150.0 / nyq, btype="low", output="sos")
    lp  = scipy_signal.sosfilt(sos, drums).astype(np.float32)

    onset_env    = librosa.onset.onset_strength(y=lp, sr=sr, hop_length=_HOP)
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        hop_length=_HOP,
        backtrack=True,
        delta=0.05,
    )
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=_HOP)

    # Quantize to beat grid
    spb        = 60.0 / bpm
    subdiv     = spb / 2.0 if kick_rate == "1/8" else spb
    grid_times = np.arange(0, len(drums) / sr + subdiv, subdiv)
    snapped    = []
    for t in onset_times:
        idx    = int(np.round(t / subdiv))
        idx    = min(idx, len(grid_times) - 1)
        snapped.append(grid_times[idx])

    # Deduplicate within 20ms
    snapped.sort()
    deduped: list = []
    for t in snapped:
        if not deduped or (t - deduped[-1]) > 0.020:
            deduped.append(t)

    return np.array(deduped, dtype=np.float64)


def _build_gain_envelope(onset_times: np.ndarray, n_samples: int,
                         sr: int, depth: float,
                         attack_ms: float, release_ms: float) -> np.ndarray:
    """
    Build a per-sample gain envelope for sidechain pumping.

    At each onset: gain drops by `depth` (0=no duck, 1=silence),
    then recovers with exponential release.

    Returns:
        float32 envelope of shape (n_samples,), values in [1-depth, 1.0]
    """
    envelope = np.ones(n_samples, dtype=np.float64)
    atk_samp = max(1, int(attack_ms  / 1000.0 * sr))
    rel_samp = max(1, int(release_ms / 1000.0 * sr))

    for t in onset_times:
        onset_s = int(t * sr)
        if onset_s >= n_samples:
            continue

        # Attack: ramp down from 1.0 to (1-depth)
        atk_end = min(onset_s + atk_samp, n_samples)
        envelope[onset_s:atk_end] = np.minimum(
            envelope[onset_s:atk_end],
            np.linspace(1.0, 1.0 - depth, atk_end - onset_s),
        )

        # Release: exponential recovery
        rel_start = atk_end
        rel_end   = min(rel_start + rel_samp, n_samples)
        if rel_start >= n_samples:
            continue
        t_rel     = np.linspace(0, 1, rel_end - rel_start)
        rel_curve = (1.0 - depth) + depth * (1.0 - np.exp(-5.0 * t_rel))
        envelope[rel_start:rel_end] = np.minimum(
            envelope[rel_start:rel_end],
            rel_curve,
        )

    return np.clip(envelope, 0.0, 1.0).astype(np.float32)


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

class SidechainEngine:
    """
    Apply sidechain compression-style gain pumping to an audio buffer.

    Args:
        sr: Sample rate. Must match the audio arrays passed to apply().
    """

    def __init__(self, sr: int = _DEFAULT_SR) -> None:
        self._sr = sr

    def apply(self,
              audio: np.ndarray,
              drums_stem: Optional[np.ndarray],
              cfg: SidechainConfig,
              bpm: float = 120.0) -> np.ndarray:
        """
        Apply sidechain ducking to `audio`.

        Args:
            audio:       Main mix or layered buffer (float32, stereo or mono).
                         Shape: (samples, 2) or (samples,).
            drums_stem:  Mono or stereo drums stem for kick detection.
                         If None, kick positions are estimated from `audio` itself.
            cfg:         SidechainConfig from PresetProfile.
            bpm:         Track BPM.

        Returns:
            New float32 buffer with sidechain applied. Same shape as `audio`.
        """
        if not cfg.enabled or cfg.depth <= 0:
            logger.debug("Sidechain: disabled in preset — skipping")
            return audio

        # --- extract mono reference for kick detection
        if drums_stem is not None:
            ref = drums_stem
            if ref.ndim == 2:
                ref = (ref[:, 0] + ref[:, 1]) / 2.0
        else:
            ref = audio
            if ref.ndim == 2:
                ref = (ref[:, 0] + ref[:, 1]) / 2.0
        ref = ref.astype(np.float32)

        n_samples = len(audio) if audio.ndim == 1 else audio.shape[0]

        # --- detect kick onsets
        onset_times = _kick_onsets(ref, self._sr, bpm, cfg.kick_rate_bpm_sync)
        if onset_times.size == 0:
            logger.warning("Sidechain: no kick onsets detected, skipping")
            return audio

        logger.info(
            f"Sidechain: {len(onset_times)} kick onsets, "
            f"depth={cfg.depth:.2f}, attack={cfg.attack_ms}ms, "
            f"release={cfg.release_ms}ms"
        )

        # --- build gain envelope
        envelope = _build_gain_envelope(
            onset_times, n_samples, self._sr,
            cfg.depth, cfg.attack_ms, cfg.release_ms,
        )

        # --- apply
        out = audio.copy().astype(np.float32)
        if out.ndim == 2:
            out[:, 0] *= envelope
            out[:, 1] *= envelope
        else:
            out *= envelope

        return out

    def apply_to_stem(self,
                      stem: np.ndarray,
                      onset_times: np.ndarray,
                      cfg: SidechainConfig) -> np.ndarray:
        """
        Apply pre-computed onset times to a single stem.
        Useful when processing multiple stems with shared kick grid.

        Args:
            stem:         Target stem buffer (float32, stereo or mono).
            onset_times:  Pre-computed onset time array (seconds).
            cfg:          SidechainConfig.

        Returns:
            New buffer with sidechain applied.
        """
        if not cfg.enabled or cfg.depth <= 0:
            return stem

        n_samples = len(stem) if stem.ndim == 1 else stem.shape[0]
        envelope  = _build_gain_envelope(
            onset_times, n_samples, self._sr,
            cfg.depth, cfg.attack_ms, cfg.release_ms,
        )
        out = stem.copy().astype(np.float32)
        if out.ndim == 2:
            out[:, 0] *= envelope
            out[:, 1] *= envelope
        else:
            out *= envelope
        return out

    def extract_kick_onsets(self, drums_stem: np.ndarray,
                            bpm: float, kick_rate: str = "1/4") -> np.ndarray:
        """
        Public method to extract kick onset times from a drums stem.
        Returned array can be passed to apply_to_stem() for multi-stem processing.

        Returns:
            np.ndarray of float onset times in seconds.
        """
        ref = drums_stem
        if ref.ndim == 2:
            ref = (ref[:, 0] + ref[:, 1]) / 2.0
        return _kick_onsets(ref.astype(np.float32), self._sr, bpm, kick_rate)
