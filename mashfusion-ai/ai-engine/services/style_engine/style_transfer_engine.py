"""
style_transfer_engine.py — Premium Commercial Remix Style Engine orchestrator.

Entry point: apply_commercial_style()

Pipeline (6 stages):
  1. load_preset          — validate + load JSON preset profile
  2. analyze_energy       — detect commercially weak points in the rendered mashup
  3. inject_layers        — synthesise + mix layers at weak points
  4. apply_sidechain      — pumping gain compression synced to kick grid
  5. render_transition_fx — render FX audio from ComposerEngine TransitionMarkers
  6. apply_mastering_chain— full pro mastering chain (EQ → multiband → transient → LUFS)

The function writes the final file to `output_path` and returns a metadata dict.

sound_modernizer.py is preserved as an optional lightweight fallback
(enabled only if style_engine raises an exception in Stage 6).

Usage::

    from services.style_engine import apply_commercial_style

    metadata = apply_commercial_style(
        input_path          = "/tmp/mashup_raw.wav",
        output_path         = "/tmp/mashup_styled.wav",
        preset_name         = "festival_edm",
        transition_markers  = markers,   # from composer engine (can be [])
        quality             = "hd",
        bpm                 = 128.0,
        drums_stem          = drums_array,   # optional numpy array
        progress_cb         = lambda p, msg: print(p, msg),
    )
"""

from __future__ import annotations

import os
import shutil
import tempfile
from typing import Any, Callable, Dict, List, Optional

import numpy as np
import librosa
import soundfile as sf
from loguru import logger

from .preset_loader        import load_preset, PresetProfile
from .energy_analyzer      import EnergyAnalyzer
from .layer_injector       import LayerInjector
from .sidechain_engine     import SidechainEngine
from .transition_fx_renderer import TransitionFXRenderer
from .mastering_chain      import apply_mastering_chain


_DEFAULT_SR = 44100

# Mapping from sound_modernizer preset names to style_engine preset IDs
# (ensures backward compatibility when the old preset name is passed in)
_LEGACY_PRESET_MAP: Dict[str, str] = {
    "edm_festival":    "festival_edm",
    "house_club":      "house_club",
    "deep_emotional":  "deep_emotional",
    "pop_radio":       "radio_pop",
    "cinematic":       "cinematic_epic",
    "chill_sunset":    "chill_electronic",
}


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _load_audio(path: str, sr: int) -> np.ndarray:
    """Load audio → (samples, 2) float32 stereo."""
    y, _ = librosa.load(path, sr=sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y], axis=-1)
    elif y.shape[0] == 2:
        y = y.T   # → (samples, channels)
    return y.astype(np.float32)


def _write_tmp(y: np.ndarray, sr: int) -> str:
    """Write audio array to a temp WAV file, return path."""
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    sf.write(path, y, sr, subtype="PCM_24")
    return path


def _progress(cb: Optional[Callable], pct: float, msg: str) -> None:
    if cb:
        try:
            cb(pct, msg)
        except Exception:
            pass
    logger.info(f"[StyleEngine {pct:.0f}%] {msg}")


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------

def apply_commercial_style(
    input_path:         str,
    output_path:        str,
    preset_name:        str = "festival_edm",
    transition_markers: Optional[List[Any]] = None,
    quality:            str = "hd",
    bpm:                float = 128.0,
    root_hz:            float = 55.0,
    drums_stem:         Optional[np.ndarray] = None,
    progress_cb:        Optional[Callable[[float, str], None]] = None,
    sr:                 int = _DEFAULT_SR,
) -> Dict[str, Any]:
    """
    Transform a rendered mashup into a commercially polished radio-ready track.

    Args:
        input_path:         Path to the rendered mashup WAV (from composer engine).
        output_path:        Destination path for the styled + mastered WAV.
        preset_name:        Style preset ID (e.g. "festival_edm").
                            Also accepts legacy sound_modernizer names.
        transition_markers: Optional list of TransitionMarker objects from the
                            Autonomous Composer Engine. Rendered into the mix.
        quality:            Mastering quality level: "standard" | "hd" | "professional"
        bpm:                Track BPM for rhythm-synced layers + FX.
        root_hz:            Root frequency for bass/pad synthesis (Hz).
        drums_stem:         Optional mono/stereo numpy array of the isolated
                            drums stem for accurate sidechain kick detection.
        progress_cb:        Optional progress callback(pct: float, msg: str).
        sr:                 Working sample rate (default 44100).

    Returns:
        dict with keys:
          preset_id, stages, energy_events, mastering, errors (list)
    """
    markers    = transition_markers or []
    errors: List[str] = []
    stage_meta: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Resolve legacy preset names
    # ------------------------------------------------------------------
    resolved_preset = _LEGACY_PRESET_MAP.get(preset_name, preset_name)

    # ------------------------------------------------------------------
    # Stage 1: Load preset
    # ------------------------------------------------------------------
    _progress(progress_cb, 5, f"Loading style preset: {resolved_preset}")
    try:
        preset = load_preset(resolved_preset)
    except (ValueError, FileNotFoundError) as exc:
        # Unknown preset — fall back to radio_pop as a safe default
        logger.warning(f"StyleEngine: unknown preset '{preset_name}' — falling back to radio_pop: {exc}")
        errors.append(f"Preset fallback: {exc}")
        preset = load_preset("radio_pop")

    stage_meta["preset"] = {
        "id":             preset.id,
        "display_name":   preset.display_name,
        "energy_profile": preset.energy_profile,
        "target_lufs":    preset.target_lufs,
    }

    # ------------------------------------------------------------------
    # Stage 2: Load audio + Energy analysis
    # ------------------------------------------------------------------
    _progress(progress_cb, 15, "Analysing mashup energy profile…")
    try:
        audio = _load_audio(input_path, sr)
        analyzer = EnergyAnalyzer(sr=sr)
        analysis = analyzer.analyze_array(
            (audio[:, 0] + audio[:, 1]) / 2.0,
            sr=sr,
            bpm=bpm,
        )
        stage_meta["energy"] = {
            "n_events":    len(analysis.events),
            "duration_s":  round(analysis.duration_s, 2),
            "mean_rms":    round(float(analysis.mean_rms), 6),
            "event_types": [ev.event_type for ev in analysis.events],
        }
        logger.info(
            f"StyleEngine: {len(analysis.events)} energy events in "
            f"{analysis.duration_s:.1f}s audio"
        )
    except Exception as exc:
        logger.error(f"StyleEngine: energy analysis failed: {exc}")
        errors.append(f"Energy analysis: {exc}")
        # Load audio anyway, skip injection
        audio = _load_audio(input_path, sr)
        analysis = None
        stage_meta["energy"] = {"error": str(exc)}

    # ------------------------------------------------------------------
    # Stage 3: Layer injection
    # ------------------------------------------------------------------
    _progress(progress_cb, 30, "Injecting commercial layers…")
    try:
        if analysis is not None and preset.layers.bass_layer != "none":
            injector = LayerInjector(sr=sr)
            audio    = injector.inject(audio, analysis, preset, bpm=bpm, root_hz=root_hz)
            stage_meta["layer_injection"] = {
                "bass_layer": preset.layers.bass_layer,
                "pad_layer":  preset.layers.pad_layer,
                "kick_boost": preset.layers.kick_boost,
            }
        else:
            stage_meta["layer_injection"] = {"skipped": True}
    except Exception as exc:
        logger.error(f"StyleEngine: layer injection failed: {exc}")
        errors.append(f"Layer injection: {exc}")
        stage_meta["layer_injection"] = {"error": str(exc)}

    # ------------------------------------------------------------------
    # Stage 4: Sidechain
    # ------------------------------------------------------------------
    _progress(progress_cb, 45, "Applying sidechain compression…")
    try:
        sc_cfg = preset.sidechain
        if sc_cfg.enabled and sc_cfg.depth > 0:
            sc_engine = SidechainEngine(sr=sr)
            audio     = sc_engine.apply(audio, drums_stem, sc_cfg, bpm=bpm)
            stage_meta["sidechain"] = {
                "depth":       sc_cfg.depth,
                "attack_ms":   sc_cfg.attack_ms,
                "release_ms":  sc_cfg.release_ms,
                "target_stems": sc_cfg.target_stems,
            }
        else:
            stage_meta["sidechain"] = {"skipped": True, "reason": "disabled in preset"}
    except Exception as exc:
        logger.error(f"StyleEngine: sidechain failed: {exc}")
        errors.append(f"Sidechain: {exc}")
        stage_meta["sidechain"] = {"error": str(exc)}

    # ------------------------------------------------------------------
    # Stage 5: Transition FX rendering
    # ------------------------------------------------------------------
    _progress(progress_cb, 60, "Rendering transition FX…")
    try:
        if markers:
            fx_renderer = TransitionFXRenderer(sr=sr)
            audio       = fx_renderer.render_all(audio, markers, bpm=bpm)
            stage_meta["transition_fx"] = {"n_markers": len(markers)}
        else:
            stage_meta["transition_fx"] = {"skipped": True, "reason": "no markers"}
    except Exception as exc:
        logger.error(f"StyleEngine: transition FX rendering failed: {exc}")
        errors.append(f"Transition FX: {exc}")
        stage_meta["transition_fx"] = {"error": str(exc)}

    # ------------------------------------------------------------------
    # Stage 6: Mastering chain
    # ------------------------------------------------------------------
    _progress(progress_cb, 75, "Applying professional mastering chain…")
    mastering_meta: Dict[str, Any] = {}
    mastering_ok = False

    # Write pre-master WAV
    tmp_pre_master = _write_tmp(audio, sr)
    try:
        mastering_meta = apply_mastering_chain(
            input_path  = tmp_pre_master,
            output_path = output_path,
            preset      = preset,
            quality     = quality,
        )
        mastering_ok = True
        stage_meta["mastering"] = mastering_meta
    except Exception as exc:
        logger.error(f"StyleEngine: mastering chain failed: {exc}")
        errors.append(f"Mastering chain: {exc}")
        stage_meta["mastering"] = {"error": str(exc)}
        # Fallback: use sound_modernizer.apply_style_preset as a last resort
        try:
            from ..sound_modernizer import apply_style_preset as _legacy_apply
            fallback_name = _LEGACY_PRESET_MAP.get(preset.id, "pop_radio")
            _legacy_apply(tmp_pre_master, output_path, fallback_name)
            mastering_meta = {"fallback": "sound_modernizer", "preset": fallback_name}
            stage_meta["mastering"]["fallback"] = mastering_meta
            mastering_ok = True
            logger.warning(f"StyleEngine: used sound_modernizer fallback for mastering")
        except Exception as exc2:
            logger.error(f"StyleEngine: mastering fallback also failed: {exc2}")
            errors.append(f"Mastering fallback: {exc2}")
            # Last resort: copy input through
            shutil.copy(tmp_pre_master, output_path)
    finally:
        try:
            os.unlink(tmp_pre_master)
        except OSError:
            pass

    _progress(progress_cb, 100, "Style engine complete")

    return {
        "preset_id":     preset.id,
        "stages":        stage_meta,
        "energy_events": [
            {
                "time_s":     ev.time_s,
                "end_time_s": ev.end_time_s,
                "event_type": ev.event_type,
                "severity":   round(ev.severity, 3),
            }
            for ev in (analysis.events if analysis else [])
        ],
        "mastering":     mastering_meta,
        "errors":        errors,
        "output_path":   output_path,
    }
