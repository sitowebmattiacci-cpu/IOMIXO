'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Slideshow engine (Live Screen / Live Booth)
// Motore condiviso per Wedding Edition e Party Mode. Garantisce uno
// slideshow professionale su TV / LED wall:
//
//  • RANDOM senza ripetizioni ravvicinate (logica "shuffle bag"):
//    crea una lista randomizzata di TUTTE le foto, le mostra in
//    quell'ordine, e solo quando finisce ricrea una nuova lista.
//    La prima foto della nuova lista non è mai uguale all'ultima
//    mostrata. Con 20/30/40/50 foto girano tutte prima di ricominciare.
//  • Nessun riquadro bianco: la foto corrente NON viene mai rimossa
//    finché la prossima non è stata precaricata (new Image + decode).
//  • Se il preload fallisce, la foto viene saltata e si prova la
//    successiva; se nessuna è pronta si continua a mostrare l'attuale.
//  • Precarica anche le prossime foto della coda per una rotazione fluida.
//
// Casi limite: 1 foto → resta quella (ripetizione normale). 2 foto →
// alternanza garantita dal vincolo "prima != ultima".
// ════════════════════════════════════════════════════════════════

export interface SlideItem {
  id: string
  url?: string | null
}

/** Cache globale degli URL già decodificati (condivisa tra le istanze). */
const decodedUrls = new Set<string>()

/** Precarica e decodifica un'immagine. Risolve solo quando è pronta a dipingere. */
function preloadImage(url: string): Promise<void> {
  if (decodedUrls.has(url)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    const settle = () => { decodedUrls.add(url); resolve() }
    img.onload = () => {
      const anyImg = img as unknown as { decode?: () => Promise<void> }
      if (typeof anyImg.decode === 'function') {
        anyImg.decode().then(settle).catch(settle)
      } else {
        settle()
      }
    }
    img.onerror = () => reject(new Error('preload failed'))
    img.src = url
  })
}

function shuffle<T>(input: T[]): T[] {
  const a = input.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}

export interface SlideshowState<T extends SlideItem> {
  /** Foto attualmente da mostrare (già precaricata). null finché la prima non è pronta. */
  photo: T | null
  /** true se esiste almeno una foto con URL valido. */
  hasPhotos: boolean
  /** true mentre la prima foto si sta caricando (foto presenti ma nessuna ancora pronta). */
  isLoadingFirst: boolean
}

/**
 * Slideshow "shuffle bag" con preload. Cambia foto solo quando la prossima
 * immagine è già decodificata, così non compaiono mai riquadri bianchi.
 */
export function useSlideshow<T extends SlideItem>(
  photos: T[],
  intervalMs = 8000,
): SlideshowState<T> {
  const [photo, setPhoto] = useState<T | null>(null)

  const photosRef = useRef<T[]>(photos)
  const bagRef = useRef<T[]>([])
  const posRef = useRef(0)
  const lastIdRef = useRef<string | null>(null)
  const displayedRef = useRef<T | null>(null)
  const switchingRef = useRef(false)

  photosRef.current = photos

  // Firma stabile del set di foto: cambia solo se cambiano gli id (non a ogni poll).
  const signature = photos.map((p) => p.id).join('|')
  const withUrl = photos.filter((p) => !!p.url)
  const hasPhotos = withUrl.length > 0

  const rebuildBag = useCallback(() => {
    const list = photosRef.current.filter((p) => !!p.url)
    const bag = shuffle(list)
    // La prima della nuova coda non deve essere uguale all'ultima mostrata.
    if (bag.length > 1 && lastIdRef.current && bag[0].id === lastIdRef.current) {
      const swapIdx = 1 + Math.floor(Math.random() * (bag.length - 1))
      const tmp = bag[0]
      bag[0] = bag[swapIdx]
      bag[swapIdx] = tmp
    }
    bagRef.current = bag
    posRef.current = 0
  }, [])

  const takeNext = useCallback((): T | null => {
    if (bagRef.current.length === 0 || posRef.current >= bagRef.current.length) {
      rebuildBag()
    }
    const bag = bagRef.current
    if (bag.length === 0) return null
    const item = bag[posRef.current]
    posRef.current += 1
    return item
  }, [rebuildBag])

  const peekUpcoming = useCallback((count: number): T[] => {
    const bag = bagRef.current
    const res: T[] = []
    for (let k = 0; k < count; k++) {
      const idx = posRef.current + k
      if (idx < bag.length) res.push(bag[idx])
    }
    return res
  }, [])

  const advance = useCallback(async () => {
    if (switchingRef.current) return
    const available = photosRef.current.filter((p) => !!p.url)

    if (available.length === 0) {
      displayedRef.current = null
      setPhoto(null)
      return
    }

    // Una sola foto: mostrala (ripetizione normale), nessuna rotazione.
    if (available.length === 1) {
      const only = available[0]
      if (displayedRef.current?.id === only.id) return
      try {
        await preloadImage(only.url as string)
      } catch {
        return
      }
      displayedRef.current = only
      lastIdRef.current = only.id
      setPhoto(only)
      return
    }

    switchingRef.current = true
    try {
      const maxAttempts = available.length
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = takeNext()
        if (!candidate || !candidate.url) continue
        // Mai la stessa foto due volte di seguito (se evitabile).
        if (candidate.id === displayedRef.current?.id) continue
        try {
          await preloadImage(candidate.url)
        } catch {
          // Preload fallito → salta questa foto e prova la successiva.
          continue
        }
        displayedRef.current = candidate
        lastIdRef.current = candidate.id
        setPhoto(candidate)
        // Precarica le prossime foto della coda per una rotazione fluida.
        peekUpcoming(3).forEach((it) => {
          if (it.url) preloadImage(it.url).catch(() => {})
        })
        return
      }
      // Nessuna foto nuova pronta → continua a mostrare quella corrente.
    } finally {
      switchingRef.current = false
    }
  }, [takeNext, peekUpcoming])

  // Quando cambia il set di foto: ricostruisci la coda e mostra subito la
  // prima (o sostituisci quella corrente se è stata rimossa).
  useEffect(() => {
    rebuildBag()
    const current = displayedRef.current
    const stillThere = current
      ? photosRef.current.some((p) => p.id === current.id && p.url)
      : false
    if (!current || !stillThere) {
      void advance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Rotazione automatica.
  useEffect(() => {
    if (withUrl.length <= 1) return
    const id = setInterval(() => { void advance() }, intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, intervalMs, withUrl.length])

  return {
    photo,
    hasPhotos,
    isLoadingFirst: hasPhotos && photo === null,
  }
}
