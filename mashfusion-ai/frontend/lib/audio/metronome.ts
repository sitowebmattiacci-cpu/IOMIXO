'use client'

/**
 * Synthetic metronome scheduled on Tone.Transport — the SAME clock the
 * arrangement player uses for clips. This is the whole point: clicks and
 * audio cannot drift relative to each other because there is only one clock.
 *
 * The click itself is a short oscillator burst rendered via Tone's underlying
 * Web Audio context (no audio file). Bar 1 gets a higher-pitched accent.
 */

type ToneNS = typeof import('tone')

let TonePromise: Promise<ToneNS> | null = null
function loadTone(): Promise<ToneNS> {
  if (!TonePromise) TonePromise = import('tone')
  return TonePromise
}

const BEATS_PER_BAR = 4

export class Metronome {
  private Tone: ToneNS | null = null
  private eventId: number | null = null
  private running = false
  private bpm = 120
  private beatInBar = 0

  /** Start (or restart) the click. The bpm passed must match the project
   *  bpm — we set Transport.bpm here too so the metronome works even when
   *  it's started before any clip play() has run. */
  async start(bpm: number): Promise<void> {
    this.bpm = Math.max(20, Math.min(300, bpm))
    if (typeof window === 'undefined') return
    if (!this.Tone) {
      this.Tone = await loadTone()
      await this.Tone.start()
    }
    const Tone = this.Tone
    this.stop()
    Tone.Transport.bpm.value = this.bpm
    this.beatInBar = 0
    this.eventId = Tone.Transport.scheduleRepeat((time) => {
      this.click(time, this.beatInBar === 0)
      this.beatInBar = (this.beatInBar + 1) % BEATS_PER_BAR
    }, '4n', 0)
    this.running = true

    // If transport isn't running yet (user toggled metronome before pressing
    // play), start it so they hear the click.
    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start('+0.05', 0)
    }
  }

  stop(): void {
    if (this.Tone && this.eventId != null) {
      try { this.Tone.Transport.clear(this.eventId) } catch {}
      this.eventId = null
    }
    this.running = false
  }

  /** Update BPM live. Transport is shared, so changing it here updates the
   *  arrangement player's clock too — which is exactly what we want. */
  setBpm(bpm: number): void {
    this.bpm = Math.max(20, Math.min(300, bpm))
    if (this.Tone) this.Tone.Transport.bpm.value = this.bpm
  }

  isRunning(): boolean { return this.running }

  /** Bar/beat read off Transport.position so the readout cannot disagree
   *  with the audible click. */
  getCurrentBeat(): { bar: number; beat: number } | null {
    if (!this.Tone || !this.running) return null
    const pos = String(this.Tone.Transport.position)
    const [bar, beat] = pos.split(':').map((p) => parseInt(p, 10) || 0)
    return { bar: bar + 1, beat: beat + 1 }
  }

  dispose(): void {
    this.stop()
  }

  private click(time: number, accent: boolean): void {
    if (!this.Tone) return
    const ctx = this.Tone.getContext().rawContext as unknown as AudioContext
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type        = 'square'
    osc.frequency.value = accent ? 1800 : 1100
    const peak = accent ? 0.18 : 0.10
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.001)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.060)
    osc.connect(gain).connect(ctx.destination)
    osc.start(time)
    osc.stop(time + 0.07)
  }
}
