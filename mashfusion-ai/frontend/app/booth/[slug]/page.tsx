'use client'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { useState, useRef, useEffect } from 'react'
import { Camera, X, RotateCw, Check, Heart, Loader } from 'lucide-react'
import { publicLive, livePhotos } from '@/lib/api'
import { WeddingShell, WeddingButton } from '@/components/wedding/WeddingUI'
import toast from 'react-hot-toast'

export default function LiveBoothPage() {
  const { slug } = useParams<{ slug: string }>()
  const { data, error } = useSWR(
    slug ? ['public-live', slug] : null,
    () => publicLive.get(slug!),
    { refreshInterval: 3_000 },
  )

  const [cameraActive, setCameraActive] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [])

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(err => console.error('Video play failed:', err))
    }
  }, [cameraActive])

  if (error || !data) {
    return (
      <WeddingShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-wedding-taupe text-center">Sessione non trovata.</p>
        </div>
      </WeddingShell>
    )
  }

  const { session } = data
  if (session.session_type !== 'wedding') {
    return (
      <WeddingShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-wedding-taupe text-center">
            Live Booth disponibile solo per il piano Advance.
          </p>
        </div>
      </WeddingShell>
    )
  }

  if (!session.is_active) {
    return (
      <WeddingShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-wedding-taupe text-center">La sessione è terminata.</p>
        </div>
      </WeddingShell>
    )
  }

  const startCamera = async () => {
    try {
      // Check if mediaDevices is available (requires HTTPS or localhost)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('La fotocamera richiede HTTPS. Usa https:// invece di http://')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
    } catch (err) {
      console.error('Camera error:', err)
      toast.error('Impossibile accedere alla fotocamera. Controlla i permessi del browser.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Mirror horizontally to match the selfie-style preview
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    ctx.restore()

    // Draw elegant overlay frame
    drawOverlay(ctx, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setPhoto(dataUrl)
    stopCamera()
  }

  const drawOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const padding = Math.min(w, h) * 0.05
    const cornerLen = Math.min(w, h) * 0.08
    const strokeWidth = Math.min(w, h) * 0.005

    // Border
    ctx.strokeStyle = 'rgba(232, 183, 200, 0.9)' // wedding-blush
    ctx.lineWidth = strokeWidth
    ctx.strokeRect(padding, padding, w - padding * 2, h - padding * 2)

    // Corner accents
    ctx.strokeStyle = 'rgba(143, 29, 44, 0.8)' // wedding-burgundy
    ctx.lineWidth = strokeWidth * 1.5

    const corners = [
      [padding, padding, padding + cornerLen, padding, padding, padding + cornerLen],
      [w - padding, padding, w - padding - cornerLen, padding, w - padding, padding + cornerLen],
      [padding, h - padding, padding + cornerLen, h - padding, padding, h - padding - cornerLen],
      [w - padding, h - padding, w - padding - cornerLen, h - padding, w - padding, h - padding - cornerLen],
    ]
    corners.forEach(([x, y, x1, y1, x2, y2]) => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x, y)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    })

    // Text overlay
    ctx.fillStyle = 'rgba(43, 36, 36, 0.9)'
    ctx.font = `${Math.min(w, h) * 0.04}px "Cormorant Garamond", serif`
    ctx.textAlign = 'center'
    const names = session.couple_names ?? session.event_name
    ctx.fillText(names, w / 2, h - padding * 2.5)

    if (session.wedding_date) {
      ctx.font = `italic ${Math.min(w, h) * 0.025}px "Cormorant Garamond", serif`
      ctx.fillStyle = 'rgba(111, 98, 96, 0.9)'
      const date = new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })
      ctx.fillText(date, w / 2, h - padding * 1.5)
    }
  }

  const retakePhoto = () => {
    setPhoto(null)
    startCamera()
  }

  const uploadPhoto = async () => {
    if (!photo) return
    setUploading(true)
    try {
      const blob = await (await fetch(photo)).blob()
      const file = new File([blob], 'booth-photo.jpg', { type: 'image/jpeg' })
      await livePhotos.boothUpload(slug!, file, {})
      toast.success('La tua foto apparirà sul Live Booth ❤️')
      setPhoto(null)
      // Optionally restart camera or show success state
    } catch (err: any) {
      const msg = err?.message ?? 'Errore durante l\'invio.'
      if (msg.includes('Wedding Edition') || msg.includes('sospese')) {
        toast.error('Live Booth disponibile solo per il piano Advance.')
      } else {
        toast.error(msg)
      }
    } finally {
      setUploading(false)
    }
  }

  if (photo) {
    return (
      <WeddingShell>
        <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-6">
          <div className="relative max-w-2xl w-full rounded-2xl overflow-hidden shadow-wedding-lg border-4 border-wedding-gold/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Preview" className="w-full h-auto" />
          </div>
          <div className="flex gap-4">
            <WeddingButton
              onClick={retakePhoto}
              disabled={uploading}
              icon={<RotateCw className="h-5 w-5" />}
              size="lg"
            >
              Rifai
            </WeddingButton>
            <WeddingButton
              onClick={uploadPhoto}
              disabled={uploading}
              loading={uploading}
              icon={<Check className="h-5 w-5" />}
              size="lg"
            >
              Invia
            </WeddingButton>
          </div>
        </div>
      </WeddingShell>
    )
  }

  if (cameraActive) {
    return (
      <WeddingShell>
        <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
          <div className="relative max-w-2xl w-full rounded-2xl overflow-hidden shadow-wedding-lg border-4 border-wedding-gold/30">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto mirror"
            />
            <div className="absolute inset-0 pointer-events-none">
              <CameraOverlay session={session} />
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-4 mt-6">
            <WeddingButton
              onClick={stopCamera}
              icon={<X className="h-5 w-5" />}
              size="lg"
            >
              Chiudi
            </WeddingButton>
            <WeddingButton
              onClick={capturePhoto}
              icon={<Camera className="h-5 w-5" />}
              size="lg"
            >
              Scatta foto
            </WeddingButton>
          </div>
        </div>
        <style jsx global>{`
          .mirror { transform: scaleX(-1); }
        `}</style>
      </WeddingShell>
    )
  }

  return (
    <WeddingShell>
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center space-y-8">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-wedding-burgundy mb-4">
            ✦ Live Booth ✦
          </p>
          <h1 className="font-wedding text-5xl sm:text-6xl text-wedding-ink leading-tight tracking-wide">
            {session.couple_names ?? session.event_name}
          </h1>
          {session.wedding_date && (
            <p className="font-wedding text-2xl italic text-wedding-taupe mt-4">
              {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
            </p>
          )}
        </div>

        <div className="max-w-md">
          <p className="text-wedding-ink/70 mb-6">
            Scatta una foto e partecipa al Live Booth del matrimonio.
            La tua foto apparirà sullo schermo live!
          </p>
          <WeddingButton
            onClick={startCamera}
            icon={<Camera className="h-5 w-5" />}
            size="lg"
            className="w-full"
          >
            Apri fotocamera
          </WeddingButton>
        </div>

        <p className="text-center mt-10 text-[10px] uppercase tracking-[0.32em] text-wedding-taupe">
          Powered by <span className="text-wedding-burgundy">IOMIXO Live Hub</span>
        </p>
      </div>
    </WeddingShell>
  )
}

function CameraOverlay({ session }: { session: { couple_names: string | null; event_name: string; wedding_date: string | null } }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-between p-4 sm:p-6 pointer-events-none">
      {/* Top corners */}
      <div className="flex justify-between">
        <Corner />
        <Corner className="rotate-90" />
      </div>

      {/* Bottom overlay */}
      <div className="text-center space-y-1">
        <p className="font-wedding text-2xl sm:text-3xl text-white drop-shadow-lg">
          {session.couple_names ?? session.event_name}
        </p>
        {session.wedding_date && (
          <p className="font-wedding text-sm sm:text-base italic text-white/90 drop-shadow-lg">
            {new Date(session.wedding_date).toLocaleDateString('it-IT', { dateStyle: 'long' })}
          </p>
        )}
      </div>

      {/* Bottom corners */}
      <div className="flex justify-between">
        <Corner className="-rotate-90" />
        <Corner className="rotate-180" />
      </div>
    </div>
  )
}

function Corner({ className = '' }: { className?: string }) {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      className={`text-wedding-blush opacity-90 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M0 12 L0 0 L12 0" />
    </svg>
  )
}
