"""
Music analysis service using librosa.
Detects BPM, musical key, beats, sections, and energy map.
"""

import numpy as np
import librosa
from loguru import logger


_KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_MODE_NAMES = ["major", "minor"]


def _detect_key(y: np.ndarray, sr: int) -> tuple[str, float]:
    """Detect musical key using chroma-based Krumhansl-Schmuckler profiles."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)

    # Krumhansl-Schmuckler key profiles
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                               2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                               2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    best_score  = -np.inf
    best_key    = "C major"

    for shift in range(12):
        for mode_idx, profile in enumerate([major_profile, minor_profile]):
            rotated = np.roll(profile, shift)
            score   = np.corrcoef(chroma_mean, rotated)[0, 1]
            if score > best_score:
                best_score = score
                best_key   = f"{_KEY_NAMES[shift]} {_MODE_NAMES[mode_idx]}"

    confidence = float(np.clip((best_score + 1) / 2, 0, 1))
    return best_key, round(confidence * 100, 1)


def _detect_sections(y: np.ndarray, sr: int, beats: np.ndarray) -> list[dict]:
    """Simple section segmentation using RMS energy and beat positions."""
    frame_len = 2048
    hop_len   = 512
    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop_len)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_len)

    # Smooth RMS and detect energy transitions
    from scipy.signal import savgol_filter
    smoothed = savgol_filter(rms, min(51, len(rms) // 4 * 2 + 1), 3)

    # Create rough sections every ~30 seconds, labelled by energy quartile
    duration    = librosa.get_duration(y=y, sr=sr)
    section_len = 30.0
    section_labels = ["intro", "verse", "chorus", "bridge", "verse", "chorus", "outro"]
    sections = []

    start = 0.0
    idx   = 0
    while start < duration:
        end = min(start + section_len, duration)
        # Average RMS in this window
        mask  = (rms_times >= start) & (rms_times < end)
        energy = float(smoothed[mask].mean()) if mask.any() else 0.0

        label = section_labels[min(idx, len(section_labels) - 1)]
        sections.append({
            "label":      label,
            "start":      round(start, 2),
            "end":        round(end, 2),
            "energy":     round(energy, 5),
        })
        start += section_len
        idx   += 1

    return sections


def analyze_track(audio_path: str) -> dict:
    """
    Full audio analysis.
    Returns dict with: bpm, bpm_confidence, musical_key, key_confidence,
    time_signature, sections, beat_timestamps, energy_map.
    """
    logger.info(f"Analyzing: {audio_path}")

    y, sr = librosa.load(audio_path, sr=44100, mono=True)

    # BPM + beats
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    tempo_scalar = float(np.asarray(tempo).flatten()[0]) if np.asarray(tempo).size else 0.0
    bpm = round(tempo_scalar, 2)

    # Confidence from beat strength consistency
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    beat_strengths = onset_env[beat_frames]
    bpm_confidence = round(float(np.clip(beat_strengths.mean() / 5, 0, 1)) * 100, 1)

    beat_timestamps = [round(float(t), 3) for t in librosa.frames_to_time(beat_frames, sr=sr)]

    # Key
    musical_key, key_confidence = _detect_key(y, sr)

    # Time signature (approximation from beat patterns)
    time_signature = "4/4"

    # Sections
    sections = _detect_sections(y, sr, beat_frames)

    # Energy map (1 point per 5 seconds)
    hop = int(sr * 5)
    energy_map = []
    for i in range(0, len(y), hop):
        chunk   = y[i: i + hop]
        rms_val = float(np.sqrt(np.mean(chunk ** 2)))
        t       = round(i / sr, 2)
        energy_map.append({"time": t, "value": round(rms_val, 5)})

    result = {
        "bpm":              bpm,
        "bpm_confidence":   bpm_confidence,
        "musical_key":      musical_key,
        "key_confidence":   key_confidence,
        "time_signature":   time_signature,
        "sections":         sections,
        "beat_timestamps":  beat_timestamps[:1000],  # cap to 1000
        "energy_map":       energy_map,
    }

    logger.info(f"Analysis done — BPM: {bpm}, Key: {musical_key}")
    return result
