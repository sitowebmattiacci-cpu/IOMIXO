'use client'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { useState, useRef, useEffect } from 'react'
import { Camera, X, RotateCw, Check, Sparkles, ArrowLeft, RefreshCw, ImagePlus, AlertTriangle } from 'lucide-react'
import { publicLive, livePhotos } from '@/lib/api'
import { WeddingShell, WeddingButton } from '@/components/wedding/WeddingUI'
import {
  PartyShell, PartyButton, PartyCard, PartyEyebrow, PartyDivider,
} from '@/components/party/PartyUI'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useI18n } from '@/lib/i18n'
import toast from 'react-hot-toast'

export default function LiveBoothPage() {
  const { t } = useI18n()
  const { slug } = useParams<{ slug: string }>()
  const { data, error } = useSWR(
    slug ? ['public-live', slug] : null,
    () => publicLive.get(slug!),
    { refreshInterval: 3_000 },
  )

  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingFileRef = useRef<File | null>(null)
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // iPhone/iPad: Safari & in-app browsers spesso danno "schermo nero" con
  // getUserMedia. Su iOS mettiamo sempre in evidenza il fallback nativo.
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      // iPadOS 13+ si maschera da Mac: rileviamo il touch.
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (countdownTimer.current) clearTimeout(countdownTimer.current)
      if (watchdogTimer.current) clearTimeout(watchdogTimer.current)
    }
  }, [])

  // iOS Safari / in-app browser: attach the stream and force playback once the
  // video element is mounted. A watchdog detects the "black screen" case (stream
  // running but no frames) and falls back to the file-upload flow.
  useEffect(() => {
    if (!cameraActive) return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return

    video.setAttribute('playsinline', 'true')
    video.setAttribute('webkit-playsinline', 'true')
    video.muted = true
    video.srcObject = stream

    const tryPlay = () => { video.play().catch((err) => console.error('Video play failed:', err)) }
    video.onloadedmetadata = tryPlay
    tryPlay()

    if (watchdogTimer.current) clearTimeout(watchdogTimer.current)
    watchdogTimer.current = setTimeout(() => {
      // Still no frames after the grace period → camera is effectively black.
      const v = videoRef.current
      if (v && (v.videoWidth === 0 || v.videoHeight === 0)) {
        stopCamera()
        setCameraError(true)
        toast.error(t('booth.cameraDenied'))
      }
    }, 2000)

    return () => {
      video.onloadedmetadata = null
      if (watchdogTimer.current) clearTimeout(watchdogTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive])

  if (error || !data) {
    return (
      <PartyShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-white/60 text-center">{t('booth.sessionNotFound')}</p>
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
            {t('booth.onlyEventModes')}
          </p>
        </div>
      </PartyShell>
    )
  }

  if (!session.is_active) {
    return isWedding ? (
      <WeddingShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-wedding-taupe text-center">{t('booth.sessionEnded')}</p>
        </div>
      </WeddingShell>
    ) : (
      <PartyShell>
        <div className="min-h-screen flex items-center justify-center px-6">
          <p className="text-white/60 text-center">{t('booth.sessionEnded')}</p>
        </div>
      </PartyShell>
    )
  }

  // ─── Camera helpers ──────────────────────────────────────────
  const startCamera = async (mode: 'user' | 'environment' = facingMode) => {
    // iOS/iPadOS: la camera live del browser dà "schermo nero" / errore permessi.
    // Non chiamiamo MAI getUserMedia su iOS: andiamo direttamente al file picker
    // nativo (Scatta foto / Libreria / Scegli file). Nessun messaggio tecnico.
    if (isIOS) {
      fileInputRef.current?.click()
      return
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error(t('booth.cameraHttps'))
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      setFacingMode(mode)
      setCameraError(false)
      setCameraActive(true)
    } catch {
      setCameraError(true)
      toast.error(t('booth.cameraDenied'))
    }
  }

  const flipCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      setFacingMode(next)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
    } catch {
      toast.error(t('booth.flipError'))
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
    if (facingMode === 'user') {
      // La camera frontale è mostrata "a specchio": replichiamo il flip
      // anche nello scatto così la foto corrisponde all'anteprima.
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
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

  const retakePhoto = () => {
    const wasUpload = !!pendingFileRef.current
    if (photo && photo.startsWith('blob:')) URL.revokeObjectURL(photo)
    setPhoto(null)
    pendingFileRef.current = null
    // Se la foto veniva dal fallback nativo, riapri il selettore file (su iPhone
    // la camera live potrebbe dare schermo nero): niente getUserMedia.
    if (wasUpload) openFilePicker()
    else startCamera()
  }

  // ─── File fallback (NO getUserMedia / video / canvas / stream) ───────
  // Usa esclusivamente <input type="file" accept="image/*">. Il file ORIGINALE
  // viene tenuto in pendingFileRef e caricato direttamente (boothUpload) nello
  // stesso flusso di moderazione/storage della camera live. L'anteprima è solo
  // estetica (objectURL) e NON è richiesta per l'upload.
  const openFilePicker = () => fileInputRef.current?.click()

  const handleNativePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // consente di riselezionare lo stesso file
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('booth.notImage'))
      return
    }
    // Ferma qualsiasi stream/anteprima live: nessuna dipendenza da video/canvas.
    stopCamera()
    setCameraError(false)
    pendingFileRef.current = file
    try {
      setPhoto(URL.createObjectURL(file))
    } catch {
      // Anteprima non disponibile: l'upload funziona comunque.
      setPhoto('pending')
    }
  }

  const uploadPhoto = async () => {
    setUploading(true)
    try {
      // Fallback nativo: carica direttamente il File originale (no canvas).
      // Camera live: ricava il file dalla data-URL del canvas.
      let file: File
      if (pendingFileRef.current) {
        file = pendingFileRef.current
      } else if (photo && photo.startsWith('data:')) {
        const blob = await (await fetch(photo)).blob()
        file = new File([blob], 'booth-photo.jpg', { type: 'image/jpeg' })
      } else {
        setUploading(false)
        return
      }
      await livePhotos.boothUpload(slug!, file, {})
      toast.success(isWedding
        ? t('booth.uploadedWedding')
        : t('booth.uploadedParty'))
      if (photo && photo.startsWith('blob:')) URL.revokeObjectURL(photo)
      pendingFileRef.current = null
      setPhoto(null)
    } catch (err: any) {
      const msg = err?.message ?? t('booth.uploadError')
      if (msg.includes('Advance') || msg.includes('Pass') || msg.includes('sospese')) {
        toast.error(t('booth.uploadAccessError'))
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
              {photo === 'pending' ? (
                <div className="w-full aspect-square flex items-center justify-center bg-black/40 text-white/70 text-sm">
                  {t('booth.uploadPhoto')}
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={photo} alt="Preview" className="w-full h-auto" />
              )}
            </div>
            <div className="flex gap-3 flex-wrap justify-center">
              <PartyButton variant="ghost" onClick={retakePhoto} disabled={uploading} icon={<RotateCw className="h-5 w-5" />} size="lg">
                {t('booth.retake')}
              </PartyButton>
              <PartyButton variant="fuchsia" onClick={uploadPhoto} disabled={uploading} loading={uploading} icon={<Check className="h-5 w-5" />} size="lg">
                {t('booth.useThisPhoto')}
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
              <video ref={videoRef} autoPlay playsInline muted className={`w-full h-auto ${facingMode === 'user' ? 'mirror' : ''}`} />
              {countdown !== null && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm">
                  <p className="text-[#FF7AB6] text-2xl font-black tracking-[0.5em] uppercase mb-6 animate-pulse">
                    {t('booth.photoMoment')}
                  </p>
                  <p key={countdown} className="text-white text-[12rem] sm:text-[16rem] font-black leading-none drop-shadow-[0_0_40px_rgba(255,61,138,0.7)]">
                    {countdown}
                  </p>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleNativePhotoSelected}
              className="hidden"
            />
            <div className="flex gap-3 mt-6 flex-wrap justify-center">
              <PartyButton variant="ghost" onClick={stopCamera} icon={<X className="h-5 w-5" />} size="lg">
                {t('booth.close')}
              </PartyButton>
              <PartyButton variant="ghost" onClick={flipCamera} disabled={countdown !== null} icon={<RefreshCw className="h-5 w-5" />} size="lg">
                {t('booth.flip')}
              </PartyButton>
              <PartyButton
                variant="fuchsia"
                onClick={startPhotoMoment}
                disabled={countdown !== null}
                icon={<Camera className="h-5 w-5" />}
                size="lg"
              >
                {countdown !== null ? `${countdown}…` : t('booth.photoMoment')}
              </PartyButton>
            </div>
            <button
              onClick={openFilePicker}
              className="mt-4 inline-flex items-center gap-2 text-sm text-white/55 hover:text-[#FF7AB6] transition-colors"
            >
              <ImagePlus className="h-4 w-4" />
              {t('booth.uploadPhoto')}
            </button>
          </div>
          <style jsx global>{`.mirror { transform: scaleX(-1); }`}</style>
        </PartyShell>
      )
    }

    return (
      <PartyShell>
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center space-y-8 max-w-lg mx-auto py-12">
          <div className="flex justify-center">
            <LanguageSwitcher />
          </div>
          <div>
            <PartyEyebrow>✦ Live Booth ✦</PartyEyebrow>
            <h1 className="text-5xl sm:text-6xl font-black text-white mt-3 leading-tight">
              {session.event_name}
            </h1>
            <PartyDivider className="my-6" />
            <p className="text-base text-white/70">
              {isIOS ? (
                t('booth.iosIntro')
              ) : (
                <>
                  {t('booth.partyIntro1')}
                  <br />
                  {t('booth.partyIntro2')}
                </>
              )}
            </p>
          </div>

          <PartyCard tone="fuchsia" className="w-full">
            <div className="flex items-center justify-center gap-2 text-[#FF7AB6] mb-3">
              <Sparkles className="h-4 w-4" />
              <p className="text-[11px] uppercase tracking-[0.3em] font-semibold">{t('booth.howItWorks')}</p>
              <Sparkles className="h-4 w-4" />
            </div>
            <ol className="text-sm text-white/80 space-y-1.5 text-left list-decimal list-inside">
              <li>{t('booth.step1')}</li>
              <li>{t('booth.step2')} <span className="text-[#FF7AB6] font-bold">3… 2… 1</span></li>
              <li>{t('booth.step3')}</li>
              <li>{t('booth.step4')}</li>
            </ol>
          </PartyCard>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleNativePhotoSelected}
            className="hidden"
          />

          {cameraError && (
            <PartyCard tone="wine" className="w-full text-left">
              <div className="flex items-center gap-2 text-[#FF7AB6] mb-2">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-bold">{t('booth.cameraUnavailableTitle')}</p>
              </div>
              <p className="text-sm text-white/75 mb-4">{t('booth.cameraUnavailableText')}</p>
              <PartyButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />} size="lg" variant="fuchsia" className="w-full">
                {t('booth.uploadPhoto')}
              </PartyButton>
            </PartyCard>
          )}

          <div className="w-full space-y-3">
            {isIOS ? (
              <PartyButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />} size="lg" variant="fuchsia" className="w-full">
                {t('booth.uploadPhoto')}
              </PartyButton>
            ) : (
              <>
                <PartyButton onClick={() => startCamera()} icon={<Camera className="h-5 w-5" />} size="lg" variant="fuchsia" className="w-full">
                  {t('booth.openCamera')}
                </PartyButton>
                <PartyButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />} size="lg" variant="outline" className="w-full">
                  {t('booth.uploadPhoto')}
                </PartyButton>
                <p className="text-xs text-white/45">{t('booth.cameraHint')}</p>
              </>
            )}
            <p className="text-xs text-[#FF7AB6]/80">{t('booth.partyApprovalNote')}</p>
          </div>

          <Link
            href={`/live/${slug}`}
            className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.25em] text-white/50 hover:text-[#FF7AB6] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('booth.backToMain')}
          </Link>

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
            {photo === 'pending' ? (
              <div className="w-full aspect-square flex items-center justify-center bg-wedding-ink/10 text-wedding-taupe text-sm">
                {t('booth.uploadPhoto')}
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={photo} alt="Preview" className="w-full h-auto" />
            )}
          </div>
          <div className="flex gap-4">
            <WeddingButton onClick={retakePhoto} disabled={uploading} icon={<RotateCw className="h-5 w-5" />} size="lg">{t('booth.retake')}</WeddingButton>
            <WeddingButton onClick={uploadPhoto} disabled={uploading} loading={uploading} icon={<Check className="h-5 w-5" />} size="lg">{t('booth.send')}</WeddingButton>
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
            <video ref={videoRef} autoPlay playsInline muted className={`w-full h-auto ${facingMode === 'user' ? 'mirror' : ''}`} />
            {countdown !== null && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-wedding-ink/55 backdrop-blur-sm">
                <p className="font-wedding-great-vibes text-white text-5xl sm:text-6xl mb-2 animate-pulse drop-shadow-[0_2px_16px_rgba(0,0,0,0.85)]">
                  {t('booth.weddingPhotoMoment')}
                </p>
                <p key={countdown} className="font-wedding-cinzel text-white text-[10rem] sm:text-[14rem] font-normal leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
                  {countdown}
                </p>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleNativePhotoSelected}
            className="hidden"
          />
          <div className="flex gap-3 mt-6">
            <WeddingButton onClick={stopCamera} disabled={countdown !== null} icon={<X className="h-4 w-4" />} size="md">{t('booth.close')}</WeddingButton>
            <WeddingButton onClick={flipCamera} disabled={countdown !== null} icon={<RefreshCw className="h-4 w-4" />} size="md">{t('booth.flip')}</WeddingButton>
            <WeddingButton onClick={startPhotoMoment} disabled={countdown !== null} icon={<Camera className="h-4 w-4" />} size="md">
              {countdown !== null ? `${countdown}…` : t('booth.takePhoto')}
            </WeddingButton>
          </div>
          <button
            onClick={openFilePicker}
            className="mt-4 inline-flex items-center gap-2 text-sm text-wedding-taupe hover:text-wedding-burgundy transition-colors"
          >
            <ImagePlus className="h-4 w-4" />
            {t('booth.uploadPhoto')}
          </button>
        </div>
        <style jsx global>{`.mirror { transform: scaleX(-1); }`}</style>
      </WeddingShell>
    )
  }

  return (
    <WeddingShell>
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center space-y-8">
        <div className="flex justify-center">
          <LanguageSwitcher variant="light" />
        </div>
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
        <div className="max-w-md w-full">
          <p className="text-wedding-ink/70 mb-6">
            {isIOS ? t('booth.iosIntro') : t('booth.weddingIntro')}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleNativePhotoSelected}
            className="hidden"
          />

          {cameraError && (
            <div className="mb-6 rounded-2xl border border-wedding-gold/30 bg-[#FBEAF0] p-5 text-left shadow-wedding">
              <div className="flex items-center gap-2 text-wedding-burgundy mb-2">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-semibold">{t('booth.cameraUnavailableTitle')}</p>
              </div>
              <p className="text-sm text-wedding-ink/70 mb-4">{t('booth.cameraUnavailableText')}</p>
              <WeddingButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />} size="lg" className="w-full">
                {t('booth.uploadPhoto')}
              </WeddingButton>
            </div>
          )}

          <div className="space-y-3">
            {isIOS ? (
              <WeddingButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />} size="lg" className="w-full">
                {t('booth.uploadPhoto')}
              </WeddingButton>
            ) : (
              <>
                <WeddingButton onClick={() => startCamera()} icon={<Camera className="h-5 w-5" />} size="lg" className="w-full">
                  {t('booth.openCamera')}
                </WeddingButton>
                <WeddingButton onClick={openFilePicker} variant="outline" icon={<ImagePlus className="h-5 w-5" />} size="lg" className="w-full">
                  {t('booth.uploadPhoto')}
                </WeddingButton>
                <p className="text-xs text-wedding-taupe">{t('booth.cameraHint')}</p>
              </>
            )}
            <p className="text-xs text-wedding-burgundy/80">{t('booth.weddingApprovalNote')}</p>
          </div>
        </div>
        <Link
          href={`/live/${slug}`}
          className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.25em] text-wedding-taupe hover:text-wedding-burgundy transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('booth.backToMain')}
        </Link>
      </div>
    </WeddingShell>
  )
}
