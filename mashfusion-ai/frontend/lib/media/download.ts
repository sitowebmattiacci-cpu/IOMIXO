import { livePhotos, type LivePhoto } from '../api'

/**
 * Starts a browser download of a URL (an <a> click; the file name comes from the object's Content-Disposition).
 * `sameTab`: for a download that starts LATER than the click that asked for it (the archive, minutes after): a new tab would be blocked as a pop-up
 * without a fresh user gesture, while a same-tab navigation to an `attachment` response downloads without leaving the page.
 */
export function triggerDownload(url: string, filename?: string | null, opts: { sameTab?: boolean } = {}): void {
  const a = document.createElement('a')
  a.href = url; a.rel = 'noopener noreferrer'; if (!opts.sameTab) a.target = '_blank'
  if (filename) a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
}

/**
 * Owner download of ONE media: ALWAYS the ORIGINAL object (never the thumbnail / optimized copy). A legacy photo has one file only, which is what is
 * given. The original is read through Storage with the owner's session, so nobody else can obtain it.
 */
export async function downloadOriginal(p: Pick<LivePhoto, 'original_path' | 'url' | 'filename' | 'id'>, filePrefix: string): Promise<void> {
  const url = p.original_path ? await livePhotos.originalUrl(p.original_path) : p.url
  if (!url) throw new Error('missing file')
  triggerDownload(url, p.filename ?? `${filePrefix}-${p.id}`)
}
