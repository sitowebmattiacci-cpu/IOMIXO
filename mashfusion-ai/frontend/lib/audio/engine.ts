'use client'

import { DEFAULT_CLIP_FX } from '@/types/arrangement'
import type { Arrangement, Clip, ClipFx } from '@/types/arrangement'

// Tone.Transport is the master clock for the whole workstation: clips and the
// metronome are both scheduled against it, so they cannot drift relative to
// each other. Each `play()` rebuilds the schedule from the arrangement —
// fine for the MVP since arrangements are small.

type ToneNS = typeof import('tone')

export type QuantizeStart = 'off' | 'bar' | 'beat'

interface LoopRegion {
  startSec: number
  endSec: number
}

interface ScheduledPlayer {
  player: import('tone').Player
  gain:   import('tone').Gain
  dryGain: import('tone').Gain
  wetGain: import('tone').Gain
  filter: import('tone').Filter
  drive: import('tone').Distortion
  delay: import('tone').FeedbackDelay
  reverb: import('tone').Reverb
  widener: import('tone').StereoWidener
  limiter: import('tone').Limiter
  clipId: string
  trackId: string
}

/** Per-track Web Audio nodes: gain node (for volume control + metering tap)
 *  and analyser node (AnalyserNode in waveform mode) reading RMS from it. */
interface TrackNode {
  trackGain: import('tone').Gain
  analyser:  import('tone').Analyser
}

let TonePromise: Promise<ToneNS> | null = null
function loadTone(): Promise<ToneNS> {
  if (!TonePromise) TonePromise = import('tone')
  return TonePromise
}

export class ArrangementPlayer {
  private Tone: ToneNS | null = null
  private master: import('tone').Gain | null = null
  private active: ScheduledPlayer[] = []
  private trackNodes = new Map<string, TrackNode>()
  private bufferCache = new Map<string, import('tone').ToneAudioBuffer>()
  private playing = false
  private endEventId: number | null = null
  private maxEndSec = 0
  private _onEnd?: () => void

  async init(): Promise<void> {
    if (this.Tone) return
    this.Tone = await loadTone()
    await this.Tone.start()
    this.master = new this.Tone.Gain(1).toDestination()
  }

  private async loadBuffer(url: string): Promise<import('tone').ToneAudioBuffer> {
    const cached = this.bufferCache.get(url)
    if (cached) return cached
    const Tone = this.Tone!
    const buf = await new Promise<import('tone').ToneAudioBuffer>((resolve, reject) => {
      const b = new Tone.ToneAudioBuffer(url, () => resolve(b), reject)
    })
    this.bufferCache.set(url, buf)
    return buf
  }

  private resolveUrl(clip: Clip, urlMap: Map<string, string>): string | null {
    return urlMap.get(clip.asset_ref) ?? null
  }

  async play(
    arrangement: Arrangement,
    urlMap: Map<string, string>,
    opts: { quantize?: QuantizeStart; loop?: LoopRegion } = {},
  ): Promise<void> {
    await this.init()
    const Tone = this.Tone!
    this.stop()

    // Master clock setup. Position reset to 0 so transport-relative clip
    // start times line up with the visual timeline (and the metronome).
    Tone.Transport.bpm.value = arrangement.bpm
    Tone.Transport.timeSignature = 4
    const loop = sanitizeLoop(opts.loop)
    Tone.Transport.loop = !!loop
    Tone.Transport.loopStart = loop?.startSec ?? 0
    Tone.Transport.loopEnd = loop?.endSec ?? 0
    Tone.Transport.position = loop?.startSec ?? 0

    const anySolo = arrangement.tracks.some((t) => t.solo)

    // Dispose any track nodes from a previous play() call (stop() also does
    // this, but cover the case where play() is called directly).
    this._disposeTrackNodes()

    // One Gain + Analyser node per audible track so:
    //   clip gain → track gain → analyser → master
    // The analyser is in the signal path (it passes audio through) and lets
    // getTrackLevel() read real-time RMS without React state per frame.
    for (const track of arrangement.tracks) {
      const trackGain = new Tone.Gain(effectiveTrackLinear(track.volume_db, track.mute, track.solo, anySolo))
      const analyser  = new Tone.Analyser('waveform', 256)
      trackGain.connect(analyser)
      analyser.connect(this.master!)
      this.trackNodes.set(track.id, { trackGain, analyser })
    }

    const players: ScheduledPlayer[] = []
    let maxEnd = 0

    for (const track of arrangement.tracks) {
      const trackNode = this.trackNodes.get(track.id)
      if (!trackNode) continue
      for (const clip of track.clips) {
        const url = this.resolveUrl(clip, urlMap)
        if (!url) continue
        let buf: import('tone').ToneAudioBuffer
        try {
          buf = await this.loadBuffer(url)
        } catch {
          continue
        }
        const fx = resolveClipFx(clip)
        const isEnabled = fx.enabled !== false
        const effectiveFx = isEnabled ? fx : { ...DEFAULT_CLIP_FX, enabled: false }
        const baseGain = computeClipGainLinear(clip, effectiveFx)
        const gain = new Tone.Gain(baseGain)
        const player = new Tone.Player(buf).connect(gain)
        const dryGain = new Tone.Gain(isEnabled ? 0 : 1)
        const wetGain = new Tone.Gain(isEnabled ? 1 : 0)

        // FX mapping: gain_db → Gain, attack/decay → Player fadeIn/fadeOut,
        // cutoff/resonance → Filter, drive → Distortion, delay → FeedbackDelay,
        // reverb → Reverb, stereo_width → StereoWidener, limiter → Limiter.
        const filter = new Tone.Filter({
          type: 'lowpass',
          frequency: clamp(effectiveFx.filter_cutoff_hz, 20, 20_000),
          Q: clamp(effectiveFx.resonance, 0, 1) * 24,
        })
        const drive = new Tone.Distortion(clamp(effectiveFx.drive, 0, 1))
        drive.oversample = '4x'
        drive.wet.value = clamp(effectiveFx.drive, 0, 1)
        const delay = new Tone.FeedbackDelay({
          delayTime: 0.03 + clamp(effectiveFx.delay, 0, 1) * 0.45,
          feedback: 0.15 + clamp(effectiveFx.delay, 0, 1) * 0.45,
          wet: clamp(effectiveFx.delay, 0, 1),
        })
        const reverb = new Tone.Reverb({
          decay: 0.4 + clamp(effectiveFx.reverb, 0, 1) * 3.2,
          preDelay: 0.01 + clamp(effectiveFx.reverb, 0, 1) * 0.03,
          wet: clamp(effectiveFx.reverb, 0, 1),
        })
        const widener = new Tone.StereoWidener(clamp(effectiveFx.stereo_width / 2, 0, 1))
        const limiter = new Tone.Limiter(clamp(effectiveFx.limiter_db, -24, 0))

        gain.connect(dryGain)
        dryGain.connect(trackNode.trackGain)

        gain.connect(filter)
        filter.connect(drive)
        drive.connect(delay)
        delay.connect(reverb)
        reverb.connect(widener)
        widener.connect(limiter)
        limiter.connect(wetGain)
        wetGain.connect(trackNode.trackGain)
        // time_stretch_ratio = (sourceLength / playbackLength). Tone.Player
        // exposes playbackRate which is sourceLength / playbackLength, so the
        // mapping is direct. Rate < 1 = slower (longer); rate > 1 = faster.
        const stretch = clip.time_stretch_ratio && clip.time_stretch_ratio > 0
          ? clip.time_stretch_ratio
          : 1
        const pitchRatio = Math.pow(2, (clip.pitch_semitones ?? 0) / 12)
        const playbackRate = stretch * pitchRatio
        try { player.playbackRate = playbackRate } catch {}
        const length = Math.max(0, clip.end_sec - clip.start_sec)
        const attackSec = clamp(effectiveFx.attack_ms / 1000, 0, Math.min(2, length * 0.95))
        const decaySec = clamp(effectiveFx.decay_ms / 1000, 0, Math.min(2.5, length))
        player.fadeIn = attackSec
        player.fadeOut = Math.min(decaySec, Math.max(0, length - attackSec))
        try {
          // sync() ties the player to Transport. start() is then interpreted
          // in transport-relative seconds — so clip.start_sec means the same
          // thing in audio that it means on the visual timeline.
          player.sync().start(clip.start_sec, clip.offset_sec, length)
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[engine] clip schedule failed', err)
          }
          continue
        }
        players.push({ player, gain, dryGain, wetGain, filter, drive, delay, reverb, widener, limiter, clipId: clip.id, trackId: track.id })
        maxEnd = Math.max(maxEnd, clip.start_sec + length)
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[engine] scheduled clip', {
            id: clip.id, startSec: clip.start_sec, offsetSec: clip.offset_sec,
            lengthSec: length, bpm: arrangement.bpm,
          })
        }
      }
    }

    this.active = players
    this.playing = true
    this.maxEndSec = maxEnd

    if (!loop) {
      this._scheduleEnd()
    }

    // Quantize: '@1m' = next bar boundary on Transport's grid; '@4n' = next
    // beat. With position reset to 0 the boundary is "now" so this matters
    // most for resume/seek-and-play flows we'll add later.
    const startWhen =
      opts.quantize === 'bar'  ? '@1m' :
      opts.quantize === 'beat' ? '@4n' :
      '+0.05'
    const startPos = loop?.startSec ?? 0
    Tone.Transport.start(startWhen, startPos)

    if (process.env.NODE_ENV !== 'production') {
      console.debug('[engine] transport started', {
        when: startWhen, bpm: arrangement.bpm, clips: players.length,
      })
    }
  }

  stop(): void {
    if (!this.Tone) return
    for (const { player, gain, dryGain, wetGain, filter, drive, delay, reverb, widener, limiter } of this.active) {
      try { player.unsync() } catch {}
      try { player.stop() } catch {}
      player.dispose()
      gain.dispose()
      dryGain.dispose()
      wetGain.dispose()
      try { filter.dispose() } catch {}
      try { drive.dispose() } catch {}
      try { delay.dispose() } catch {}
      try { reverb.dispose() } catch {}
      try { widener.dispose() } catch {}
      try { limiter.dispose() } catch {}
    }
    this.active = []
    this._disposeTrackNodes()
    this.playing = false
    this.maxEndSec = 0
    if (this.endEventId != null) {
      try { this.Tone.Transport.clear(this.endEventId) } catch {}
      this.endEventId = null
    }
    this.Tone.Transport.loop = false
    this.Tone.Transport.stop()
    this.Tone.Transport.cancel()
    this.Tone.Transport.position = 0
  }

  setLoopRegion(startSec: number, endSec: number): void {
    if (!this.Tone) return
    const loop = sanitizeLoop({ startSec, endSec })
    if (!loop) return
    if (this.endEventId != null) {
      try { this.Tone.Transport.clear(this.endEventId) } catch {}
      this.endEventId = null
    }
    this.Tone.Transport.loop = true
    this.Tone.Transport.loopStart = loop.startSec
    this.Tone.Transport.loopEnd = loop.endSec
    if (this.playing) {
      const pos = this.Tone.Transport.seconds
      if (pos < loop.startSec || pos >= loop.endSec) {
        this.Tone.Transport.seconds = loop.startSec
      }
    }
  }

  clearLoopRegion(): void {
    if (!this.Tone) return
    this.Tone.Transport.loop = false
    this.Tone.Transport.loopStart = 0
    this.Tone.Transport.loopEnd = 0
    if (this.playing) this._scheduleEnd()
  }

  private _disposeTrackNodes(): void {
    this.trackNodes.forEach(({ trackGain, analyser }) => {
      try { analyser.dispose() } catch {}
      try { trackGain.dispose() } catch {}
    })
    this.trackNodes.clear()
  }

  /** Read RMS level for a track from its Web Audio analyser.
   *  Returns 0 if the track is muted/not playing.
   *  Maps -60..0 dBFS → 0..1 for display. */
  getTrackLevel(trackId: string): number {
    const node = this.trackNodes.get(trackId)
    if (!node) return 0
    try {
      const raw     = node.analyser.getValue()
      const samples = Array.isArray(raw) ? raw[0] : raw as Float32Array
      if (!samples?.length) return 0
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
      const rms = Math.sqrt(sum / samples.length)
      if (rms < 1e-7) return 0
      // Map -60..0 dBFS → 0..1
      const db = 20 * Math.log10(rms)
      return Math.max(0, Math.min(1, (db + 60) / 60))
    } catch {
      return 0
    }
  }

  /** Smoothly ramp a track's gain node to a new volume while playing.
   *  Called by Workstation whenever the volume slider changes. */
  setTrackGain(trackId: string, volumeDb: number): void {
    const node = this.trackNodes.get(trackId)
    if (!node) return
    try {
      node.trackGain.gain.rampTo(dbToLinear(volumeDb), 0.02)
    } catch {
      // rampTo may throw if AudioContext is suspended; silently ignore.
    }
  }

  /** Sync mute/solo/volume for every track without restarting transport. */
  syncTrackMix(tracks: Pick<Arrangement['tracks'][number], 'id' | 'volume_db' | 'mute' | 'solo'>[]): void {
    const anySolo = tracks.some((t) => t.solo)
    for (const track of tracks) {
      const node = this.trackNodes.get(track.id)
      if (!node) continue
      const target = effectiveTrackLinear(track.volume_db, !!track.mute, !!track.solo, anySolo)
      try {
        node.trackGain.gain.rampTo(target, 0.01)
      } catch {}
    }
  }

  /** Live-sync clip FX (gain/filter/drive/pitch/envelope) while playing. */
  syncClipFx(tracks: Arrangement['tracks']): void {
    const byId = new Map<string, Clip>()
    for (const t of tracks) {
      for (const c of t.clips) byId.set(c.id, c)
    }
    for (const entry of this.active) {
      const clip = byId.get(entry.clipId)
      if (!clip) continue
      const fx = resolveClipFx(clip)
      const isEnabled = fx.enabled !== false
      const effectiveFx = isEnabled ? fx : { ...DEFAULT_CLIP_FX, enabled: false }
      const gain = computeClipGainLinear(clip, effectiveFx)
      try { entry.gain.gain.rampTo(gain, 0.02) } catch {}
      try {
        entry.dryGain.gain.rampTo(isEnabled ? 0 : 1, 0.01)
        entry.wetGain.gain.rampTo(isEnabled ? 1 : 0, 0.01)
      } catch {}
      try {
        entry.filter.frequency.rampTo(clamp(fx.filter_cutoff_hz, 20, 20_000), 0.02)
        entry.filter.Q.rampTo(clamp(fx.resonance, 0, 1) * 24, 0.02)
      } catch {}
      try {
        entry.drive.distortion = clamp(fx.drive, 0, 1)
        entry.drive.wet.rampTo(clamp(fx.drive, 0, 1), 0.02)
      } catch {}
      try {
        entry.delay.delayTime.rampTo(0.03 + clamp(fx.delay, 0, 1) * 0.45, 0.02)
        entry.delay.feedback.rampTo(0.15 + clamp(fx.delay, 0, 1) * 0.45, 0.02)
        entry.delay.wet.rampTo(clamp(fx.delay, 0, 1), 0.02)
      } catch {}
      try {
        entry.reverb.decay = 0.4 + clamp(fx.reverb, 0, 1) * 3.2
        entry.reverb.preDelay = 0.01 + clamp(fx.reverb, 0, 1) * 0.03
        entry.reverb.wet.rampTo(clamp(fx.reverb, 0, 1), 0.02)
      } catch {}
      try {
        entry.widener.width.value = clamp(fx.stereo_width / 2, 0, 1)
      } catch {}
      try {
        entry.limiter.threshold.value = clamp(fx.limiter_db, -24, 0)
      } catch {}
      const stretch = clip.time_stretch_ratio && clip.time_stretch_ratio > 0
        ? clip.time_stretch_ratio
        : 1
      const pitchRatio = Math.pow(2, (clip.pitch_semitones ?? 0) / 12)
      const playbackRate = stretch * pitchRatio
      try { entry.player.playbackRate = playbackRate } catch {}
      const length = Math.max(0, clip.end_sec - clip.start_sec)
      const attackSec = clamp(effectiveFx.attack_ms / 1000, 0, Math.min(2, length * 0.95))
      const decaySec = clamp(effectiveFx.decay_ms / 1000, 0, Math.min(2.5, length))
      entry.player.fadeIn = attackSec
      entry.player.fadeOut = Math.min(decaySec, Math.max(0, length - attackSec))
    }
  }

  /** Update master BPM live without breaking the schedule. */
  setBpm(bpm: number): void {
    if (this.Tone) this.Tone.Transport.bpm.value = bpm
  }

  isPlaying(): boolean { return this.playing }

  /** Move the transport position while keeping playback running. */
  seek(sec: number): void {
    if (!this.Tone) return
    const target = Math.max(0, sec)
    this.Tone.Transport.seconds = target
  }

  /** Transport position in seconds. The single source of truth for the
   *  playhead — bar/beat counter and metronome read off the same clock. */
  getElapsed(): number {
    if (!this.playing || !this.Tone) return 0
    return Math.max(0, this.Tone.Transport.seconds)
  }

  onEnd(cb: () => void): void { this._onEnd = cb }

  private _scheduleEnd(): void {
    if (!this.Tone || !this.playing || this.maxEndSec <= 0) return
    const now = this.Tone.Transport.seconds
    if (now >= this.maxEndSec) {
      this.stop()
      this._onEnd?.()
      return
    }
    this.endEventId = this.Tone.Transport.scheduleOnce(() => {
      if (this.playing) {
        this.stop()
        this._onEnd?.()
      }
    }, this.maxEndSec + 0.2)
  }

  dispose(): void {
    this.stop()
    this.master?.dispose()
    this.master = null
    this.bufferCache.forEach((b) => b.dispose())
    this.bufferCache.clear()
  }
}

function sanitizeLoop(loop?: LoopRegion | null): LoopRegion | null {
  if (!loop) return null
  const startSec = Math.max(0, loop.startSec)
  const endSec = Math.max(startSec + 0.01, loop.endSec)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null
  return { startSec, endSec }
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

function computeClipGainLinear(clip: Clip, fx: ClipFx): number {
  const punchBoost = 1 + clamp(fx.transient_punch, 0, 1) * 0.35
  return dbToLinear(clip.gain_db) * punchBoost
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function resolveClipFx(clip: Clip): ClipFx {
  const fx = clip.fx ?? {}
  return { ...DEFAULT_CLIP_FX, ...fx, enabled: (clip.fx?.enabled ?? true) }
}

function effectiveTrackLinear(volumeDb: number, mute: boolean, solo: boolean, anySolo: boolean): number {
  if (anySolo) return solo ? dbToLinear(volumeDb) : 0
  return mute ? 0 : dbToLinear(volumeDb)
}
