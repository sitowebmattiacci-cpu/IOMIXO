"""Arrangement JSON schema — Phase 0 of remix workstation pivot.

The arrangement is the canonical representation of a user's remix timeline.
It is produced by the AI Seed Generator (Phase 2 — repurposed
SmartCompositionStage), edited live in the browser workstation, persisted
to the `arrangements` table, and consumed by the Render-from-Arrangement
engine (Phase 1) to produce a final mastered MP3/WAV.

Mirrored in TypeScript at backend/src/schemas/arrangement.ts. Keep both
sides in sync.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, NonNegativeFloat


SCHEMA_VERSION = 1


class ClipFx(BaseModel):
    enabled: bool = True
    attack_ms: float = 2.0
    decay_ms: float = 300.0
    filter_cutoff_hz: float = 20000.0
    resonance: float = 0.0
    drive: float = 0.0
    transient_punch: float = 0.0
    limiter_db: float = 0.0
    reverb: float = 0.0
    delay: float = 0.0
    stereo_width: float = 1.0


class Clip(BaseModel):
    id: str
    asset_kind: Literal["stem", "soundbank", "user_sample"]
    asset_ref: str  # storage key in the asset's bucket

    # Placement on the timeline (project time).
    start_sec: NonNegativeFloat
    end_sec: NonNegativeFloat

    # Region of the source asset this clip plays. Defaults to the start of
    # the file; renderer treats end as min(asset_duration, start_sec+(end-offset)).
    offset_sec: NonNegativeFloat = 0.0

    # Audio modifiers — applied at render time.
    gain_db: float = 0.0
    fade_in_sec: NonNegativeFloat = 0.0
    fade_out_sec: NonNegativeFloat = 0.0
    pitch_semitones: float = 0.0
    time_stretch_ratio: float = 1.0
    fx: ClipFx | None = None


class Track(BaseModel):
    id: str
    name: str
    lane: int
    source: dict | None = None
    user_created: bool | None = None
    volume_db: float = 0.0
    mute: bool = False
    solo: bool = False
    clips: list[Clip] = Field(default_factory=list)


class AIAssistFlags(BaseModel):
    auto_beat_sync: bool = False
    harmonic_match: bool = False
    groove_tighten: bool = False


class MasterSettings(BaseModel):
    target_lufs: float = -14.0
    limiter: bool = True


class Arrangement(BaseModel):
    version: int = SCHEMA_VERSION
    project_id: str
    bpm: float
    musical_key: str | None = None
    duration_sec: NonNegativeFloat
    lanes: list[Track] = Field(default_factory=list)
    tracks: list[Track] = Field(default_factory=list)
    ai_assist_flags: AIAssistFlags = Field(default_factory=AIAssistFlags)
    master: MasterSettings = Field(default_factory=MasterSettings)
