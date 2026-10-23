'use client'
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { animate, cubicBezier, motion, useInView, useMotionValue, useSpring, useTransform, type AnimationPlaybackControls, type MotionValue } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { Camera } from 'lucide-react'
import { formatWeddingGuestDate } from '@/components/wedding/guest/WeddingGuestUI'
import { useI18n } from '@/lib/i18n'
import { DEMO_EVENT, HERO_EXTRAS } from '@/lib/miolove/demoMedia'
import { PORTAL_CONFIG } from '@/lib/portal'
import { DemoPhotoImg, PhoneMock } from './parts'

/**
 * Hero motion for the MIOLOVE home. The markup, classes, sizes and final positions are exactly the static hero's: every animated element sits in
 * a static positioning wrapper (so the Tailwind rotations / translate classes are never overridden by Framer's inline transform) and only
 * `transform` + `opacity` change. Server HTML carries the final copy; the hidden start state only lasts until hydration (a <noscript> rule in the
 * hero shows everything without JS).
 */

const EASE_OUT = [0.22, 1, 0.36, 1] as const
const REDUCE_Q = '(prefers-reduced-motion: reduce)'
const DESKTOP_Q = '(min-width: 1024px)'
const POINTER_Q = '(min-width: 1024px) and (hover: hover) and (pointer: fine)'

/** Left-column copy: fade + short rise, staggered by `delay` (seconds). Instant under prefers-reduced-motion. */
type RevealTag = 'h1' | 'p' | 'div'
const REVEAL = { h1: motion.h1, p: motion.p, div: motion.div } as const
export function Reveal({ as = 'div', delay = 0, ...rest }: { as?: RevealTag; delay?: number } & ComponentProps<typeof motion.div>) {
  const C = REVEAL[as] as typeof motion.div
  const reduce = useReducedMotionFlag()
  return (
    <C data-hero-in initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.7, delay, ease: EASE_OUT }} {...rest} />
  )
}

/** SSR-safe `prefers-reduced-motion` (false on the server and during hydration, then the real value). */
function useReducedMotionFlag() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(REDUCE_Q)
    const sync = () => setReduce(mq.matches)
    sync(); mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduce
}

type LayerInit = Partial<Record<'x' | 'y' | 'scale' | 'opacity' | 'rotate' | 'rotateX' | 'rotateY', number>>
const LAYER_REST = { x: 0, y: 0, scale: 1, opacity: 1, rotate: 0, rotateX: 0, rotateY: 0 }
/** Entry layer: the motion values that carry the (hidden) start state and later the entry / flight. */
function useLayer(init: LayerInit) {
  const start = { ...LAYER_REST, ...init }
  return {
    start,
    x: useMotionValue(start.x), y: useMotionValue(start.y), scale: useMotionValue(start.scale), opacity: useMotionValue(start.opacity),
    rotate: useMotionValue(start.rotate), rotateX: useMotionValue(start.rotateX), rotateY: useMotionValue(start.rotateY),
  }
}
type Layer = ReturnType<typeof useLayer>
const layerStyle = (l: Layer) => ({ x: l.x, y: l.y, scale: l.scale, opacity: l.opacity, rotate: l.rotate, rotateX: l.rotateX, rotateY: l.rotateY })
const resetLayer = (l: Layer) => (Object.keys(LAYER_REST) as (keyof typeof LAYER_REST)[]).forEach((k) => l[k].set(l.start[k]))
const restLayer = (l: Layer) => (Object.keys(LAYER_REST) as (keyof typeof LAYER_REST)[]).forEach((k) => l[k].set(LAYER_REST[k]))

/** Float layer: the slow idle drift (fy / fr) plus the desktop pointer parallax, summed into one transform. */
function useFloat(mx: MotionValue<number>, my: MotionValue<number>, depth: number) {
  const fy = useMotionValue(0)
  const fr = useMotionValue(0)
  const frx = useMotionValue(0)   // idle 3D tilt (phone only; the photos only use fr)
  const fry = useMotionValue(0)
  const x = useTransform(mx, (v) => v * depth)
  const y = useTransform([fy, my], ([a, b]: number[]) => a + b * depth)
  return { fy, fr, frx, fry, style: { x, y, rotate: fr, rotateX: frx, rotateY: fry } }
}

/** Layout effect in the browser (runs before the first paint, also when React re-runs it), plain effect on the server (no SSR warning). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const done = (c: AnimationPlaybackControls) => new Promise<void>((r) => c.then(() => r(), () => r()))

export function HeroVisual() {
  const { t, locale } = useI18n()
  const root = useRef<HTMLDivElement>(null)
  const phoneEl = useRef<HTMLDivElement>(null)
  const photoEl = useRef<HTMLDivElement>(null)
  const inView = useInView(root, { amount: 0.05 })
  const inViewRef = useRef(false)
  inViewRef.current = inView
  const idle = useRef<AnimationPlaybackControls[]>([])
  const settled = useRef(false)

  const mx = useSpring(0, { stiffness: 70, damping: 18, mass: 0.6 })
  const my = useSpring(0, { stiffness: 70, damping: 18, mass: 0.6 })
  const perspective = useMotionValue(900)   // 0 = no perspective() in the transform, so the reduced-motion state is the untouched static hero
  const phone = useLayer({ opacity: 0, y: 36, scale: 0.7, rotateX: 10, rotateY: -38 })   // fully invisible (still loaded/preloaded) until its entrance
  const photo1 = useLayer({ opacity: 0, y: 26, scale: 0.88, rotate: -9 })
  const photo2 = useLayer({ opacity: 0, y: 26, scale: 0.88, rotate: 9 })
  const qr = useLayer({ opacity: 0, y: 14, scale: 0.78 })
  const note = useLayer({ opacity: 0, y: 10, scale: 0.86, x: 10 })
  const phoneF = useFloat(mx, my, 6)
  const photo1F = useFloat(mx, my, 14)
  const photo2F = useFloat(mx, my, 12)
  const qrF = useFloat(mx, my, 10)
  const noteF = useFloat(mx, my, 8)

  // Pause the endless idle drift while the hero is off screen (and resume when it is back).
  useEffect(() => { idle.current.forEach((c) => (inView ? c.play() : c.pause())) }, [inView])

  // Before the first paint the layers are put (back) in their start pose, so a re-run never shows the finished composition for a frame.
  useIsoLayoutEffect(() => {
    let cancelled = false
    let cancel!: () => void
    const cancelled$ = new Promise<void>((r) => { cancel = r })
    const running: AnimationPlaybackControls[] = []
    // Every animation's completion promise is created the moment the animation starts: in Framer Motion 11.18 a `.then()` attached to an animation
    // that already finished never resolves, so nothing here ever awaits a finished animation. `until` also settles on unmount (no dangling waits).
    const run = (c: AnimationPlaybackControls): Promise<void> => { running.push(c); return done(c) }
    const until = (ps: Promise<unknown>[]) => Promise.race([Promise.all(ps), cancelled$])
    const sleep = (ms: number) => until([wait(ms)])
    const layers = [phone, photo1, photo2, qr, note]
    const reduceMq = window.matchMedia(REDUCE_Q)
    const compact = !window.matchMedia(DESKTOP_Q).matches
    const pointerFine = window.matchMedia(POINTER_Q).matches
    settled.current = false
    layers.forEach(resetLayer)
    perspective.set(900)

    const stopAll = () => { cancel(); running.forEach((c) => c.stop()); idle.current.forEach((c) => c.stop()); idle.current = [] }
    const showAll = () => { layers.forEach(restLayer); perspective.set(0); settled.current = true }
    if (reduceMq.matches) { showAll(); return }
    const onReduce = () => { if (reduceMq.matches) { cancelled = true; stopAll(); mx.set(0); my.set(0); showAll() } }
    reduceMq.addEventListener('change', onReduce)

    // Simpler, smaller motion on mobile: no 3D tilt, a gentler rise + scale.
    if (compact) { phone.rotateX.set(0); phone.rotateY.set(0); phone.scale.set(0.88); phone.y.set(22) }

    const idleDrift = (v: MotionValue<number>, keyframes: number[], duration: number) => {
      const c = animate(v, keyframes, { duration, repeat: Infinity, ease: 'easeInOut' })
      if (!inViewRef.current) c.pause()
      idle.current.push(c)
    }
    // Phone idle: 9 px bob and a ±4° / ±2.5° 3D sway on slow cycles (6–7 s) that are never in sync. Mobile: a small 4 px bob, no tilt.
    const startPhoneIdle = () => {
      idleDrift(phoneF.fy, [0, compact ? -4 : -9, 0], 6.5)
      if (!compact) { idleDrift(phoneF.fry, [0, 4, 0, -4, 0], 7); idleDrift(phoneF.frx, [0, 2.5, 0, -2.5, 0], 6) }
    }
    const startPhotoIdle = () => {
      idleDrift(photo1F.fy, [0, -6, 0], 4.4); idleDrift(photo1F.fr, [0, 1.4, 0], 5.2)
      idleDrift(photo2F.fy, [0, -7, 0], 5); idleDrift(photo2F.fr, [0, -1.4, 0], 4.6)
    }

    /**
     * Fly the side photo into the gallery thumbnail. The destination is re-read from the real thumbnail on every frame, so it stays exact while the
     * phone is already breathing (idle). Resolves false when the geometry can't be trusted (the card then simply stays where it is).
     */
    const flyIntoPhone = async (): Promise<boolean> => {
      const frame = photoEl.current
      const img = frame?.querySelector('img')
      const thumbs = phoneEl.current?.querySelectorAll<HTMLElement>('.grid img')
      const thumb = thumbs && thumbs[thumbs.length - 1]
      const rootEl = root.current
      if (!frame || !img || !thumb || !rootEl) return false
      const f = frame.getBoundingClientRect()
      if (!(f.width > 0 && img.offsetWidth > 0 && thumb.getBoundingClientRect().width > 0)) return false
      const imgW = img.offsetWidth   // unrotated layout width of the picture
      // Picture centre relative to the frame centre when the frame is not rotated (layout based, so rotation-free).
      const vx = img.offsetLeft + img.offsetWidth / 2 - frame.offsetWidth / 2
      const vy = img.offsetTop + img.offsetHeight / 2 - frame.offsetHeight / 2
      // Frame centre with no translation applied (scale / rotation turn around the centre, so they don't move it); scroll is tracked per frame.
      const x0 = photo2.x.get(), y0 = photo2.y.get(), sx0 = window.scrollX, sy0 = window.scrollY
      const restX = f.left + f.width / 2 - x0, restY = f.top + f.height / 2 - y0
      const target = () => {
        const tb = thumb.getBoundingClientRect()
        const s = tb.width / imgW
        return { s, x: tb.left + tb.width / 2 - s * vx - (restX - (window.scrollX - sx0)), y: tb.top + tb.height / 2 - s * vy - (restY - (window.scrollY - sy0)) }
      }
      const t0 = target()
      const r = rootEl.getBoundingClientRect()
      if (![t0.s, t0.x, t0.y].every(Number.isFinite) || t0.s < 0.15 || t0.s > 1.5 || Math.hypot(t0.x - x0, t0.y - y0) > Math.max(r.width, r.height) * 1.2) return false
      const eX = cubicBezier(0.3, 0, 0.2, 1), eY = cubicBezier(0.55, 0, 0.35, 1), e = cubicBezier(0.45, 0, 0.2, 1)
      const lerp = (a: number, b: number, k: number) => a + (b - a) * k
      const flight = animate(0, 1, {
        duration: 1, ease: 'linear',
        onUpdate: (p) => {
          const t = target()
          photo2.x.set(lerp(x0, t.x, eX(p)))
          photo2.y.set(lerp(y0, t.y, eY(p)))
          photo2.scale.set(p < 0.22 ? lerp(1, 1.1, e(p / 0.22)) : lerp(1.1, t.s, e((p - 0.22) / 0.78)))
          photo2.rotate.set(lerp(0, -6, e(p)))   // cancels the card's own 6° so it lands flat on the thumbnail
          photo2.opacity.set(p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3)
        },
      })
      await until([run(flight)])
      if (cancelled) return true
      // The gallery "receives" it: the thumbnail gives a small pop (WAAPI, transform only, leaves no inline style behind).
      thumb.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' })
      return true
    }

    ;(async () => {
      // Cinematic phone entrance: it comes toward the viewer while straightening, one soft ease (no overshoot), ~1.8 s (1.1 s on mobile).
      const cascade = { duration: compact ? 1.1 : 1.8, delay: 0.4, ease: [0.37, 0, 0.18, 1] as const }
      const entry = [
        animate(phone.opacity, 1, { duration: 0.25, delay: 0.4, ease: 'easeOut' }),   // appears from nothing after ~400 ms, as the 3D move begins
        animate(phone.y, 0, cascade),
        animate(phone.scale, 1, cascade),
        animate(phone.rotateX, 0, cascade),
        animate(phone.rotateY, 0, cascade),
        ...[[photo1, 0.55], [photo2, 0.7]].flatMap(([l, d]) => {
          const L = l as Layer, delay = d as number
          return [
            animate(L.opacity, 1, { duration: 0.6, delay }),
            animate(L.y, 0, { duration: 0.8, delay, ease: EASE_OUT }),
            animate(L.scale, 1, { duration: 0.8, delay, ease: EASE_OUT }),
            animate(L.rotate, 0, { duration: 0.8, delay, ease: EASE_OUT }),
          ]
        }),
        animate(qr.opacity, 1, { duration: 0.35, delay: 0.9 }),
        animate(qr.y, 0, { duration: 0.6, delay: 0.9, ease: EASE_OUT }),
        animate(qr.scale, 1, { type: 'spring', stiffness: 240, damping: 14, delay: 0.9 }),   // soft pop
      ]
      await until(entry.map(run))
      if (cancelled) return
      startPhoneIdle()   // the phone starts breathing right away; the rest of the choreography doesn't wait for it nor is it disturbed by it
      await sleep(250)
      if (cancelled) return

      const flew = await flyIntoPhone().catch(() => false)
      if (cancelled) return

      // "Nuova foto nell'album": right after the picture lands (not awaited: it must not hold the rest back).
      ;[
        animate(note.opacity, 1, { duration: 0.3 }),
        animate(note.y, 0, { duration: 0.5, ease: EASE_OUT }),
        animate(note.x, 0, { duration: 0.5, ease: EASE_OUT }),
        animate(note.scale, 1, { type: 'spring', stiffness: 320, damping: 16 }),
      ].forEach(run)
      if (flew) {
        // The card is back in its place as the next guest photo (hidden jump, then a soft fade-in); the final layout is the static one.
        await sleep(700)
        if (cancelled) return
        photo2.x.set(0); photo2.y.set(0); photo2.rotate.set(0); photo2.scale.set(0.9)
        await until([run(animate(photo2.opacity, 1, { duration: 0.6 })), run(animate(photo2.scale, 1, { duration: 0.7, ease: EASE_OUT }))])
      } else {
        photo2.opacity.set(1)   // geometry not reliable on this size: no flight, the card stays in place
      }
      if (cancelled) return
      startPhotoIdle()
      settled.current = true   // pointer parallax from here on
    })()

    const onMove = (e: PointerEvent) => {
      if (!settled.current || !inViewRef.current) return
      mx.set((e.clientX / window.innerWidth - 0.5) * 2)
      my.set((e.clientY / window.innerHeight - 0.5) * 2)
    }
    if (pointerFine) window.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      cancelled = true
      reduceMq.removeEventListener('change', onReduce)
      window.removeEventListener('pointermove', onMove)
      stopAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={root} className="relative mx-auto h-[420px] w-full max-w-[420px] sm:h-[500px]" data-testid="hero-visual">
      <div className="absolute left-1/2 top-0 w-[210px] -translate-x-1/2 sm:w-[250px]">
        <motion.div data-hero-in style={{ ...layerStyle(phone), transformPerspective: perspective }}>
          <motion.div ref={phoneEl} data-hero-in style={{ ...phoneF.style, transformPerspective: perspective }}>
            <PhoneMock title={t(DEMO_EVENT.titleKey)} date={formatWeddingGuestDate(DEMO_EVENT.date, locale) ?? ''} cta={t('home.preview.cta')} />
          </motion.div>
        </motion.div>
      </div>
      <div className="absolute bottom-6 left-0 w-[132px] sm:bottom-10 sm:w-[156px]">
        <motion.div data-hero-in style={layerStyle(qr)}>
          <motion.div style={qrF.style}>
            <div className="-rotate-6 rounded-3xl border border-wd-border bg-white p-3 shadow-[0_18px_40px_rgba(31,32,40,0.14)]">
              <QRCodeSVG value={PORTAL_CONFIG.miolove.baseUrl} size={120} level="M" className="h-auto w-full" />
              <p className="mt-2 text-center text-[11px] font-semibold text-wd-ink">{t('home.hero.qrLabel')}</p>
            </div>
          </motion.div>
        </motion.div>
      </div>
      <div className="absolute right-0 top-10 sm:top-16">
        <motion.div data-hero-in style={layerStyle(note)}>
          <motion.div style={noteF.style}>
            <div className="flex items-center gap-2 rounded-2xl border border-wd-border bg-white px-3 py-2 shadow-[0_14px_30px_rgba(31,32,40,0.12)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-wd-active text-wd-pink"><Camera className="h-4 w-4" /></span>
              <span className="text-[12px] font-semibold text-wd-ink">{t('home.hero.newPhoto')}</span>
            </div>
          </motion.div>
        </motion.div>
      </div>
      <div className="absolute -left-1 top-24 w-[68px] sm:w-[84px]">
        <motion.div data-hero-in style={layerStyle(photo1)}>
          <motion.div style={photo1F.style}>
            <div className="-rotate-12 rounded-lg bg-white p-1 pb-3 shadow-lg"><DemoPhotoImg photo={HERO_EXTRAS[0]} className="aspect-[4/5] w-full rounded" sizes="90px" /></div>
          </motion.div>
        </motion.div>
      </div>
      <div className="absolute bottom-24 right-0 w-[84px] sm:bottom-28 sm:w-[100px]">
        <motion.div data-hero-in style={layerStyle(photo2)}>
          <motion.div style={photo2F.style}>
            <div ref={photoEl} className="relative rotate-6 rounded-lg bg-white p-1 pb-3 shadow-lg"><DemoPhotoImg photo={HERO_EXTRAS[1]} className="aspect-square w-full rounded" sizes="100px" /></div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
