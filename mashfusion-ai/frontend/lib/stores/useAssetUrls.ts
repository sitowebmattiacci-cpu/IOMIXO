'use client'

import { create } from 'zustand'

// In-memory map of asset_ref (s3_key) → currently-valid signed URL.
// Populated by the stem browser, samples panel, and on-drop events so the
// audio engine and waveform renderer can resolve every clip in the
// arrangement back to a playable URL. Signed URLs expire (typically 1h)
// — when that happens the panel re-fetch refreshes the entry.
interface AssetUrlState {
  urls: Map<string, string>
  setUrl: (assetRef: string, url: string) => void
  setMany: (entries: Iterable<[string, string]>) => void
}

export const useAssetUrls = create<AssetUrlState>((set) => ({
  urls: new Map<string, string>(),
  setUrl: (assetRef, url) =>
    set((s) => {
      if (s.urls.get(assetRef) === url) return s
      const next = new Map(s.urls)
      next.set(assetRef, url)
      return { urls: next }
    }),
  setMany: (entries) =>
    set((s) => {
      const next = new Map(s.urls)
      let changed = false
      for (const [k, v] of Array.from(entries)) {
        if (next.get(k) !== v) { next.set(k, v); changed = true }
      }
      return changed ? { urls: next } : s
    }),
}))
