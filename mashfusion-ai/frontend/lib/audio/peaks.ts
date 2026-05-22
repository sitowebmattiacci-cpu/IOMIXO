'use client'

// Multi-tier peak data, cached per URL. Generated once at decode time, then
// reused for every zoom level forever.
//
// Each tier is an array of (min, max) pairs at a fixed block size (samples
// per bucket). The renderer picks the tier whose bucket-in-display-pixels
// is just under 1 — that guarantees every backing-pixel column gets its
// own peak value (no plateau, no stair-step), without forcing the renderer
// to scan millions of samples per frame.
//
// Tiers (block size doubles each step ×8 to keep total memory low):
//   T0:    32 samples / bucket — ultra (≈0.73ms @ 44.1kHz, sample-grade)
//   T1:   256 samples / bucket — high
//   T2:  2048 samples / bucket — medium
//   T3: 16384 samples / bucket — overview
//
// For a 5-min mono stem @ 44.1kHz (13.2M samples), total cache cost is
// ~3.8 MB per asset — held in memory for the session, never recomputed.

const TIER_BLOCKS = [32, 256, 2048, 16384] as const

export interface PeakTier {
  /** samples per bucket */
  block: number
  min:   Float32Array
  max:   Float32Array
}

export interface PeaksData {
  tiers:       PeakTier[]
  sampleRate:  number
  durationSec: number
}

let _ctx: AudioContext | null = null
function getContext(): AudioContext {
  if (_ctx) return _ctx
  const Ctor: typeof AudioContext =
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? window.AudioContext
  _ctx = new Ctor()
  return _ctx
}

const cache = new Map<string, Promise<PeaksData>>()

export function getPeaks(url: string): Promise<PeaksData> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  const cached = cache.get(url)
  if (cached) return cached
  const p = decodePeaks(url).catch((err) => {
    cache.delete(url)
    throw err
  })
  cache.set(url, p)
  return p
}

async function decodePeaks(url: string): Promise<PeaksData> {
  const ac   = getContext()
  const resp = await fetch(url, { credentials: 'omit' })
  if (!resp.ok) throw new Error(`fetch ${resp.status}`)
  const buf  = await ac.decodeAudioData(await resp.arrayBuffer())

  const samples = buf.numberOfChannels > 1 ? mixToMono(buf) : buf.getChannelData(0)
  const N       = samples.length

  // Build the finest tier (T0) directly from samples; build each coarser
  // tier from the previous one — collapsing 8 buckets into 1. This makes
  // tier construction O(N + N/64 + N/512 + …) ≈ O(N), one full pass.
  //
  // No global normalisation: peaks stay in their native [-1, 1] range so
  // the renderer's per-clip normalisation has accurate dynamics to work
  // with. Pre-normalising at the source flattens the relative loudness of
  // every clip and forces the renderer to choose between "always max" or
  // "always quiet" — neither of which behaves like a real DAW.
  const tiers: PeakTier[] = []

  {
    const block = TIER_BLOCKS[0]
    const len   = Math.max(1, Math.ceil(N / block))
    const min   = new Float32Array(len)
    const max   = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const s = i * block
      const e = Math.min(N, s + block)
      let lo = 0, hi = 0
      for (let j = s; j < e; j++) {
        const v = samples[j]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      min[i] = lo
      max[i] = hi
    }
    tiers.push({ block, min, max })
  }

  // Coarser tiers: collapse the previous tier 8 → 1.
  for (let t = 1; t < TIER_BLOCKS.length; t++) {
    const block  = TIER_BLOCKS[t]
    const prev   = tiers[t - 1]
    const ratio  = block / prev.block       // 8
    const len    = Math.max(1, Math.ceil(prev.min.length / ratio))
    const min    = new Float32Array(len)
    const max    = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      const s = i * ratio
      const e = Math.min(prev.min.length, s + ratio)
      let lo = prev.min[s] ?? 0
      let hi = prev.max[s] ?? 0
      for (let j = s + 1; j < e; j++) {
        const v1 = prev.min[j]; if (v1 < lo) lo = v1
        const v2 = prev.max[j]; if (v2 > hi) hi = v2
      }
      min[i] = lo
      max[i] = hi
    }
    tiers.push({ block, min, max })
  }

  return { tiers, sampleRate: buf.sampleRate, durationSec: buf.duration }
}

function mixToMono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < ch.length; i++) out[i] += ch[i]
  }
  const inv = 1 / buf.numberOfChannels
  for (let i = 0; i < out.length; i++) out[i] *= inv
  return out
}

/**
 * Resolve a [startSec, endSec] window to per-column min/max arrays at
 * `cols` length, picking the right LOD tier for the current zoom.
 *
 * Tier selection rule: pick the FINEST tier (smallest block) whose bucket
 * width in display pixels is ≤ 1. That guarantees every column has its own
 * bucket — no plateau, no stair-step — while never wasting work on a tier
 * finer than the eye can resolve at this zoom.
 *
 * If even the finest tier still has buckets coarser than a column (extreme
 * zoom on a short clip), we LINEARLY INTERPOLATE between adjacent buckets
 * so the path stays smooth instead of stepping.
 */
export function sliceMinMax(
  data:     PeaksData,
  startSec: number,
  endSec:   number,
  cols:     number,
): { min: Float32Array; max: Float32Array } {
  const out = { min: new Float32Array(cols), max: new Float32Array(cols) }
  if (cols <= 0 || data.durationSec <= 0) return out

  const total  = data.durationSec
  const fStart = Math.max(0, Math.min(1, startSec / total))
  const fEnd   = Math.max(fStart, Math.min(1, endSec / total))
  const span   = fEnd - fStart
  if (span <= 0) return out

  const spanSec        = span * total
  const samplesPerCol  = (spanSec * data.sampleRate) / cols

  // Always prefer the FINEST tier whose block fits in ≤ samplesPerCol.
  // Coarser tiers are kept around for the (extremely rare) case where the
  // finest tier still has more buckets than we need; in practice T0 is
  // always selected at typical zoom levels — that's exactly what gives
  // timeline clips their high-definition look.
  let tier = data.tiers[0]
  for (let i = 0; i < data.tiers.length; i++) {
    if (data.tiers[i].block <= samplesPerCol) { tier = data.tiers[i]; break }
  }

  const src      = tier.max
  const srcMin   = tier.min
  const len      = src.length
  const idxStart = fStart * len
  const idxEnd   = fEnd   * len
  const stepSrc  = (idxEnd - idxStart) / cols

  if (stepSrc >= 1) {
    // Aggregate every bucket whose centre falls in [a, b). Using ceil(b)-1
    // for the upper end means adjacent columns cover contiguous bucket
    // ranges with no gaps and ≤1 bucket overlap — important when stepSrc
    // is fractional (e.g. 1.3) and naive Math.floor(b) would alternately
    // sample 1 or 2 buckets per column, producing a jagged envelope.
    for (let i = 0; i < cols; i++) {
      const a  = idxStart + i * stepSrc
      const b  = a + stepSrc
      const lo = Math.min(len - 1, Math.floor(a))
      const hi = Math.min(len - 1, Math.max(lo, Math.ceil(b) - 1))
      let mn = srcMin[lo]
      let mx = src[lo]
      for (let j = lo + 1; j <= hi; j++) {
        const v1 = srcMin[j]; if (v1 < mn) mn = v1
        const v2 = src[j];    if (v2 > mx) mx = v2
      }
      out.min[i] = mn
      out.max[i] = mx
    }
  } else {
    for (let i = 0; i < cols; i++) {
      const f  = idxStart + i * stepSrc
      const lo = Math.floor(f)
      const hi = Math.min(len - 1, lo + 1)
      const t  = f - lo
      out.min[i] = srcMin[lo] * (1 - t) + srcMin[hi] * t
      out.max[i] = src[lo]    * (1 - t) + src[hi]    * t
    }
  }
  return out
}
