"""
transition_fx_renderer.py — Renders actual audio buffers for TransitionMarker objects.

The Autonomous Composer Engine (Stage 5) produces TransitionMarker objects
describing WHAT FX should occur and WHEN. This module synthesises the actual
audio for those markers and mixes them into the main buffer.

Supported FX types (from composer/transition_fx_engine.py):
  riser              — upward pink-noise sweep with pitch envelope
  reverse_cymbal     — reversed hi-hat noise burst
  impact             — sine sub boom + noise crack
  white_noise_sweep  — bandpass-swept white noise
  echo_tail          — delay repeat chain on a short grab of audio
  reverb_freeze      — smeared reverb freeze (convolution with long decay)
  tape_stop          — pitch-down + speed-down effect
  filter_sweep       — lowpass cutoff sweep down-to-up or up-to-down
  silence_cut        — hard mute region (drop builder)
  snare_roll         — accelerating snare pattern

Each FX has a default duration and preset-overridable intensity.

Usage::

    renderer = TransitionFXRenderer(sr=44100)
    output   = renderer.render_all(audio, transition_markers, bpm=128.0)
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from loguru import logger
from scipy import signal as scipy_signal


_DEFAULT_SR = 44100

# ------------------------------------------------------------------
# Dataclass mirroring composer/transition_fx_engine.TransitionMarker
# (re-declared here to avoid circular imports — duck-typed)
# ------------------------------------------------------------------

@dataclass
class TransitionMarkerRef:
    """
    Minimal representation of a TransitionMarker from the composer engine.
    The renderer accepts any object with these attributes, including the
    original TransitionMarker dataclass.
    """
    position_s:  float         # time in mix where FX starts (seconds)
    fx_type:     str           # one of the FX types above
    duration_s:  float         # how long the FX should last
    intensity:   float         # 0.0 – 1.0
    params:      Dict[str, Any] = None  # type: ignore


# ------------------------------------------------------------------
# DSP primitives (subset from layer_injector, no cross-import)
# ------------------------------------------------------------------

def _rng() -> np.random.Generator:
    return np.random.default_rng(42)

_RNG = _rng()


def _pink_noise_n(n: int) -> np.ndarray:
    wn   = _RNG.standard_normal(n).astype(np.float64)
    freq = np.fft.rfftfreq(n)
    freq[0] = 1e-6
    fft  = np.fft.rfft(wn)
    fft /= np.sqrt(freq)
    out  = np.fft.irfft(fft, n=n).astype(np.float32)
    peak = float(np.max(np.abs(out)))
    return out / peak if peak > 1e-9 else out


def _white_noise_n(n: int) -> np.ndarray:
    return _RNG.standard_normal(n).astype(np.float32)


def _lowpass(y: np.ndarray, cutoff_hz: float, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    sos = scipy_signal.butter(4, min(cutoff_hz / nyq, 0.99), btype="low", output="sos")
    return scipy_signal.sosfilt(sos, y).astype(np.float32)


def _bandpass(y: np.ndarray, lo: float, hi: float, sr: int) -> np.ndarray:
    nyq  = sr / 2.0
    lo_n = max(lo / nyq, 1e-4)
    hi_n = min(hi / nyq, 1.0 - 1e-4)
    sos  = scipy_signal.butter(4, [lo_n, hi_n], btype="band", output="sos")
    return scipy_signal.sosfilt(sos, y).astype(np.float32)


def _norm(y: np.ndarray, peak: float = 0.80) -> np.ndarray:
    m = float(np.max(np.abs(y)))
    return (y / m * peak).astype(np.float32) if m > 1e-9 else y


def _mix_at(buf: np.ndarray, layer: np.ndarray, start_s: int,
             gain: float = 1.0) -> None:
    """In-place mix of `layer * gain` into `buf` starting at sample `start_s`."""
    if start_s >= len(buf):
        return
    end_buf   = min(start_s + len(layer), len(buf))
    end_layer = end_buf - start_s
    buf[start_s:end_buf] += layer[:end_layer] * gain


# ------------------------------------------------------------------
# FX synthesis functions (each returns a float32 mono array)
# ------------------------------------------------------------------

def _fx_riser(n: int, sr: int, intensity: float,
              params: Dict[str, Any]) -> np.ndarray:
    freq_start = float(params.get("freq_start", 80.0))
    freq_end   = float(params.get("freq_end", 4000.0)) * (1.0 + intensity * 0.5)
    t          = np.linspace(0, n / sr, n, endpoint=False)
    freq_env   = freq_start * (freq_end / max(freq_start, 1.0)) ** (t / max(n / sr, 1e-9))
    phase      = 2 * np.pi * np.cumsum(freq_env) / sr
    tone       = np.sin(phase).astype(np.float32)
    noise      = _pink_noise_n(n)
    noise      = _bandpass(noise, 200, min(freq_end, sr * 0.45), sr)
    amp_env    = np.linspace(0.05, 1.0, n).astype(np.float32) ** 1.5
    sig        = (tone * 0.35 + noise * 0.65) * amp_env * intensity
    return _norm(sig) * 0.75


def _fx_reverse_cymbal(n: int, sr: int, intensity: float,
                       params: Dict[str, Any]) -> np.ndarray:
    lo = float(params.get("lo_hz", 3000.0))
    hi = float(params.get("hi_hz", 16000.0))
    wn  = _white_noise_n(n)
    bp  = _bandpass(wn, lo, hi, sr)
    env = np.exp(-np.linspace(0, 8, n)).astype(np.float32)
    fwd = bp * env
    return _norm(fwd[::-1].copy()) * 0.60 * intensity


def _fx_impact(n: int, sr: int, intensity: float,
               params: Dict[str, Any]) -> np.ndarray:
    t    = np.linspace(0, n / sr, n, endpoint=False)
    freq = float(params.get("sub_hz", 50.0))
    sub  = np.sin(2 * np.pi * freq * t).astype(np.float32)
    sub *= np.exp(-t * 12).astype(np.float32)
    ns   = _white_noise_n(n)
    ns  *= np.exp(-t * 20).astype(np.float32)
    ns   = _lowpass(ns, 3000, sr)
    sig  = sub + ns * 0.40
    return _norm(sig) * 0.90 * intensity


def _fx_white_noise_sweep(n: int, sr: int, intensity: float,
                          params: Dict[str, Any]) -> np.ndarray:
    direction = params.get("direction", "up")   # "up" or "down"
    wn    = _white_noise_n(n)
    out   = np.zeros(n, dtype=np.float32)
    steps = 32
    step_n = max(n // steps, 1)
    for s in range(steps):
        frac = s / steps if direction == "up" else 1.0 - s / steps
        lo   = 20.0  + frac * 2000.0
        hi   = 300.0 + frac * 17700.0
        p0   = s * step_n
        p1   = min(p0 + step_n, n)
        chunk = wn[p0:p1]
        out[p0:p1] = _bandpass(chunk, lo, hi, sr)
    amp_env = (np.linspace(0.0, 1.0, n) if direction == "up"
               else np.linspace(1.0, 0.0, n)).astype(np.float32)
    return _norm(out * amp_env) * 0.55 * intensity


def _fx_echo_tail(audio_grab: np.ndarray, n: int, sr: int,
                  intensity: float, params: Dict[str, Any]) -> np.ndarray:
    """
    Create an echo tail from a short grab of audio preceding the marker.
    If audio_grab is empty or None, falls back to pink noise.
    """
    delay_ms  = float(params.get("delay_ms", 200.0))
    n_repeats = int(params.get("n_repeats", 4))
    decay     = float(params.get("decay", 0.55))

    delay_samp = int(delay_ms / 1000.0 * sr)
    if audio_grab is None or len(audio_grab) == 0:
        audio_grab = _pink_noise_n(min(delay_samp, 2048))

    buf = np.zeros(n, dtype=np.float32)
    for i in range(n_repeats):
        pos   = i * delay_samp
        amp   = (decay ** (i + 1)) * intensity
        grb   = audio_grab[:min(len(audio_grab), n - pos)] if pos < n else np.array([])
        if pos < n and len(grb) > 0:
            buf[pos: pos + len(grb)] += grb * amp
    return buf


def _fx_reverb_freeze(audio_grab: np.ndarray, n: int, sr: int,
                      intensity: float, params: Dict[str, Any]) -> np.ndarray:
    """Convolve a short grab with a long exponential IR to simulate reverb freeze."""
    ir_dur_s = float(params.get("ir_dur_s", 3.0))
    ir_n     = int(ir_dur_s * sr)
    ir       = np.exp(-np.linspace(0, 10, ir_n)).astype(np.float32)
    ir      *= _pink_noise_n(ir_n) * 0.3

    src = audio_grab if (audio_grab is not None and len(audio_grab) > 0) \
          else _pink_noise_n(512)

    frozen = scipy_signal.fftconvolve(src, ir, mode="full")
    out    = np.zeros(n, dtype=np.float32)
    copy_n = min(len(frozen), n)
    out[:copy_n] = frozen[:copy_n].astype(np.float32) * intensity
    m = float(np.max(np.abs(out)))
    return (out / m * 0.70).astype(np.float32) if m > 1e-9 else out


def _fx_tape_stop(audio_grab: np.ndarray, n: int, sr: int,
                  intensity: float, params: Dict[str, Any]) -> np.ndarray:
    """Pitch-and-speed decrease (tape stop effect) via phase vocoder approximation."""
    if audio_grab is None or len(audio_grab) < 16:
        audio_grab = _pink_noise_n(min(n, 4096))

    import librosa
    # Stretch: progressively slow down (stretch ratio 1 → 4)
    out   = np.zeros(n, dtype=np.float32)
    chunk_dur = min(0.5, len(audio_grab) / sr)
    chunk = audio_grab[:int(chunk_dur * sr)]
    if len(chunk) < 16:
        return out

    stretch_out_len = n
    try:
        stretched = librosa.effects.time_stretch(chunk.astype(np.float32),
                                                 rate=max(0.1, 1.0 - intensity * 0.85))
        copy_n = min(len(stretched), n)
        out[:copy_n] = stretched[:copy_n] * intensity
    except Exception:
        pass
    return out


def _fx_filter_sweep(n: int, sr: int, intensity: float,
                     params: Dict[str, Any]) -> np.ndarray:
    """Pink noise with a sweeping lowpass filter."""
    direction = params.get("direction", "down")
    noise     = _pink_noise_n(n)
    out       = np.zeros(n, dtype=np.float32)
    steps     = 64
    step_n    = max(n // steps, 1)
    for s in range(steps):
        frac = s / steps
        if direction == "down":
            cutoff = 18000 * (1.0 - frac * 0.95)
        else:
            cutoff = 200 + frac * 17800
        cutoff = max(cutoff, 100.0)
        p0 = s * step_n
        p1 = min(p0 + step_n, n)
        out[p0:p1] = _lowpass(noise[p0:p1], cutoff, sr)
    return out * intensity * 0.65


def _fx_silence_cut(n: int, sr: int, intensity: float,
                    params: Dict[str, Any]) -> np.ndarray:
    """Returns a buffer of silence (used to duck the mix during a silence cut)."""
    # Silence cut is handled by the caller zeroing the mix at this position,
    # not by adding a layer. Return a negative-unity signal as a flag.
    return np.full(n, -1.0, dtype=np.float32)


def _fx_snare_roll(n: int, sr: int, intensity: float,
                   params: Dict[str, Any], bpm: float) -> np.ndarray:
    """Accelerating snare roll (32nd notes)."""
    spb    = 60.0 / bpm
    step_s = spb / 8.0
    buf    = np.zeros(n, dtype=np.float32)
    t      = 0.0
    step_i = 0
    n_steps = int((n / sr) / step_s)
    rng    = np.random.default_rng(7)
    for i in range(n_steps):
        accel = 1.0 - 0.65 * (i / max(n_steps - 1, 1))
        step  = step_s * accel
        pos   = int(t * sr)
        if pos >= n:
            break
        snare_n  = min(int(0.07 * sr), n - pos)
        if snare_n <= 0:
            break
        wn   = rng.standard_normal(snare_n).astype(np.float32)
        nyq  = sr / 2.0
        lo_n = max(200.0 / nyq, 1e-4)
        hi_n = min(8000.0 / nyq, 0.999)
        sos  = scipy_signal.butter(4, [lo_n, hi_n], btype="band", output="sos")
        wn   = scipy_signal.sosfilt(sos, wn).astype(np.float32)
        env  = np.exp(-np.linspace(0, 10, snare_n)).astype(np.float32)
        snare_hit = wn * env * (0.3 + 0.7 * (i / n_steps)) * intensity
        buf[pos: pos + snare_n] += snare_hit
        t     += step
        step_i += 1
    m = float(np.max(np.abs(buf)))
    return (buf / m * 0.65).astype(np.float32) if m > 1e-9 else buf


# ------------------------------------------------------------------
# Renderer
# ------------------------------------------------------------------

class TransitionFXRenderer:
    """
    Renders TransitionMarker FX into an audio buffer.

    Args:
        sr: Sample rate matching the audio buffer.
    """

    def __init__(self, sr: int = _DEFAULT_SR) -> None:
        self._sr = sr

    def render_all(self,
                   audio: np.ndarray,
                   markers: List[Any],
                   bpm: float = 120.0) -> np.ndarray:
        """
        Mix all transition FX into `audio`.

        Args:
            audio:   Float32 array, shape (samples,) or (samples, 2).
            markers: List of TransitionMarker (or TransitionMarkerRef) objects.
            bpm:     Track BPM for rhythm-synced FX.

        Returns:
            New buffer with FX mixed in.
        """
        if not markers:
            return audio

        sr     = self._sr
        stereo = audio.ndim == 2
        out    = audio.copy().astype(np.float32)

        # Work on mono track for FX synthesis
        if stereo:
            mono = (out[:, 0] + out[:, 1]) / 2.0
        else:
            mono = out.copy()

        n_total = len(mono)

        for marker in markers:
            pos_s   = float(getattr(marker, "position_s",  0.0))
            fx_type = str(getattr(marker, "fx_type",       "riser"))
            dur_s   = float(getattr(marker, "duration_s",  2.0))
            intensity = float(getattr(marker, "intensity", 0.7))
            params  = dict(getattr(marker, "params", None) or {})

            start_samp = int(pos_s * sr)
            fx_n       = int(dur_s * sr)
            if start_samp >= n_total or fx_n <= 0:
                continue

            # Grab audio preceding the marker for FX that need it
            grab_start = max(0, start_samp - int(0.5 * sr))
            audio_grab = mono[grab_start:start_samp]

            layer = self._render_fx(fx_type, fx_n, sr, intensity,
                                    params, audio_grab, bpm)
            if layer is None:
                continue

            # Silence cut: zero out the mix region
            if fx_type == "silence_cut":
                end_s = min(start_samp + fx_n, n_total)
                mono[start_samp:end_s] *= (1.0 - intensity * 0.90)
                continue

            gain = self._fx_gain(fx_type, intensity)
            _mix_at(mono, layer, start_samp, gain=gain)
            logger.debug(
                f"TransitionFXRenderer: rendered '{fx_type}' at "
                f"{pos_s:.2f}s (dur={dur_s:.2f}s, gain={gain:.2f})"
            )

        mono = np.clip(mono, -1.0, 1.0).astype(np.float32)

        if stereo:
            # Widen the FX layer slightly for spatial interest
            out[:, 0] = mono * 0.98
            out[:, 1] = mono * 1.02
        else:
            out = mono

        return out

    # ------------------------------------------------------------------
    def _render_fx(self, fx_type: str, n: int, sr: int,
                   intensity: float, params: Dict[str, Any],
                   audio_grab: np.ndarray, bpm: float) -> Optional[np.ndarray]:
        dispatch = {
            "riser":            lambda: _fx_riser(n, sr, intensity, params),
            "reverse_cymbal":   lambda: _fx_reverse_cymbal(n, sr, intensity, params),
            "impact":           lambda: _fx_impact(n, sr, intensity, params),
            "white_noise_sweep":lambda: _fx_white_noise_sweep(n, sr, intensity, params),
            "echo_tail":        lambda: _fx_echo_tail(audio_grab, n, sr, intensity, params),
            "reverb_freeze":    lambda: _fx_reverb_freeze(audio_grab, n, sr, intensity, params),
            "tape_stop":        lambda: _fx_tape_stop(audio_grab, n, sr, intensity, params),
            "filter_sweep":     lambda: _fx_filter_sweep(n, sr, intensity, params),
            "silence_cut":      lambda: _fx_silence_cut(n, sr, intensity, params),
            "snare_roll":       lambda: _fx_snare_roll(n, sr, intensity, params, bpm),
        }
        fn = dispatch.get(fx_type)
        if fn is None:
            logger.warning(f"TransitionFXRenderer: unknown FX type '{fx_type}'")
            return None
        try:
            return fn()
        except Exception as exc:
            logger.warning(f"TransitionFXRenderer: error rendering '{fx_type}': {exc}")
            return None

    @staticmethod
    def _fx_gain(fx_type: str, intensity: float) -> float:
        """Return mix gain for each FX type based on intensity and type."""
        base = {
            "riser":             0.65,
            "reverse_cymbal":    0.55,
            "impact":            0.80,
            "white_noise_sweep": 0.45,
            "echo_tail":         0.55,
            "reverb_freeze":     0.45,
            "tape_stop":         0.60,
            "filter_sweep":      0.50,
            "silence_cut":       0.0,
            "snare_roll":        0.55,
        }.get(fx_type, 0.50)
        return base * intensity
