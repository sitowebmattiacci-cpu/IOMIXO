'use client'
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Play, Pause, Volume2, VolumeX } from 'lucide-react'
import { cn, formatDuration } from '@/lib/utils'

interface WaveformPlayerProps {
  audioUrl: string
  label?: string
  color?: string
  className?: string
}

export function WaveformPlayer({ audioUrl, label, color = '#7c3aed', className }: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted]     = useState(false)
  const [time, setTime]       = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return

    const ws = WaveSurfer.create({
      container:       containerRef.current,
      waveColor:       'rgba(124,58,237,0.35)',
      progressColor:   color,
      cursorColor:     'rgba(255,255,255,0.6)',
      barWidth:        2,
      barRadius:       2,
      barGap:          1,
      height:          56,
      normalize:       true,
      url:             audioUrl,
    })

    wsRef.current = ws

    ws.on('ready',    () => { setLoading(false); setDuration(ws.getDuration()) })
    ws.on('timeupdate', (t) => setTime(t))
    ws.on('play',     () => setPlaying(true))
    ws.on('pause',    () => setPlaying(false))
    ws.on('finish',   () => setPlaying(false))

    return () => { ws.destroy(); wsRef.current = null }
  }, [audioUrl, color])

  const togglePlay = () => wsRef.current?.playPause()
  const toggleMute = () => {
    if (!wsRef.current) return
    if (muted) {
      wsRef.current.setVolume(1)
      setMuted(false)
    } else {
      wsRef.current.setVolume(0)
      setMuted(true)
    }
  }

  return (
    <div className={cn('glass rounded-xl p-4', className)}>
      {label && (
        <p className="mb-2 text-xs font-medium text-white/50 uppercase tracking-wider">{label}</p>
      )}

      <div className="relative" ref={containerRef}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-white/30">Loading waveform…</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={togglePlay}
          disabled={loading}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-600 hover:bg-purple-500 transition-colors disabled:opacity-40"
        >
          {playing
            ? <Pause className="h-4 w-4 text-white" />
            : <Play  className="h-4 w-4 text-white translate-x-0.5" />}
        </button>

        <span className="text-xs text-white/40 font-mono">
          {formatDuration(time)} / {formatDuration(duration)}
        </span>

        <button onClick={toggleMute} className="ml-auto text-white/30 hover:text-white/60 transition-colors">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
