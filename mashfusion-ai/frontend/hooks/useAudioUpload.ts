'use client'
import { useState, useCallback } from 'react'
import { tracks } from '@/lib/api'
import { isValidAudioFile, MAX_UPLOAD_BYTES } from '@/lib/utils'
import type { UploadState, UploadedTrack } from '@/types'

interface UseAudioUploadOptions {
  projectId: string
  role: 'track_a' | 'track_b'
  onSuccess?: (track: UploadedTrack) => void
  onError?:   (message: string) => void
}

export function useAudioUpload({ projectId, role, onSuccess, onError }: UseAudioUploadOptions) {
  const [state, setState] = useState<UploadState>({
    file: null,
    progress: 0,
    status: 'idle',
  })

  const reset = useCallback(() => {
    setState({ file: null, progress: 0, status: 'idle' })
  }, [])

  const upload = useCallback(
    async (file: File) => {
      // ── Validate ─────────────────────────────────────────────
      if (!isValidAudioFile(file)) {
        const msg = 'Invalid file type. Please upload MP3, WAV, FLAC, or AIFF.'
        setState((s) => ({ ...s, status: 'error', error: msg }))
        onError?.(msg)
        return
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        const msg = 'File too large. Maximum upload size is 100 MB.'
        setState((s) => ({ ...s, status: 'error', error: msg }))
        onError?.(msg)
        return
      }

      setState({ file, progress: 0, status: 'uploading' })

      try {
        // 1. Get pre-signed S3 URL from backend
        const { upload_url, track_id } = await tracks.requestUploadUrl(
          projectId,
          role,
          file.name,
          file.type || 'audio/mpeg'
        )

        // 2. Upload directly to Supabase Storage
        await tracks.uploadToStorage(upload_url, file, (pct) => {
          setState((s) => ({ ...s, progress: pct }))
        })

        // 3. Determine duration via Web Audio API
        let duration = 0
        try {
          const ctx = new AudioContext()
          const buf = await file.arrayBuffer()
          const decoded = await ctx.decodeAudioData(buf)
          duration = decoded.duration
          ctx.close()
        } catch (_) {
          // duration stays 0 — non-fatal
        }

        // 4. Confirm upload to backend
        const confirmedTrack = await tracks.confirmUpload(track_id, duration)

        setState((s) => ({ ...s, status: 'done', track: confirmedTrack, progress: 100 }))
        onSuccess?.(confirmedTrack)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        setState((s) => ({ ...s, status: 'error', error: msg, progress: 0 }))
        onError?.(msg)
      }
    },
    [projectId, role, onSuccess, onError]
  )

  return { state, upload, reset }
}
