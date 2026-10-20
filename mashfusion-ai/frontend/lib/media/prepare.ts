// Browser-side preparation of an album upload. The ORIGINAL file is never touched: this only derives the small copies the album shows
// (a 1920 px JPEG and a thumbnail for photos, a poster frame + duration for videos). Nothing here is ever uploaded in place of the original.

export interface PreparedPhoto { optimized: Blob; thumb: Blob; width: number; height: number }
export interface PreparedVideo { poster: Blob | null; durationSec: number | null; width: number | null; height: number | null }

export const OPTIMIZED_EDGE = 1920
export const THUMB_EDGE = 480

async function decodeImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)        // honours EXIF orientation (phone photos)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error('image load failed')); el.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) }
  } catch (e) { URL.revokeObjectURL(url); throw e }
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))

function drawScaled(source: CanvasImageSource, w: number, h: number, maxEdge: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
  const ctx = canvas.getContext('2d'); if (!ctx) return null
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch)                      // a PNG / WebP with transparency must not turn black in a JPEG
  ctx.drawImage(source, 0, 0, cw, ch)
  return canvas
}

/** null = the browser cannot decode this image (e.g. HEIC outside Safari): it is refused as an unsupported format, never uploaded half-handled. */
export async function preparePhoto(file: File): Promise<PreparedPhoto | null> {
  if (typeof document === 'undefined') return null
  let cleanup: (() => void) | null = null
  try {
    const img = await decodeImage(file); cleanup = img.cleanup
    if (!img.width || !img.height) return null
    const big = drawScaled(img.source, img.width, img.height, OPTIMIZED_EDGE), small = drawScaled(img.source, img.width, img.height, THUMB_EDGE)
    if (!big || !small) return null
    const [optimized, thumb] = await Promise.all([toJpeg(big, 0.82), toJpeg(small, 0.72)])
    if (!optimized || !thumb) return null
    return { optimized, thumb, width: img.width, height: img.height }
  } catch { return null } finally { cleanup?.() }
}

const once = (el: HTMLMediaElement, ok: string, ms: number) =>
  new Promise<boolean>((resolve) => {
    const done = (v: boolean) => { clearTimeout(t); el.removeEventListener(ok, onOk); el.removeEventListener('error', onErr); resolve(v) }
    const onOk = () => done(true), onErr = () => done(false), t = setTimeout(() => done(false), ms)
    el.addEventListener(ok, onOk); el.addEventListener('error', onErr)
  })

/**
 * Duration, size and a poster frame of a video, read by a hidden <video>. Never throws and never blocks the upload for long: a format this browser
 * cannot decode (e.g. an HEVC .mov outside Safari) simply has no poster; the original is uploaded all the same.
 */
export async function prepareVideo(file: File, timeoutMs = 8000): Promise<PreparedVideo> {
  const empty: PreparedVideo = { poster: null, durationSec: null, width: null, height: null }
  if (typeof document === 'undefined') return empty
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  try {
    video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.src = url
    if (!(await once(video, 'loadedmetadata', timeoutMs))) return empty
    const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : null
    const out: PreparedVideo = { poster: null, durationSec, width: video.videoWidth || null, height: video.videoHeight || null }
    if (!video.videoWidth || !video.videoHeight) return out
    // The first frame is often black: take one a little in.
    video.currentTime = durationSec ? Math.min(1, durationSec * 0.1) : 0
    if (await once(video, 'seeked', timeoutMs)) {
      const canvas = drawScaled(video, video.videoWidth, video.videoHeight, THUMB_EDGE)
      if (canvas) out.poster = await toJpeg(canvas, 0.72)
    }
    return out
  } catch { return empty } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
}
