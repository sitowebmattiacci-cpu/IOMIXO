'use client'
import { useEffect, useRef } from 'react'
import { MAX_VIDEO_SCREEN_MS } from '@/lib/useSlideshow'

/** No frame progress for this long while the video should be playing (network hiccup, undecodable file): move on instead of freezing the screen. */
const STALL_MS = 15_000

/**
 * A video as a slideshow slide (TV / LED wall / projector). It plays ONCE, then calls `onDone` so the slideshow moves to the next content: ended, error,
 * a stall, or the screen cap (MAX_VIDEO_SCREEN_MS) — never an endless loop. It starts MUTED: browsers only allow autoplay without sound, and a TV has nobody
 * to tap "unmute". The original file (with its sound) stays downloadable by the owner.
 */
export function SlideVideo({ src, poster, onDone, className = '' }: { src: string; poster?: string | null; onDone: () => void; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const v = ref.current; if (!v) return
    let finished = false
    const finish = () => { if (!finished) { finished = true; done.current() } }
    const cap = setTimeout(finish, MAX_VIDEO_SCREEN_MS)
    let last = Date.now(), lastT = -1
    const watchdog = setInterval(() => {
      if (v.currentTime !== lastT) { lastT = v.currentTime; last = Date.now() }
      else if (Date.now() - last > STALL_MS) finish()
    }, 2000)
    v.muted = true
    v.play().catch(() => { /* autoplay refused: the watchdog moves on */ })
    return () => { finished = true; clearTimeout(cap); clearInterval(watchdog) }
  }, [src])
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video ref={ref} data-testid="slide-video" src={src} poster={poster ?? undefined} muted autoPlay playsInline preload="auto"
      onEnded={() => done.current()} onError={() => done.current()} className={className} />
  )
}
