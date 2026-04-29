"""
energy_analyzer.py — Detects energy-weak regions in a rendered mashup WAV.

The analyzer produces a list of EnergyEvent objects marking timestamps where
the audio is commercially under-powered:

  weak_drop        — energy falls below 40% of the track mean (missing kick/bass drop)
  thin_mid         — mid-band energy is sparse (2x below track average)
  empty_low_end    — sub-bass almost absent (RMS below -50 dBFS)
  missing_transient — no clear transient within a beat-aligned window
  flat_buildup     — energy envelope fails to rise over 4+ bars heading into a climax

These events drive layer_injector.py: WHERE and WHAT to inject.

No dependency on sound_modernizer.py (that module has no analysis capabilities).
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional
from scipy import signal as scipy_signal
import librosa
from loguru import logger


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------
_FRAME_HOP      = 512          # samples per frame
_FRAME_SIZE     = 2048
_SR_ANALYSIS    = 44100        # always re-sample to 44100 for analysis

# Frequency band edges (Hz) for three-band RMS analysis
_BAND_SUB       = (20,   200)
_BAND_MID       = (200,  4000)
_BAND_HIGH      = (4000, 20000)

# Thresholds (fraction of track-mean or absolute)
_WEAK_DROP_RATIO      = 0.40    # frame RMS < 40% of track mean → weak_drop
_THIN_MID_RATIO       = 0.50    # mid-band RMS < 50% of mid-band mean → thin_mid
_EMPTY_LOW_DBFS       = -50.0   # sub-bass RMS below this dBFS → empty_low_end
_FLAT_BUILDUP_BARS    = 4       # consecutive bars without rise
_TRANSIENT_WINDOW_S   = 0.5     # search window for transient detection


# ------------------------------------------------------------------
# Output dataclass
# ------------------------------------------------------------------
@dataclass
class EnergyEvent:
    time_s:      float                   # onset time in seconds
    end_time_s:  float                   # end of the region
    event_type:  str                     # see module docstring
    severity:    float                   # 0.0 (mild) – 1.0 (critical)
    description: str = ""


@dataclass
class EnergyAnalysis:
    events:        List[EnergyEvent]     # detected weak points
    frame_times:   np.ndarray            # time axis for frame RMS arrays
    rms_total:     np.ndarray            # per-frame total RMS
    rms_sub:       np.ndarray            # per-frame sub-bass RMS
    rms_mid:       np.ndarray            # per-frame mid-band RMS
    rms_high:      np.ndarray            # per-frame high-band RMS
    mean_rms:      float                 # overall mean RMS of the track
    duration_s:    float                 # total duration in seconds
    beat_times:    np.ndarray            # librosa beat-tracker times


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _bandpass_rms(y: np.ndarray, sr: int, low: float, high: float,
                  frame_size: int, hop: int) -> np.ndarray:
    """Compute per-frame RMS of a bandpass-filtered signal."""
    nyq = sr / 2.0
    lo  = max(low / nyq, 1e-4)
    hi  = min(high / nyq, 1.0 - 1e-4)
    sos = scipy_signal.butter(4, [lo, hi], btype="bandpass", output="sos")
    y_bp = scipy_signal.sosfilt(sos, y)
    frames = librosa.util.frame(y_bp, frame_length=frame_size, hop_length=hop)
    return np.sqrt(np.mean(frames ** 2, axis=0))


def _db(rms: np.ndarray, eps: float = 1e-9) -> np.ndarray:
    return 20.0 * np.log10(np.maximum(rms, eps))


def _merge_adjacent(events: List[EnergyEvent], gap_s: float = 0.25) -> List[EnergyEvent]:
    """Merge consecutive events of the same type within gap_s of each other."""
    if not events:
        return events
    merged: List[EnergyEvent] = [events[0]]
    for ev in events[1:]:
        prev = merged[-1]
        if ev.event_type == prev.event_type and (ev.time_s - prev.end_time_s) <= gap_s:
            prev.end_time_s = max(prev.end_time_s, ev.end_time_s)
            prev.severity   = max(prev.severity, ev.severity)
        else:
            merged.append(ev)
    return merged


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

class EnergyAnalyzer:
    """
    Analyse a rendered mashup WAV file and return an EnergyAnalysis
    containing all commercially weak regions.

    Usage::

        analyzer = EnergyAnalyzer()
        result   = analyzer.analyze("/tmp/mashup.wav")
        for ev in result.events:
            print(ev.event_type, ev.time_s, ev.severity)
    """

    def __init__(self, sr: int = _SR_ANALYSIS) -> None:
        self._sr = sr

    # ------------------------------------------------------------------
    def analyze(self, audio_path: str, bpm: Optional[float] = None) -> EnergyAnalysis:
        """
        Load audio and detect energy events.

        Args:
            audio_path: Path to a WAV/FLAC file.
            bpm:        Optional known BPM to override beat tracker.

        Returns:
            EnergyAnalysis with all detected events.
        """
        logger.info(f"EnergyAnalyzer: loading {audio_path}")
        y, sr = librosa.load(audio_path, sr=self._sr, mono=True)
        return self.analyze_array(y, sr, bpm=bpm)

    # ------------------------------------------------------------------
    def analyze_array(self, y: np.ndarray, sr: int,
                      bpm: Optional[float] = None) -> EnergyAnalysis:
        """
        Analyse a pre-loaded mono numpy array.
        sr should equal self._sr for best accuracy.
        """
        if y.ndim > 1:
            y = librosa.to_mono(y.T if y.shape[0] == 2 else y)

        hop  = _FRAME_HOP
        fsz  = _FRAME_SIZE
        dur  = len(y) / sr

        # ---- total RMS
        frames    = librosa.util.frame(y, frame_length=fsz, hop_length=hop)
        rms_total = np.sqrt(np.mean(frames ** 2, axis=0))
        frame_times = librosa.frames_to_time(
            np.arange(len(rms_total)), sr=sr, hop_length=hop
        )
        mean_rms = float(np.mean(rms_total)) if rms_total.size else 1e-9

        # ---- band RMS
        rms_sub  = _bandpass_rms(y, sr, *_BAND_SUB,  fsz, hop)
        rms_mid  = _bandpass_rms(y, sr, *_BAND_MID,  fsz, hop)
        rms_high = _bandpass_rms(y, sr, *_BAND_HIGH, fsz, hop)

        # ---- beat tracking
        tempo_arr, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
        if bpm is not None:
            # recalculate beat grid at known BPM
            spb          = 60.0 / bpm
            n_beats      = int(dur / spb)
            beat_times_a = np.arange(n_beats) * spb
        else:
            beat_times_a = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)

        # ---- detect events
        events: List[EnergyEvent] = []
        events.extend(self._detect_weak_drops(frame_times, rms_total, mean_rms))
        events.extend(self._detect_thin_mid(frame_times, rms_mid))
        events.extend(self._detect_empty_low(frame_times, rms_sub))
        events.extend(self._detect_missing_transients(y, sr, beat_times_a))
        events.extend(self._detect_flat_buildups(frame_times, rms_total, beat_times_a))

        # sort + merge
        events.sort(key=lambda e: e.time_s)
        events = _merge_adjacent(events)

        logger.info(f"EnergyAnalyzer: {len(events)} events detected in {dur:.1f}s audio")
        return EnergyAnalysis(
            events      = events,
            frame_times = frame_times,
            rms_total   = rms_total,
            rms_sub     = rms_sub,
            rms_mid     = rms_mid,
            rms_high    = rms_high,
            mean_rms    = mean_rms,
            duration_s  = dur,
            beat_times  = beat_times_a,
        )

    # ------------------------------------------------------------------
    # Detectors
    # ------------------------------------------------------------------

    def _detect_weak_drops(self, frame_times: np.ndarray, rms: np.ndarray,
                           mean_rms: float) -> List[EnergyEvent]:
        events: List[EnergyEvent] = []
        threshold = mean_rms * _WEAK_DROP_RATIO
        in_region = False
        start_i   = 0
        for i, r in enumerate(rms):
            if r < threshold and not in_region:
                in_region = True
                start_i   = i
            elif r >= threshold and in_region:
                in_region = False
                t0   = float(frame_times[start_i])
                t1   = float(frame_times[i - 1])
                sev  = float(np.clip(1.0 - (np.mean(rms[start_i:i]) / mean_rms), 0, 1))
                if (t1 - t0) >= 0.1:   # minimum 100ms region
                    events.append(EnergyEvent(
                        time_s=t0, end_time_s=t1,
                        event_type="weak_drop",
                        severity=sev,
                        description=f"Energy {sev*100:.0f}% below track mean",
                    ))
        return events

    def _detect_thin_mid(self, frame_times: np.ndarray,
                         rms_mid: np.ndarray) -> List[EnergyEvent]:
        events: List[EnergyEvent] = []
        if rms_mid.size == 0:
            return events
        mean_mid  = float(np.mean(rms_mid))
        threshold = mean_mid * _THIN_MID_RATIO
        in_region = False
        start_i   = 0
        for i, r in enumerate(rms_mid):
            if r < threshold and not in_region:
                in_region = True
                start_i   = i
            elif r >= threshold and in_region:
                in_region = False
                t0  = float(frame_times[start_i])
                t1  = float(frame_times[i - 1])
                sev = float(np.clip(1.0 - (np.mean(rms_mid[start_i:i]) / mean_mid), 0, 1))
                if (t1 - t0) >= 0.2:
                    events.append(EnergyEvent(
                        time_s=t0, end_time_s=t1,
                        event_type="thin_mid",
                        severity=sev * 0.7,   # mid thinness is less severe than drop
                        description="Mid-band energy sparse",
                    ))
        return events

    def _detect_empty_low(self, frame_times: np.ndarray,
                          rms_sub: np.ndarray) -> List[EnergyEvent]:
        events: List[EnergyEvent] = []
        db_sub    = _db(rms_sub)
        in_region = False
        start_i   = 0
        for i, d in enumerate(db_sub):
            if d < _EMPTY_LOW_DBFS and not in_region:
                in_region = True
                start_i   = i
            elif d >= _EMPTY_LOW_DBFS and in_region:
                in_region = False
                t0  = float(frame_times[start_i])
                t1  = float(frame_times[i - 1])
                sev = float(np.clip(abs(np.mean(db_sub[start_i:i]) - _EMPTY_LOW_DBFS) / 20.0, 0, 1))
                if (t1 - t0) >= 0.3:
                    events.append(EnergyEvent(
                        time_s=t0, end_time_s=t1,
                        event_type="empty_low_end",
                        severity=sev,
                        description="Sub-bass absent",
                    ))
        return events

    def _detect_missing_transients(self, y: np.ndarray, sr: int,
                                   beat_times: np.ndarray) -> List[EnergyEvent]:
        """
        For each beat, check if a strong transient exists within
        ±_TRANSIENT_WINDOW_S / 2 of the beat onset.
        """
        events: List[EnergyEvent] = []
        if beat_times.size < 4:
            return events
        # Spectral flux onset envelope
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=_FRAME_HOP)
        times_env = librosa.times_like(onset_env, sr=sr, hop_length=_FRAME_HOP)
        mean_env  = float(np.mean(onset_env)) if onset_env.size else 1.0
        half_win  = _TRANSIENT_WINDOW_S / 2

        for bt in beat_times:
            mask  = (times_env >= bt - half_win) & (times_env <= bt + half_win)
            chunk = onset_env[mask]
            if chunk.size == 0:
                continue
            peak = float(np.max(chunk))
            if peak < mean_env * 0.5:   # transient weaker than 50% of mean
                sev = float(np.clip(1.0 - peak / (mean_env * 0.5), 0, 1))
                events.append(EnergyEvent(
                    time_s=float(bt),
                    end_time_s=float(bt) + _TRANSIENT_WINDOW_S,
                    event_type="missing_transient",
                    severity=sev * 0.6,
                    description="Weak transient on beat",
                ))
        return events

    def _detect_flat_buildups(self, frame_times: np.ndarray, rms: np.ndarray,
                              beat_times: np.ndarray) -> List[EnergyEvent]:
        """
        Detect windows of >= _FLAT_BUILDUP_BARS bars where RMS fails to increase.
        Uses beat tracking to estimate bar size (4 beats = 1 bar).
        """
        events: List[EnergyEvent] = []
        if beat_times.size < 8:
            return events

        # Estimate beats-per-bar = 4 (4/4 time assumed)
        n_beats   = len(beat_times)
        bar_beats = 4
        n_bars    = n_beats // bar_beats

        for bar_idx in range(n_bars - _FLAT_BUILDUP_BARS):
            # Average RMS per bar in the window
            bar_rms_vals = []
            for b in range(_FLAT_BUILDUP_BARS):
                beat_start = beat_times[bar_idx * bar_beats + b * bar_beats]
                beat_end   = beat_times[min(
                    bar_idx * bar_beats + (b + 1) * bar_beats,
                    len(beat_times) - 1,
                )]
                mask  = (frame_times >= beat_start) & (frame_times < beat_end)
                chunk = rms[mask]
                bar_rms_vals.append(float(np.mean(chunk)) if chunk.size else 0.0)

            # Check: does energy rise across these bars?
            if len(bar_rms_vals) >= 2:
                slope = np.polyfit(np.arange(len(bar_rms_vals)), bar_rms_vals, 1)[0]
                if slope <= 0:
                    t0  = float(beat_times[bar_idx * bar_beats])
                    t1  = float(beat_times[min(
                        (bar_idx + _FLAT_BUILDUP_BARS) * bar_beats,
                        len(beat_times) - 1,
                    )])
                    sev = float(np.clip(abs(slope) / (float(np.mean(bar_rms_vals)) + 1e-9), 0, 1))
                    if (t1 - t0) >= 1.0:
                        events.append(EnergyEvent(
                            time_s=t0,
                            end_time_s=t1,
                            event_type="flat_buildup",
                            severity=min(sev * 0.8, 1.0),
                            description=f"No energy rise over {_FLAT_BUILDUP_BARS} bars",
                        ))
        return events
