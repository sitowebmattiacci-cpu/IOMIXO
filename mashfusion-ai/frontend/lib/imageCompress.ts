// ════════════════════════════════════════════════════════════════
// IOMIXO — Compressione/ridimensionamento immagini lato client
// Riduce le foto enormi (8/12 MB da smartphone) prima dell'upload, così
// la Live Screen carica immagini leggere e ottimizzate per il display.
// È difensivo: qualsiasi errore → restituisce il file originale invariato.
// ════════════════════════════════════════════════════════════════

export interface CompressOptions {
  maxWidth?: number
  maxHeight?: number
  /** Qualità JPEG 0..1 (default 0.82). */
  quality?: number
}

async function loadImageBitmap(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  // createImageBitmap gestisce anche l'orientamento EXIF (foto da smartphone).
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      } as ImageBitmapOptions)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    } catch {
      /* fallback sotto */
    }
  }
  const url = URL.createObjectURL(file)
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('image load failed'))
    el.src = url
  })
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  }
}

/**
 * Comprime/ridimensiona un'immagine mantenendo le proporzioni.
 * I file non-immagine o già piccoli vengono restituiti invariati.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const { maxWidth = 1920, maxHeight = 1920, quality = 0.82 } = opts

  if (typeof document === 'undefined') return file
  if (!file.type.startsWith('image/')) return file
  // I GIF animati perderebbero l'animazione: non li tocchiamo.
  if (file.type === 'image/gif') return file
  // File già leggeri: non vale la pena ricomprimere.
  if (file.size < 600 * 1024) return file

  let cleanup: (() => void) | null = null
  try {
    const loaded = await loadImageBitmap(file)
    cleanup = loaded.cleanup
    const { source, width, height } = loaded
    if (!width || !height) return file

    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    // Già entro i limiti e non enorme → lascia l'originale.
    if (scale >= 1 && file.size < 2.5 * 1024 * 1024) return file

    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(source, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  } finally {
    if (cleanup) cleanup()
  }
}
