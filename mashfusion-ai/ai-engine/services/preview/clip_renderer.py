"""Preview clip renderer — generates 3 short teaser MP3s from analyzed tracks.

This is the cost-control core of the preview pipeline. Instead of running the
full smart composer + style injection + mastering chain (≥ 3-8 min on CPU), we:

  1. Pick three high-impact musical windows from the energy map / sections
     (chorus hook, vocal peak, drop collision).
  2. Cross-fade the corresponding stem regions of A and B into a single mono-
     compatible mix per window.
  3. Apply a quick peak-limit + LUFS soft-target — no full mastering chain.
  4. Encode each window as a 128 kbps MP3 (small, lightweight teaser).

The resulting clips feel like real, desirable mashup teasers rather than
truncated mush — selecting *interesting* windows is the entire point.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import soundfile as sf
from loguru import logger

from utils.audio_utils import normalize_peak
from .snippet_selector import (
    ScoredWindow,
    polish_clip,
    select_best_window,
)


# Extra audio rendered around the rough source-window pick so the snippet
# selector has enough material to find the best 25-35s segment.
CANDIDATE_BUFFER_SEC = 12.0
SNIPPET_MIN_SEC = 25.0
SNIPPET_MAX_SEC = 35.0


# A clip is a slice of the source track defined by a start time and duration.
@dataclass(frozen=True)
class ClipWindow:
    variant: str           # 'A' | 'B' | 'C'
    label: str             # human-readable hook description
    start_sec: float
    duration_sec: float
    # Stem mix recipe — relative gains applied to each stem of each track.
    # Keys must match what services.stem_separator.separate_stems returns
    # (typically: vocals, drums, bass, other). Missing keys default to 0.
    a_stem_gains: dict
    b_stem_gains: dict


# ── Window selection ────────────────────────────────────────────────────────


def _peak_energy_time(energy_map: list[dict], track_duration: float) -> float:
    if not energy_map:
        return max(0.0, track_duration * 0.5)
    return float(max(energy_map, key=lambda p: p.get("value", 0.0))["time"])


def _section_time(sections: list[dict], track_duration: float, label_hint: str) -> float | None:
    """Return the start time of the first section whose label matches ``label_hint``.

    The analyzer emits energy-quartile labels (q1..q4) plus optional named
    sections; we accept any partial match.
    """
    if not sections:
        return None
    for sec in sections:
        if label_hint.lower() in str(sec.get("label", "")).lower():
            t = sec.get("start") or sec.get("start_sec") or sec.get("time")
            if t is not None and 0 <= float(t) < track_duration:
                return float(t)
    return None


def _clamp_window(start: float, duration: float, total: float) -> tuple[float, float]:
    if total <= 0:
        return 0.0, duration
    if start < 0:
        start = 0.0
    if start + duration > total:
        start = max(0.0, total - duration)
    return start, duration


def select_hook_windows(
    *,
    analysis_a: dict,
    analysis_b: dict,
    duration_a: float,
    duration_b: float,
    preview_duration_sec: int,
) -> list[ClipWindow]:
    """Pick 3 distinct, high-impact teaser windows.

    Variant A — chorus hook of A on top of the strongest drum/instrumental
    region of B.
    Variant B — vocal peak of A laid over the most energetic instrumental
    moment of B.
    Variant C — "drop collision": both tracks at their highest combined energy.
    """
    pd = float(preview_duration_sec)

    # Variant A: chorus on A + drum drop on B
    a_chorus = _section_time(analysis_a.get("sections", []), duration_a, "chorus") \
        or _peak_energy_time(analysis_a.get("energy_map", []), duration_a)
    b_drop = _peak_energy_time(analysis_b.get("energy_map", []), duration_b)
    a_start_a, a_dur = _clamp_window(a_chorus - pd * 0.2, pd, duration_a)
    b_start_a, _     = _clamp_window(b_drop   - pd * 0.2, pd, duration_b)

    # Variant B: vocal peak of A over instrumental of B
    a_vocal = _section_time(analysis_a.get("sections", []), duration_a, "verse") \
        or _peak_energy_time(analysis_a.get("energy_map", []), duration_a) - pd * 0.5
    b_inst  = _peak_energy_time(analysis_b.get("energy_map", []), duration_b) - pd * 0.5
    a_start_b, _ = _clamp_window(a_vocal, pd, duration_a)
    b_start_b, _ = _clamp_window(b_inst,  pd, duration_b)

    # Variant C: drop collision (both at max energy simultaneously)
    a_peak_t = _peak_energy_time(analysis_a.get("energy_map", []), duration_a)
    b_peak_t = _peak_energy_time(analysis_b.get("energy_map", []), duration_b)
    a_start_c, _ = _clamp_window(a_peak_t - pd * 0.3, pd, duration_a)
    b_start_c, _ = _clamp_window(b_peak_t - pd * 0.3, pd, duration_b)

    return [
        ClipWindow(
            variant="A", label="Chorus hook + drum drop",
            start_sec=a_start_a, duration_sec=pd,
            a_stem_gains={"vocals": 1.0, "other": 0.4, "bass": 0.2, "drums": 0.0},
            b_stem_gains={"drums":  1.0, "bass":  0.9, "other": 0.4, "vocals": 0.0},
        ),
        ClipWindow(
            variant="B", label="Vocal peak + instrumental",
            start_sec=a_start_b, duration_sec=pd,
            a_stem_gains={"vocals": 1.0, "other": 0.2, "drums": 0.0, "bass": 0.0},
            b_stem_gains={"other":  1.0, "bass":  0.7, "drums": 0.6, "vocals": 0.0},
        ),
        ClipWindow(
            variant="C", label="Drop collision",
            start_sec=a_start_c, duration_sec=pd,
            a_stem_gains={"vocals": 0.9, "drums": 0.5, "bass": 0.4, "other": 0.5},
            b_stem_gains={"drums":  1.0, "bass":  0.9, "other": 0.7, "vocals": 0.0},
        ),
    ]


# ── Clip rendering ──────────────────────────────────────────────────────────


def _load_stem_window(stem_path: str | Path, start_sec: float, duration_sec: float) -> tuple[np.ndarray, int]:
    """Load a windowed slice of a stem WAV file."""
    info = sf.info(str(stem_path))
    sr = info.samplerate
    start_frame = int(max(0, start_sec) * sr)
    n_frames    = int(duration_sec * sr)
    audio, _ = sf.read(str(stem_path), start=start_frame, frames=n_frames, dtype="float32", always_2d=True)
    if audio.ndim == 2 and audio.shape[1] > 1:
        audio = audio.mean(axis=1)
    elif audio.ndim == 2:
        audio = audio[:, 0]
    return audio, sr


def _mix_stem_window(stems: dict, start_sec: float, duration_sec: float, gains: dict) -> tuple[np.ndarray, int]:
    """Sum-mix the stems of one track for a window with per-stem gains."""
    out: np.ndarray | None = None
    sr_ref: int | None = None
    target_len = 0
    for name, gain in gains.items():
        if gain <= 0:
            continue
        path = stems.get(name)
        if not path:
            continue
        audio, sr = _load_stem_window(path, start_sec, duration_sec)
        if sr_ref is None:
            sr_ref = sr
            target_len = int(duration_sec * sr_ref)
            out = np.zeros(target_len, dtype=np.float32)
        if sr != sr_ref:
            # Skip stems with mismatched sample rate (separator should be consistent).
            logger.warning(f"Stem {name} sr {sr} != ref {sr_ref}; skipping")
            continue
        if len(audio) < target_len:
            audio = np.pad(audio, (0, target_len - len(audio)))
        else:
            audio = audio[:target_len]
        out += audio * float(gain)
    if out is None or sr_ref is None:
        # Fallback silence
        sr_ref = 44100
        out = np.zeros(int(duration_sec * sr_ref), dtype=np.float32)
    return out, sr_ref


def _quick_master(audio: np.ndarray, ceiling_linear: float = 0.891) -> np.ndarray:
    """Fast peak limit + soft fade-in/out — no full mastering chain."""
    audio = normalize_peak(audio, ceiling_linear=ceiling_linear)
    # 250 ms fades to avoid clicks on boundary cuts
    sr = 44100
    fade = min(int(0.25 * sr), len(audio) // 4)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        audio[:fade] *= ramp
        audio[-fade:] *= ramp[::-1]
    return audio


def _encode_mp3(wav_path: Path, mp3_path: Path, bitrate: str = "128k") -> None:
    """Encode WAV → MP3 using ffmpeg (libmp3lame)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(wav_path),
        "-codec:a", "libmp3lame",
        "-b:a", bitrate,
        "-id3v2_version", "3",
        str(mp3_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg encoding failed:\n{result.stderr}")


def render_clip(
    *,
    stems_a: dict,
    stems_b: dict,
    window: ClipWindow,
    work_dir: Path,
) -> Path:
    """Render a single preview MP3 for one variant window.

    Strategy: render a slightly longer candidate around the rough source-pick
    (``window.duration_sec + CANDIDATE_BUFFER_SEC``), then run the snippet
    selector across the resulting arranged-output mix to lock onto the best
    25-35 s teaser segment, polish it, and encode.
    """
    candidate_dur = float(window.duration_sec) + CANDIDATE_BUFFER_SEC
    # Shift start back so the rough window sits roughly centred in the buffer.
    cand_start_a = max(0.0, window.start_sec - CANDIDATE_BUFFER_SEC * 0.5)
    cand_start_b = max(0.0, window.start_sec - CANDIDATE_BUFFER_SEC * 0.5)

    a_mix, sr = _mix_stem_window(stems_a, cand_start_a, candidate_dur, window.a_stem_gains)
    b_mix, _  = _mix_stem_window(stems_b, cand_start_b, candidate_dur, window.b_stem_gains)
    candidate = a_mix + b_mix

    # Stem-aware features for the selector — compute vocal/drum/bass surrogates
    # from the mixed stems so it doesn't have to guess via HPSS.
    vocal_surrogate, _   = _mix_stem_window(stems_a, cand_start_a, candidate_dur, {"vocals": 1.0})
    drum_surrogate, _    = _mix_stem_window(stems_b, cand_start_b, candidate_dur, {"drums": 1.0})
    bass_surrogate, _    = _mix_stem_window(stems_b, cand_start_b, candidate_dur, {"bass": 1.0})

    target_min = min(float(window.duration_sec), SNIPPET_MIN_SEC)
    target_max = max(float(window.duration_sec), SNIPPET_MAX_SEC)

    best = select_best_window(
        candidate, sr,
        target_min_sec=target_min,
        target_max_sec=target_max,
        vocal_stem=vocal_surrogate,
        drum_stem=drum_surrogate,
        bass_stem=bass_surrogate,
    )
    logger.info(
        f"[preview {window.variant}] selector picked {best.start_sec:.1f}-{best.end_sec:.1f}s "
        f"score={best.score:.3f} components={best.components}"
    )

    s = max(0, int(best.start_sec * sr))
    e = min(len(candidate), int(best.end_sec * sr))
    snippet = candidate[s:e]

    snippet = polish_clip(snippet, sr)
    snippet = _quick_master(snippet)

    wav_path = work_dir / f"preview_{window.variant.lower()}.wav"
    mp3_path = work_dir / f"preview_{window.variant.lower()}.mp3"
    sf.write(str(wav_path), snippet, sr)
    _encode_mp3(wav_path, mp3_path, bitrate="128k")
    return mp3_path


def render_all_clips(
    *,
    stems_a: dict,
    stems_b: dict,
    analysis_a: dict,
    analysis_b: dict,
    duration_a: float,
    duration_b: float,
    preview_duration_sec: int,
    work_dir: Path,
) -> list[tuple[ClipWindow, Path]]:
    """Render all 3 variant clips and return [(window, mp3_path), …]."""
    windows = select_hook_windows(
        analysis_a=analysis_a,
        analysis_b=analysis_b,
        duration_a=duration_a,
        duration_b=duration_b,
        preview_duration_sec=preview_duration_sec,
    )
    results: list[tuple[ClipWindow, Path]] = []
    for w in windows:
        try:
            path = render_clip(stems_a=stems_a, stems_b=stems_b, window=w, work_dir=work_dir)
            results.append((w, path))
        except Exception as exc:
            logger.warning(f"Preview clip {w.variant} render failed: {exc}")
    return results
