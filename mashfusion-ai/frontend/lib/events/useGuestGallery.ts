'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { livePhotos, type LivePhoto } from '../api'

const PAGE = 24
const REFRESH_MS = 20_000

/**
 * Shared guest gallery: the approved media of an album, newest first, loaded PAGE at a time (`more`), with the first page re-read in the background so new
 * uploads appear. `denied` = the server refused the read (the owner's "Galleria condivisa" is off, or it was just switched off): the caller shows nothing.
 */
export function useGuestGallery(slug: string, enabled: boolean) {
  const [items, setItems] = useState<LivePhoto[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading')
  const [done, setDone] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const cursor = useRef<unknown>(null)
  const busy = useRef(false)

  const more = useCallback(async () => {
    if (busy.current || done || !enabled) return
    busy.current = true; setLoadingMore(true)
    try {
      const page = await livePhotos.galleryPage(slug, PAGE, cursor.current)
      cursor.current = page.cursor
      setItems((cur) => { const seen = new Set(cur.map((p) => p.id)); return [...cur, ...page.items.filter((p) => !seen.has(p.id))] })
      setDone(page.done); setState('ready')
    } catch (e: any) {
      setState(e?.code === 'permission-denied' || /permission/i.test(String(e?.message)) ? 'denied' : 'error')
    } finally { busy.current = false; setLoadingMore(false) }
  }, [slug, done, enabled])

  // First page.
  useEffect(() => {
    if (!enabled) return
    setItems([]); setDone(false); cursor.current = null; setState('loading')
    busy.current = false
    void more()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, enabled])

  // New uploads: re-read the newest page now and then (cheap, one page) and put unseen media in front. Paused while the tab is hidden.
  useEffect(() => {
    if (!enabled || state !== 'ready') return
    const id = setInterval(async () => {
      if (document.hidden) return
      try {
        const page = await livePhotos.galleryPage(slug, PAGE)
        setItems((cur) => { const seen = new Set(cur.map((p) => p.id)); const fresh = page.items.filter((p) => !seen.has(p.id)); return fresh.length ? [...fresh, ...cur] : cur })
      } catch (e: any) {
        if (e?.code === 'permission-denied' || /permission/i.test(String(e?.message))) { setItems([]); setState('denied') }
      }
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [slug, enabled, state])

  return { items, state, done, loadingMore, more }
}
