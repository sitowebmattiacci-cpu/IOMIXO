"""
style_engine package — Premium Commercial Remix Style Engine.

Public API::

    from services.style_engine import apply_commercial_style
    from services.style_engine import load_preset, list_presets

Modules:
  preset_loader         — JSON preset loading + validation
  energy_analyzer       — weak energy region detection
  layer_injector        — synthetic layer injection (kick, bass, pad, riser, etc.)
  sidechain_engine      — kick-synced gain pumping
  transition_fx_renderer— FX audio synthesis (riser, impact, reverse cymbal, etc.)
  mastering_chain       — full professional mastering chain
  style_transfer_engine — orchestrator (main entry point)
"""

from .style_transfer_engine import apply_commercial_style
from .preset_loader         import load_preset, list_presets, PresetProfile
from .energy_analyzer       import EnergyAnalyzer, EnergyAnalysis, EnergyEvent
from .layer_injector        import LayerInjector
from .sidechain_engine      import SidechainEngine
from .transition_fx_renderer import TransitionFXRenderer
from .mastering_chain       import apply_mastering_chain

__all__ = [
    "apply_commercial_style",
    "load_preset",
    "list_presets",
    "PresetProfile",
    "EnergyAnalyzer",
    "EnergyAnalysis",
    "EnergyEvent",
    "LayerInjector",
    "SidechainEngine",
    "TransitionFXRenderer",
    "apply_mastering_chain",
]
