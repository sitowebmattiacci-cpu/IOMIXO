'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SlideItem, preloadImage, shuffle } from './useSlideshow'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Grid slideshow engine (Live Booth wall · Screen Mode)
// Motore condiviso Party/Wedding per il "wall" di foto a griglia su
// TV / proiettore. Stessa logica anti-ripetizione del motore single:
//
//  • La griglia parte con foto DIVERSE quando possibile (shuffle bag).
//  • Ogni intervallo cambia UNA SOLA cella, scegliendo una foto NON
//    già visibile nella griglia (se ci sono abbastanza immagini).
//  • Nessuna cella bianca a metà caricamento: la nuova foto viene
//    prima precaricata/decodificata (preloadImage), poi inserita.
//  • Se ci sono meno foto delle celle, mostra solo le celle riempite
//    (niente buchi bianchi). Se foto <= celle non ruota nulla.
//  • Preload fallito → salta la foto e prova la successiva.
// ════════════════════════════════════════════════════════════════

export interface GridSlideshowState<T extends SlideItem> {
  /** Celle attualmente visibili (tutte con foto già decodificata). */
  grid: T[]
  /** true se esiste almeno una foto con URL valido. */
  hasPhotos: boolean
}

/**
 * Griglia "shuffle bag" con preload. Cambia una cella alla volta solo
 * quando la nuova immagine è già decodificata.
 *
 * @param photos   elenco foto (id + url)
 * @param cellCount numero massimo di celle (es. 6 per 3x2)
 * @param intervalMs ogni quanto cambiare una cella (default 3500ms)
 */
export function useGridSlideshow<T extends SlideItem>(
  photos: T[],
  cellCount: number,
  intervalMs = 3500,
): GridSlideshowState<T> {
  const [grid, setGrid] = useState<T[]>([])

  const photosRef = useRef<T[]>(photos)
  const gridRef = useRef<T[]>([])
  const bagRef = useRef<T[]>([])
  const posRef = useRef(0)
  const swappingRef = useRef(false)

  photosRef.current = photos

  const withUrl = photos.filter((p) => !!p.url)
  const hasPhotos = withUrl.length > 0
  // Firma stabile: cambia solo se cambia l'insieme di id (non a ogni poll).
  const signature = photos.map((p) => p.id).join('|')

  const rebuildBag = useCallback(() => {
    bagRef.current = shuffle(photosRef.current.filter((p) => !!p.url))
    posRef.current = 0
  }, [])

  const takeFromBag = useCallback((): T | null => {
    if (bagRef.current.length === 0 || posRef.current >= bagRef.current.length) {
      rebuildBag()
    }
    if (bagRef.current.length === 0) return null
    const item = bagRef.current[posRef.current]
    posRef.current += 1
    return item
  }, [rebuildBag])

  // Inizializza la griglia quando cambia l'insieme di foto.
  useEffect(() => {
    let cancelled = false
    const list = photosRef.current.filter((p) => !!p.url)
    if (list.length === 0) {
      gridRef.current = []
      setGrid([])
      return
    }
    const target = Math.min(cellCount, list.length)
    const initial = shuffle(list).slice(0, target)
    rebuildBag()
    // Precarica tutte le celle iniziali, poi mostra (niente celle a metà).
    Promise.all(initial.map((p) => preloadImage(p.url as string).catch(() => {}))).then(() => {
      if (cancelled) return
      gridRef.current = initial
      setGrid(initial)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cellCount])

  // Cambia UNA cella scegliendo una foto non già visibile (se possibile).
  const rotateOne = useCallback(async () => {
    if (swappingRef.current) return
    const list = photosRef.current.filter((p) => !!p.url)
    const current = gridRef.current
    // Tutte le foto sono già a schermo → niente rotazione.
    if (current.length === 0 || list.length <= current.length) return

    swappingRef.current = true
    try {
      const visibleIds = new Set(current.map((c) => c.id))
      const maxAttempts = list.length
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = takeFromBag()
        if (!candidate || !candidate.url) continue
        if (visibleIds.has(candidate.id)) continue
        try {
          await preloadImage(candidate.url)
        } catch {
          continue // preload fallito → prova la prossima
        }
        const cellIdx = Math.floor(Math.random() * current.length)
        const next = current.slice()
        next[cellIdx] = candidate
        gridRef.current = next
        setGrid(next)
        return
      }
      // Nessuna foto nuova pronta → lascia la griglia invariata.
    } finally {
      swappingRef.current = false
    }
  }, [takeFromBag])

  useEffect(() => {
    if (withUrl.length <= cellCount) return // niente da ruotare
    const id = setInterval(() => { void rotateOne() }, intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, cellCount, intervalMs, withUrl.length])

  return { grid, hasPhotos }
}
