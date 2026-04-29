"""
layer_injector.py — Synthesises and injects audio layers into weak energy regions.

All synthesis is performed with NumPy DSP — no external sample libraries needed.
Layers are mixed directly into an output buffer at the positions specified by
EnergyAnalysis events and the preset's layers config.

Layer catalogue (synthesised):
  kick          — sine transient + noise burst (sub + click)
  snare_roll    — accelerating snare pattern into a drop
  clap          — band-limited noise burst with short decay
  bass_sub_punch — pitched sub sine with fast attack / long decay
  bass_groove_pump — grooved 16th-note sub pattern
  bass_warm_sub  — slow sine swell, warm harmonics
  bass_soft_sub  — very gentle sub pad
  bass_clean_pop — transient bass hit, clean
  bass_cinematic_sub — deep, slow cinematic sub
  bass_warm_groove   — mid-tempo groove bass
  pad           — multi-layer sine chord swell with reverb tail
  riser         — pink-noise + upward pitch envelope
  downlifter    — pink-noise + downward pitch envelope
  impact        — sine sub boom + white noise burst
  reverse_cymbal — reversed noise burst
  white_noise_sweep — bandpass-swept white noise
  uplifter      — shorter version of riser (2 bars)

Usage::

    injector = LayerInjector(sr=44100)
    output   = injector.inject(audio_array, analysis, preset, bpm=128.0)
"""

from __future__ import annotations

import numpy as np
from typing import Dict, List, Optional
from loguru import logger
from scipy import signal as scipy_signal

from .energy_analyzer import EnergyAnalysis, EnergyEvent
from .preset_loader   import PresetProfile, LayersConfig

_DEFAULT_SR = 44100


# ------------------------------------------------------------------
# Low-level synthesis primitives
# ------------------------------------------------------------------

def _sine(freq: float, dur_s: float, sr: int, amp: float = 1.0) -> np.ndarray:
    t = np.linspace(0, dur_s, int(dur_s * sr), endpoint=False)
    return (np.sin(2 * np.pi * freq * t) * amp).astype(np.float32)


def _pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    """Approximate pink noise via power-law spectral shaping."""
    wn   = rng.standard_normal(n).astype(np.float64)
    freq = np.fft.rfftfreq(n)
    freq[0] = 1e-6   # avoid /0
    fft  = np.fft.rfft(wn)
    fft  = fft / np.sqrt(freq)
    out  = np.fft.irfft(fft, n=n).astype(np.float32)
    peak = np.max(np.abs(out))
    return out / peak if peak > 0 else out


def _white_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.standard_normal(n).astype(np.float32)


def _exp_env(n: int, attack_frac: float = 0.01, decay_frac: float = 0.30) -> np.ndarray:
    """Attack-decay amplitude envelope."""
    env  = np.ones(n, dtype=np.float32)
    atk  = max(1, int(n * attack_frac))
    dcy  = max(1, int(n * decay_frac))
    env[:atk] = np.linspace(0, 1, atk)
    tail_len  = n - atk
    env[atk:] = np.exp(-np.linspace(0, 5, tail_len) * (n / (dcy * sr_safe(1))))
    return np.clip(env, 0, 1)


def sr_safe(sr: int) -> int:
    return max(sr, 1)


def _adsr_env(n: int, attack_s: float, decay_s: float, sustain: float,
              release_s: float, sr: int) -> np.ndarray:
    a  = max(1, int(attack_s  * sr))
    d  = max(1, int(decay_s   * sr))
    r  = max(1, int(release_s * sr))
    s_len = max(0, n - a - d - r)
    env = np.concatenate([
        np.linspace(0, 1,        a),
        np.linspace(1, sustain,  d),
        np.full(s_len, sustain),
        np.linspace(sustain, 0, r),
    ]).astype(np.float32)
    return env[:n]


def _lowpass(y: np.ndarray, cutoff_hz: float, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    sos = scipy_signal.butter(4, min(cutoff_hz / nyq, 0.99), btype="low", output="sos")
    return scipy_signal.sosfilt(sos, y).astype(np.float32)


def _bandpass(y: np.ndarray, lo: float, hi: float, sr: int) -> np.ndarray:
    nyq = sr / 2.0
    lo_n = max(lo / nyq, 1e-4)
    hi_n = min(hi / nyq, 1.0 - 1e-4)
    sos  = scipy_signal.butter(4, [lo_n, hi_n], btype="band", output="sos")
    return scipy_signal.sosfilt(sos, y).astype(np.float32)


def _normalize(y: np.ndarray, peak: float = 0.8) -> np.ndarray:
    m = np.max(np.abs(y))
    return (y / m * peak).astype(np.float32) if m > 1e-9 else y


# ------------------------------------------------------------------
# Layer generators
# ------------------------------------------------------------------

class _Synth:
    def __init__(self, sr: int, rng: np.random.Generator) -> None:
        self.sr  = sr
        self.rng = rng

    def kick(self, dur_s: float = 0.40, freq_start: float = 80.0,
             freq_end: float = 30.0) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        # Pitch envelope: exponential sweep down
        freq_env = freq_end + (freq_start - freq_end) * np.exp(-t * 20)
        phase    = 2 * np.pi * np.cumsum(freq_env) / self.sr
        body     = (np.sin(phase) * np.exp(-t * 18)).astype(np.float32)
        # Click transient
        click_n  = int(0.01 * self.sr)
        click    = _white_noise(click_n, self.rng) * np.linspace(0.3, 0, click_n)
        click_buf = np.zeros(n, dtype=np.float32)
        click_buf[:click_n] = click
        return _normalize(body + click_buf)

    def snare_roll(self, dur_s: float, bpm: float) -> np.ndarray:
        """32nd-note snare roll accelerating to a drop."""
        beat_s  = 60.0 / bpm
        step_s  = beat_s / 8.0   # 32nd note
        n       = int(dur_s * self.sr)
        buf     = np.zeros(n, dtype=np.float32)
        t       = 0.0
        beat_i  = 0
        n_steps = int(dur_s / step_s)
        for i in range(n_steps):
            # Accelerate: reduce step by 10% as we get closer to end
            accel  = 1.0 - 0.7 * (i / max(n_steps - 1, 1))
            step   = step_s * accel
            pos    = int(t * self.sr)
            if pos >= n:
                break
            snare  = self._single_snare(0.08)
            end_p  = min(pos + len(snare), n)
            buf[pos:end_p] += snare[:end_p - pos] * (0.4 + 0.6 * (i / n_steps))
            t     += step
            beat_i += 1
        return _normalize(buf) * 0.65

    def _single_snare(self, dur_s: float = 0.08) -> np.ndarray:
        n    = int(dur_s * self.sr)
        body = _white_noise(n, self.rng)
        body = _bandpass(body, 200, 8000, self.sr)
        env  = np.exp(-np.linspace(0, 12, n)).astype(np.float32)
        return body * env

    def clap(self, dur_s: float = 0.12) -> np.ndarray:
        n   = int(dur_s * self.sr)
        wn  = _white_noise(n, self.rng)
        bp  = _bandpass(wn, 800, 10000, self.sr)
        env = np.exp(-np.linspace(0, 10, n)).astype(np.float32)
        return (bp * env * 0.8).astype(np.float32)

    def bass_layer(self, mode: str, dur_s: float, bpm: float,
                   root_hz: float = 55.0) -> np.ndarray:
        """Generate the bass layer specified by preset.layers.bass_layer."""
        dispatch: Dict[str, callable] = {
            "sub_punch":      self._bass_sub_punch,
            "groove_pump":    self._bass_groove_pump,
            "warm_sub":       self._bass_warm_sub,
            "soft_sub":       self._bass_soft_sub,
            "clean_pop":      self._bass_clean_pop,
            "cinematic_sub":  self._bass_cinematic_sub,
            "warm_groove":    self._bass_warm_groove,
        }
        fn = dispatch.get(mode)
        if fn is None:
            return np.zeros(int(dur_s * self.sr), dtype=np.float32)
        return fn(dur_s, bpm, root_hz)

    def _bass_sub_punch(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        env = _adsr_env(n, 0.003, 0.05, 0.7, 0.1, self.sr)
        y   = np.sin(2 * np.pi * root_hz * t).astype(np.float32) * env
        y  += np.sin(2 * np.pi * root_hz * 2 * t).astype(np.float32) * env * 0.3
        return _normalize(y) * 0.85

    def _bass_groove_pump(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        beat_s = 60.0 / bpm
        n      = int(dur_s * self.sr)
        buf    = np.zeros(n, dtype=np.float32)
        # 16th-note pumping pattern: play on 1, skip 2, play 3, skip 4
        step_s = beat_s / 4
        groove = [1, 0, 1, 0, 1, 0, 1, 1]   # 8 16th-note groove pattern
        g_len  = len(groove)
        note_dur = step_s * 0.8
        t = 0.0
        g_idx = 0
        while t < dur_s:
            if groove[g_idx % g_len]:
                pos = int(t * self.sr)
                note = self._bass_sub_punch(note_dur, bpm, root_hz)
                end_p = min(pos + len(note), n)
                buf[pos:end_p] += note[:end_p - pos] * 0.75
            t     += step_s
            g_idx += 1
        return _normalize(buf) * 0.80

    def _bass_warm_sub(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        env = _adsr_env(n, 0.05, 0.2, 0.8, 0.3, self.sr)
        y   = np.sin(2 * np.pi * root_hz * t).astype(np.float32) * env
        y  += np.sin(2 * np.pi * root_hz * 3 * t).astype(np.float32) * env * 0.15
        lp  = _lowpass(y, 120, self.sr)
        return _normalize(lp) * 0.75

    def _bass_soft_sub(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        env = _adsr_env(n, 0.1, 0.3, 0.6, 0.5, self.sr)
        y   = np.sin(2 * np.pi * root_hz * t).astype(np.float32) * env
        return _lowpass(y, 100, self.sr) * 0.60

    def _bass_clean_pop(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        env = _adsr_env(n, 0.005, 0.05, 0.6, 0.15, self.sr)
        y   = np.sin(2 * np.pi * root_hz * t).astype(np.float32) * env
        y  += np.sin(2 * np.pi * root_hz * 2 * t).astype(np.float32) * env * 0.4
        return _normalize(y) * 0.80

    def _bass_cinematic_sub(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        env = _adsr_env(n, 0.3, 0.5, 0.9, 1.0, self.sr)
        y   = np.sin(2 * np.pi * (root_hz * 0.5) * t).astype(np.float32) * env
        return _lowpass(y, 80, self.sr) * 0.90

    def _bass_warm_groove(self, dur_s: float, bpm: float, root_hz: float) -> np.ndarray:
        beat_s = 60.0 / bpm
        n      = int(dur_s * self.sr)
        buf    = np.zeros(n, dtype=np.float32)
        groove = [1, 0, 0, 1, 1, 0, 1, 0]
        g_len  = len(groove)
        step_s = beat_s / 2
        t = 0.0
        g_idx = 0
        while t < dur_s:
            if groove[g_idx % g_len]:
                pos    = int(t * self.sr)
                note   = self._bass_warm_sub(step_s * 0.9, bpm, root_hz)
                end_p  = min(pos + len(note), n)
                buf[pos:end_p] += note[:end_p - pos]
            t     += step_s
            g_idx += 1
        return _normalize(buf) * 0.70

    def pad(self, dur_s: float, root_hz: float = 220.0,
            chord: Optional[List[float]] = None) -> np.ndarray:
        """Lush detuned pad using 4 sine layers per chord note."""
        if chord is None:
            # Major chord (root, major 3rd, perfect 5th)
            chord = [root_hz, root_hz * 1.2599, root_hz * 1.4983]
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        buf = np.zeros(n, dtype=np.float32)
        env = _adsr_env(n, 0.3, 0.2, 0.8, 0.8, self.sr)
        for hz in chord:
            for detune in [-0.008, 0.0, 0.008]:
                f   = hz * (1 + detune)
                buf += np.sin(2 * np.pi * f * t).astype(np.float32)
        buf = _lowpass(buf, 5000, self.sr) * env
        return _normalize(buf) * 0.45

    def riser(self, dur_s: float, freq_start: float = 80.0,
              freq_end: float = 4000.0) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        # Exponential frequency sweep
        freq_env = freq_start * (freq_end / freq_start) ** (t / dur_s)
        phase    = 2 * np.pi * np.cumsum(freq_env) / self.sr
        tone     = np.sin(phase).astype(np.float32)
        # Add pink noise
        noise    = _pink_noise(n, self.rng)
        noise    = _bandpass(noise, 200, 8000, self.sr)
        # Amplitude envelope: ramps up
        amp_env  = np.linspace(0.05, 1.0, n).astype(np.float32) ** 1.5
        sig      = (tone * 0.4 + noise * 0.6) * amp_env
        return _normalize(sig) * 0.80

    def downlifter(self, dur_s: float, freq_start: float = 3000.0,
                   freq_end: float = 60.0) -> np.ndarray:
        n        = int(dur_s * self.sr)
        t        = np.linspace(0, dur_s, n, endpoint=False)
        freq_env = freq_start * (freq_end / freq_start) ** (t / dur_s)
        phase    = 2 * np.pi * np.cumsum(freq_env) / self.sr
        tone     = np.sin(phase).astype(np.float32)
        noise    = _pink_noise(n, self.rng)
        amp_env  = np.linspace(1.0, 0.0, n).astype(np.float32) ** 0.8
        sig      = (tone * 0.5 + noise * 0.5) * amp_env
        return _normalize(sig) * 0.70

    def impact(self, dur_s: float = 0.8) -> np.ndarray:
        n   = int(dur_s * self.sr)
        t   = np.linspace(0, dur_s, n, endpoint=False)
        # Sub boom
        sub = np.sin(2 * np.pi * 50 * t).astype(np.float32)
        sub *= np.exp(-t * 8).astype(np.float32)
        # Noise burst
        ns  = _white_noise(n, self.rng)
        ns  *= np.exp(-t * 15).astype(np.float32)
        ns   = _lowpass(ns, 3000, self.sr)
        return _normalize(sub + ns * 0.4) * 0.90

    def reverse_cymbal(self, dur_s: float = 1.0) -> np.ndarray:
        n    = int(dur_s * self.sr)
        wn   = _white_noise(n, self.rng)
        bp   = _bandpass(wn, 3000, 16000, self.sr)
        env  = np.exp(-np.linspace(0, 8, n)).astype(np.float32)
        fwd  = bp * env
        return _normalize(fwd[::-1].copy()) * 0.65

    def white_noise_sweep(self, dur_s: float, lo_start: float = 20.0,
                          hi_start: float = 300.0, lo_end: float = 2000.0,
                          hi_end: float = 18000.0) -> np.ndarray:
        n   = int(dur_s * self.sr)
        wn  = _white_noise(n, self.rng)
        # Sweep filter cutoffs from low → high
        out = np.zeros(n, dtype=np.float32)
        steps = 32
        step_n = n // steps
        for s in range(steps):
            frac     = s / steps
            lo       = lo_start + (lo_end - lo_start) * frac
            hi       = hi_start + (hi_end - hi_start) * frac
            chunk    = wn[s * step_n: (s + 1) * step_n]
            out[s * step_n: (s + 1) * step_n] = _bandpass(chunk, lo, hi, self.sr)
        amp_env = np.linspace(0.0, 1.0, n).astype(np.float32)
        return _normalize(out * amp_env) * 0.55

    def uplifter(self, dur_s: float = 2.0) -> np.ndarray:
        return self.riser(dur_s, freq_start=200, freq_end=6000)


# ------------------------------------------------------------------
# Mix helper
# ------------------------------------------------------------------

def _mix_at(buf: np.ndarray, layer: np.ndarray, sample_pos: int,
            gain: float = 1.0) -> None:
    """Mix `layer * gain` into `buf` starting at sample_pos. In-place."""
    if sample_pos >= len(buf):
        return
    end_buf   = min(sample_pos + len(layer), len(buf))
    end_layer = end_buf - sample_pos
    buf[sample_pos:end_buf] += layer[:end_layer] * gain


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

class LayerInjector:
    """
    Inject synthesised audio layers into a mashup buffer at energy-weak points.

    Args:
        sr:   Sample rate. Must match the audio buffer passed to `inject()`.
        seed: Optional RNG seed for reproducibility.
    """

    def __init__(self, sr: int = _DEFAULT_SR, seed: Optional[int] = None) -> None:
        self._sr   = sr
        self._rng  = np.random.default_rng(seed)
        self._synth = _Synth(sr, self._rng)

    def inject(self,
               audio: np.ndarray,
               analysis: EnergyAnalysis,
               preset: PresetProfile,
               bpm: float = 120.0,
               root_hz: float = 55.0) -> np.ndarray:
        """
        Mix layers into a stereo (samples, 2) or mono (samples,) float32 buffer.
        Returns a new buffer; the original is NOT modified.

        Args:
            audio:    Input buffer (float32, range -1..+1).
            analysis: EnergyAnalysis from EnergyAnalyzer.
            preset:   PresetProfile (contains layers config).
            bpm:      Track BPM for rhythm-synced layers.
            root_hz:  Fundamental pitch for bass/pad layers (Hz).

        Returns:
            New buffer with injected layers mixed in.
        """
        stereo = audio.ndim == 2
        if stereo:
            buf = audio.copy().astype(np.float32)
            # Work on mono mix-down for injection, then up-mix
            mono = (buf[:, 0] + buf[:, 1]) / 2.0
        else:
            mono = audio.copy().astype(np.float32)
            buf  = mono  # reference reused below

        cfg    = preset.layers
        sr     = self._sr
        n_samp = len(mono)

        # ---- Event-driven injections --------------------------------
        for ev in analysis.events:
            ev_start = int(ev.time_s * sr)
            ev_end   = int(ev.end_time_s * sr)
            ev_dur   = ev.end_time_s - ev.time_s

            if ev.event_type == "weak_drop" and cfg.kick_boost:
                layer = self._synth.kick(dur_s=0.40)
                _mix_at(mono, layer, ev_start, gain=0.70)
                logger.debug(f"Injected kick_boost at {ev.time_s:.2f}s")

            if ev.event_type == "empty_low_end" and cfg.bass_layer != "none":
                layer = self._synth.bass_layer(cfg.bass_layer, ev_dur, bpm, root_hz)
                _mix_at(mono, layer, ev_start, gain=0.55)
                logger.debug(f"Injected bass '{cfg.bass_layer}' at {ev.time_s:.2f}s")

            if ev.event_type == "thin_mid" and cfg.pad_layer:
                layer = self._synth.pad(ev_dur, root_hz=root_hz * 4)
                _mix_at(mono, layer, ev_start, gain=0.40)
                logger.debug(f"Injected pad at {ev.time_s:.2f}s")

            if ev.event_type == "missing_transient" and cfg.kick_boost:
                layer = self._synth.kick(dur_s=0.30, freq_start=70, freq_end=25)
                _mix_at(mono, layer, ev_start, gain=0.45)

            if ev.event_type == "flat_buildup":
                if cfg.riser_before_drops:
                    layer = self._synth.riser(min(ev_dur, 8.0))
                    _mix_at(mono, layer, ev_start, gain=0.55)
                    logger.debug(f"Injected riser at {ev.time_s:.2f}s")
                if cfg.uplifter and ev_dur >= 2.0:
                    layer = self._synth.uplifter(min(ev_dur * 0.5, 4.0))
                    _mix_at(mono, layer, ev_start, gain=0.40)

        # ---- Beat-grid drop ornaments (independent of events) -------
        beat_times = analysis.beat_times
        n_beats    = len(beat_times)
        spb        = 60.0 / bpm            # seconds per beat
        bar_s      = spb * 4               # seconds per bar

        # Snare rolls: _FLAT_BUILDUP_BARS * 1/2 bar before a weak_drop
        if cfg.snare_roll_before_drops:
            drop_times = {ev.time_s for ev in analysis.events if ev.event_type == "weak_drop"}
            for t_drop in drop_times:
                roll_dur = bar_s * 0.5
                t_start  = t_drop - roll_dur
                if t_start < 0:
                    continue
                layer = self._synth.snare_roll(roll_dur, bpm)
                _mix_at(mono, layer, int(t_start * sr), gain=0.60)
                logger.debug(f"Injected snare_roll before drop at {t_drop:.2f}s")

        # Impacts at every weak_drop onset
        if cfg.impact_at_drops:
            for ev in analysis.events:
                if ev.event_type == "weak_drop":
                    layer = self._synth.impact(0.8)
                    _mix_at(mono, layer, int(ev.time_s * sr), gain=0.65)

        # White noise sweep before drops
        if cfg.white_noise_sweep:
            for ev in analysis.events:
                if ev.event_type == "weak_drop":
                    sweep_dur = min(bar_s, 2.0)
                    t_start   = ev.time_s - sweep_dur
                    if t_start < 0:
                        continue
                    layer = self._synth.white_noise_sweep(sweep_dur)
                    _mix_at(mono, layer, int(t_start * sr), gain=0.45)

        # Reverse cymbal
        if cfg.reverse_cymbal:
            for ev in analysis.events:
                if ev.event_type == "weak_drop":
                    cymbal_dur = min(bar_s * 0.5, 1.5)
                    t_start    = ev.time_s - cymbal_dur
                    if t_start < 0:
                        continue
                    layer = self._synth.reverse_cymbal(cymbal_dur)
                    _mix_at(mono, layer, int(t_start * sr), gain=0.50)

        # Downlifter
        if cfg.downlifter:
            for ev in analysis.events:
                if ev.event_type in ("flat_buildup", "thin_mid"):
                    t_end  = ev.end_time_s
                    lif_dur = min(bar_s * 1.0, 3.0)
                    layer  = self._synth.downlifter(lif_dur)
                    _mix_at(mono, layer, int(t_end * sr), gain=0.50)

        # ---- Re-assemble stereo ------------------------------------
        mono = np.clip(mono, -1.0, 1.0).astype(np.float32)
        if stereo:
            # Slight pan divergence for width
            left  = mono * 0.98
            right = mono * 1.02
            return np.stack([left, right], axis=-1)
        return mono
