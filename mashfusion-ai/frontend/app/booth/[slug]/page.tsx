'use client'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import { useState, useRef, useEffect } from 'react'
import { Camera, X, RotateCw, Check, Sparkles } from 'lucide-react'
import { publicLive, livePhotos } from '@/lib/api'
import { WeddingShell, WeddingButton } from '@/components/wedding/WeddingUI'
import {
  PartyShell, PartyButton, PartyCard, PartyEyebrow, PartyDivider,
} from '@/components/party/PartyUI'
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
  const [countdown, setCountdown] = useState<number | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (countdownTimer.current) clearTimeout(countdownTimer.current)
    }
  }, [])

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch((err) => console.error('Video play failed:', err))
    }
  }, [cameraActive])

  if (error || !data) {
    return (
      <PartyShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-white/60 text-center">Sessione non trovata.</p>
        </div>
      </PartyShell>
    )
  }

  const { session } = data
  const isParty   = session.session_type === 'party'
  const isWedding = session.session_type === 'wedding'

  if (!isParty && !isWedding) {
    return (
      <PartyShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-white/70 text-center">
            Live Booth disponibile solo per le sessioni Party Mode o Wedding Edition.
          </p>
        </div>
      </PartyShell>
    )
  }

  if (!session.is_active) {
    return isWedding ? (
      <WeddingShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-wedding-taupe text-center">La sessione è terminata.</p>
        </div>
      </WeddingShell>
    ) : (
      <PartyShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-white/60 text-center">La sessione è terminata.</p>
        </div>
      </PartyShell>
    )
  }

  // ─── Camera helpers ──────────────────────────────────────────
  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('La fotocamera richiede HTTPS.')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
    } catch {
      toast.error('Impossibile accedere alla fotocamera. Controlla i permessi del browser.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
    setCountdown(null)
    if (countdownTimer.current) clearTimeout(countdownTimer.current)
  }

  const drawPartyOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pad = Math.min(w, h) * 0.04
    const grd = ctx.createLinearGradient(0, 0, w, 0)
    grd.addColorStop(0, '#FF3D8A')
    grd.addColorStop(1, '#8B0E2F')
    ctx.strokeStyle = grd
    ctx.lineWidth = Math.min(w, h) * 0.008
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2)

    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    const bandH = Math.min(w, h) * 0.11
    ctx.fillRect(pad, h - pad - bandH, w - pad * 2, bandH)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = `700 ${Math.min(w, h) * 0.04}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(session.event_name, w / 2, h - pad - bandH * 0.55)

    ctx.fillStyle = '#FF7AB6'
    ctx.font = `${Math.min(w, h) * 0.025}px Inter, sans-serif`
    ctx.fillText('IOMIXO LIVE BOOTH', w / 2, h - pad - bandH * 0.2)
  }

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    ctx.restore()
    // Wedding: nessun overlay "stampato" nella foto — la cornice elegante
    // "Oggi Sposi" viene applicata in fase di visualizzazione (WeddingPhotoFrame),
    // così la foto originale resta pulita.
    if (!isWedding) drawPartyOverlay(ctx, canvas.width, canvas.height)
    setPhoto(canvas.toDataURL('image/jpeg', 0.9))
    stopCamera()
  }

  /** PHOTO MOMENT 3-2-1 countdown then capture. */
  const startPhotoMoment = () => {
    if (!cameraActive) return
    const tick = (n: number) => {
      if (n <= 0) {
        setCountdown(null)
        capturePhoto()
        return
      }
      setCountdown(n)
      countdownTimer.current = setTimeout(() => tick(n - 1), 1000)
    }
    tick(3)
  }

  const retakePhoto = () => { setPhoto(null); startCamera() }

  const uploadPhoto = async () => {
    if (!photo) return
    setUploading(true)
    try {
      const blob = await (await fetch(photo)).blob()
      const file = new File([blob], 'booth-photo.jpg', { type: 'image/jpeg' })
      await livePhotos.boothUpload(slug!, file, {})
      toast.success(isWedding
        ? 'La tua foto apparirà sul Live Booth ❤️'
        : 'Foto inviata! Potrebbe apparire sullo schermo live.')
      setPhoto(null)
    } catch (err: any) {
      const msg = err?.message ?? 'Errore durante l\'invio.'
      if (msg.includes('Advance') || msg.includes('Pass') || msg.includes('sospese')) {
        toast.error('Live Booth disponibile con Advance o Event Pass 24H.')
      } else {
        toast.error(msg)
      }
    } finally { setUploading(false) }
  }

  // ─── PARTY UI ────────────────────────────────────────────────
  if (isParty) {
    if (photo) {
      return (
        <PartyShell>
          <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-6">
            <div className="relative max-w-2xl w-full rounded-3xl overflow-hidden ring-2 ring-[#FF3D8A]/40 shadow-[0_25px_80px_rgba(255,61,138,0.35)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Preview" className="w-full h-auto" />
            </div>
            <div className="flex gap-3 flex-wrap justify-center">
              <PartyButton variant="ghost" onClick={retakePhoto} disabled={uploading} icon={<RotateCw className="h-5 w-5" />} size="lg">
                Rifai
              </PartyButton>
              <PartyButton variant="fuchsia" onClick={uploadPhoto} disabled={uploading} loading={uploading} icon={<Check className="h-5 w-5" />} size="lg">
                Usa questa foto
              </PartyButton>
            </div>
          </div>
        </PartyShell>
      )
    }

    if (cameraActive) {
      return (
        <PartyShell>
          <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">
            <div className="relative max-w-2xl w-full rounded-3xl overflow-hidden ring-2 ring-[#FF3D8A]/40 shadow-[0_25px_80px_rgba(255,61,138,0.35)]">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-auto mirror" />
              {countdown !== null && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm">
                  <p className="text-[#FF7AB6] text-2xl font-black tracking-[0.5em] uppercase mb-6 animate-pulse">
                    Photo Moment
                  </p>
                  <p key={countdown} className="text-white text-[12rem] sm:text-[16rem] font-black leading-none drop-shadow-[0_0_40px_rgba(255,61,138,0.7)]">
                    {countdown}
                  </p>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="flex gap-3 mt-6 flex-wrap justify-center">
              <PartyButton variant="ghost" onClick={stopCamera} icon={<X className="h-5 w-5" />} size="lg">
                Chiudi
              </PartyButton>
              <PartyButton
                variant="fuchsia"
                onClick={startPhotoMoment}
                disabled={countdown !== null}
                icon={<Camera className="h-5 w-5" />}
                size="lg"
              >
                {countdown !== null ? `${countdown}…` : 'Photo Moment'}
              </PartyButton>
            </div>
          </div>
          <style jsx global>{`.mirror { transform: scaleX(-1); }`}</style>
        </PartyShell>
      )
    }

    return (
      <PartyShell>
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center space-y-8 max-w-lg mx-auto py-12">
          <div>
            <PartyEyebrow>✦ Live Booth ✦</PartyEyebrow>
            <h1 className="text-5xl sm:text-6xl font-black text-white mt-3 leading-tight">
              {session.event_name}
            </h1>
            <PartyDivider className="my-6" />
            <p className="text-base text-white/70">
              Partecipa al Photo Moment.
              <br />
              La tua foto può apparire live sullo schermo della serata.
            </p>
          </div>

          <PartyCard tone="fuchsia" className="w-full">
            <div className="flex items-center justify-center gap-2 text-[#FF7AB6] mb-3">
              <Sparkles className="h-4 w-4" />
              <p className="text-[11px] uppercase tracking-[0.3em] font-semibold">Come funziona</p>
              <Sparkles className="h-4 w-4" />
            </div>
            <ol className="text-sm text-white/80 space-y-1.5 text-left list-decimal list-inside">
              <li>Apri la fotocamera</li>
              <li>Posa per il countdown <span className="text-[#FF7AB6] font-bold">3… 2… 1</span></li>
              <li>Conferma o rifai lo scatto</li>
              <li>Invia: il DJ potrà mostrarla sullo schermo</li>
            </ol>
          </PartyCard>

          <PartyButton onClick={startCamera} icon={<Camera className="h-5 w-5" />} size="lg" variant="fuchsia" className="w-full">
            Partecipa al Live Booth
          </PartyButton>

          <p className="text-[10px] uppercase tracking-[0.32em] text-white/30">
            Powered by <span className="text-[#FF7AB6]">IOMIXO Live Hub</span>
          </p>
        </div>
      </PartyShell>
    )
  }

  // ─── WEDDING UI (unchanged behaviour) ────────────────────────
  if (photo) {
    return (
      <WeddingShell>
        <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-6">
          <div className="relative max-w-2xl w-full rounded-2xl overflow-hidden shadow-wedding-lg border-4 border-wedding-gold/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Preview" className="w-full h-auto" />
          </div>
          <div className="flex gap-4">
            <WeddingButton onClick={retakePhoto} disabled={uploading} icon={<RotateCw className="h-5 w-5" />} size="lg">Rifai</WeddingButton>
            <WeddingButton onClick={uploadPhoto} disabled={uploading} loading={uploading} icon={<Check className="h-5 w-5" />} size="lg">Invia</WeddingButton>
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
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-auto mirror" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-4 mt-6">
            <WeddingButton onClick={stopCamera} icon={<X className="h-5 w-5" />} size="lg">Chiudi</WeddingButton>
            <WeddingButton onClick={capturePhoto} icon={<Camera className="h-5 w-5" />} size="lg">Scatta foto</WeddingButton>
          </div>
        </div>
        <style jsx global>{`.mirror { transform: scaleX(-1); }`}</style>
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
          <WeddingButton onClick={startCamera} icon={<Camera className="h-5 w-5" />} size="lg" className="w-full">
            Apri fotocamera
          </WeddingButton>
        </div>
      </div>
    </WeddingShell>
  )
}
