'use client'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { useState, useRef, useEffect } from 'react'
import { Camera, X, RotateCw, Check, Sparkles, ArrowLeft, RefreshCw, ImagePlus, AlertTriangle } from 'lucide-react'
import { livePhotos } from '@/lib/api'
import { fetchPublicLive, isEventNotFound } from '@/lib/events/publicEventService'
import { GuestLoading, GuestLoadError } from '@/components/live/GuestLoadState'
import { useEventBrand } from '@/lib/events/useEventBrand'
import { compressImage } from '@/lib/imageCompress'
import { UPLOAD_ERROR_KEYS } from '@/lib/media/uploadErrors'
import { GuestMediaUploader } from '@/components/wedding/guest/GuestMediaUploader'
import {
  WeddingGuestShell, WeddingGuestPageTitle, WeddingGuestPanel, WeddingGuestButton, WeddingGuestHelper,
  WeddingGuestNotice, WeddingGuestBackLink, formatWeddingGuestDate, WEDDING_GUEST_TOAST,
} from '@/components/wedding/guest/WeddingGuestUI'
import {
  PartyShell, PartyButton, PartyCard, PartyEyebrow, PartyDivider,
} from '@/components/party/PartyUI'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useI18n } from '@/lib/i18n'
import { occasionText } from '@/lib/occasion'
import { guestAlbumClosure } from '@/lib/miolove/guestClosure'
import toast from 'react-hot-toast'

/** Server reasons of the photo callables → translated guest message (the server texts are not localized). */
const REASON_KEYS = UPLOAD_ERROR_KEYS

export default function LiveBoothPage() {
  const { t, locale } = useI18n()
  const { slug } = useParams<{ slug: string }>()
  const { data, error, mutate: reload } = useSWR(
    slug ? ['public-live', slug] : null,
    () => fetchPublicLive(slug!),
    { refreshInterval: 30_000 },
  )
  const wdToast = () => (data?.session.session_type === 'wedding' ? WEDDING_GUEST_TOAST : undefined)
  // Live Booth is a MIOLOVE album feature: an IOMIXO event (Party, standard, Wedding DJ) never opens it.
  const brand = useEventBrand(slug, data?.session.session_type)

  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [uploadFailed, setUploadFailed] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingFileRef = useRef<File | null>(null)
  // Resize/compress starts as soon as the photo is picked, so "send" only pays for the network.
  const preparedRef = useRef<Promise<File> | null>(null)
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
    if (slug) livePhotos.warmUpload(slug)      // anonymous session + event id ready before the first photo
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
        toast.error(t('booth.cameraDenied'), wdToast())
      }
    }, 2000)

    return () => {
      video.onloadedmetadata = null
      if (watchdogTimer.current) clearTimeout(watchdogTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive])

  if (!error && !data) {
    return <PartyShell><div className="min-h-screen flex items-center justify-center px-6"><GuestLoading onRetry={() => { void reload() }} /></div></PartyShell>
  }
  if (error && !data && !isEventNotFound(error)) {
    return <PartyShell><div className="min-h-screen flex items-center justify-center px-6"><GuestLoadError onRetry={() => { void reload() }} /></div></PartyShell>
  }
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
  // MIOLOVE album: occasion-aware copy, no MIOLOVE mark once activated (paid), uploads closed once the 7-day trial is over (server flag or end instant).
  const isAlbum = brand === 'miolove'
  const whiteLabel = isAlbum && session.access_mode === 'activated'
  const closure = guestAlbumClosure(session, isAlbum)
  const trialExpired = closure.closed

  if (brand === undefined) {
    return <PartyShell><div className="min-h-screen" /></PartyShell>
  }
  if (brand === 'iomixo') {
    return (
      <PartyShell>
        <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
          <p className="text-white/70">{t('booth.notAvailable')}</p>
          <Link href={`/live/${slug}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:border-[#FF2D8D]/60">
            <ArrowLeft className="h-4 w-4" /> {t('booth.backToMain')}
          </Link>
        </div>
      </PartyShell>
    )
  }

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
      <WeddingGuestShell whiteLabel={whiteLabel} languageSlot={<LanguageSwitcher variant="wedding" />}>
        <WeddingGuestNotice tone="info">{t('booth.sessionEnded')}</WeddingGuestNotice>
        <div className="flex justify-center"><WeddingGuestBackLink href={`/live/${slug}`} label={t('booth.backToMain')} /></div>
      </WeddingGuestShell>
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
        toast.error(t('booth.cameraHttps'), wdToast())
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
      toast.error(t('booth.cameraDenied'), wdToast())
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
      toast.error(t('booth.flipError'), wdToast())
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
    grd.addColorStop(0, '#FF2D8D')
    grd.addColorStop(1, '#E9207C')
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

    ctx.fillStyle = '#FF2D8D'
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
    setUploadFailed(false)
    canvas.toBlob((blob) => { if (blob) prepareFile(new File([blob], 'booth-photo.jpg', { type: 'image/jpeg' })) }, 'image/jpeg', 0.9)
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
    setUploadFailed(false)
    preparedRef.current = null
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

  // MIOLOVE album: the ORIGINAL is uploaded as it is (the derived copies are made inside the upload). Only a non-album event still pre-compresses.
  const prepareFile = (file: File) => {
    if (isAlbum) return
    preparedRef.current = compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.82 })
  }

  const handleNativePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // consente di riselezionare lo stesso file
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('booth.notImage'), wdToast())
      return
    }
    // Ferma qualsiasi stream/anteprima live: nessuna dipendenza da video/canvas.
    stopCamera()
    setCameraError(false)
    pendingFileRef.current = file
    setUploadFailed(false)
    prepareFile(file)
    try {
      setPhoto(URL.createObjectURL(file))
    } catch {
      // Anteprima non disponibile: l'upload funziona comunque.
      setPhoto('pending')
    }
  }

  const uploadPhoto = async () => {
    setUploading(true)
    setUploadPct(0)
    try {
      // Fallback nativo: carica direttamente il File originale (no canvas).
      // Camera live: ricava il file dalla data-URL del canvas.
      let optimized: File
      if (preparedRef.current) {
        optimized = await preparedRef.current
      } else {
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
        // Album: the original goes up untouched. Other events: resize/compress client-side (8/12 MB phone files); defensive, on failure the original is used.
        optimized = isAlbum ? file : await compressImage(file, { maxWidth: 1920, maxHeight: 1920, quality: 0.82 })
      }
      await livePhotos.boothUpload(slug!, optimized, {}, setUploadPct, { album: isAlbum })
      toast.success(isWedding
        ? t('booth.uploadedWedding')
        : t('booth.uploadedParty'), isWedding ? WEDDING_GUEST_TOAST : undefined)
      if (photo && photo.startsWith('blob:')) URL.revokeObjectURL(photo)
      pendingFileRef.current = null
      preparedRef.current = null
      setPhoto(null)
    } catch (err: any) {
      setUploadFailed(true)
      const msg = err?.message ?? t('booth.uploadError')
      const known = REASON_KEYS[err?.reason as string]
      if (known) {
        toast.error(t(known), isWedding ? WEDDING_GUEST_TOAST : undefined)
      } else if (msg.includes('Advance') || msg.includes('Pass') || msg.includes('sospese')) {
        toast.error(t('booth.uploadAccessError'), isWedding ? WEDDING_GUEST_TOAST : undefined)
      } else {
        toast.error(msg, isWedding ? WEDDING_GUEST_TOAST : undefined)
      }
    } finally { setUploading(false) }
  }

  // ─── PARTY UI ────────────────────────────────────────────────
  if (isParty) {
    if (photo) {
      return (
        <PartyShell>
          <div className="min-h-screen flex flex-col items-center justify-center p-6 space-y-6">
            <div className="relative max-w-2xl w-full rounded-3xl overflow-hidden ring-2 ring-[#FF2D8D]/40">
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
            <div className="relative max-w-2xl w-full rounded-3xl overflow-hidden ring-2 ring-[#FF2D8D]/40">
              <video ref={videoRef} autoPlay playsInline muted className={`w-full h-auto ${facingMode === 'user' ? 'mirror' : ''}`} />
              {countdown !== null && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm">
                  <p className="text-[#FF2D8D] text-2xl font-black tracking-[0.5em] uppercase mb-6 animate-pulse">
                    {t('booth.photoMoment')}
                  </p>
                  <p key={countdown} className="text-white text-[12rem] sm:text-[16rem] font-black leading-none drop-">
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
              className="mt-4 inline-flex items-center gap-2 text-sm text-white/55 hover:text-[#FF2D8D] transition-colors"
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
            <div className="flex items-center justify-center gap-2 text-[#FF2D8D] mb-3">
              <Sparkles className="h-4 w-4" />
              <p className="text-[11px] uppercase tracking-[0.3em] font-semibold">{t('booth.howItWorks')}</p>
              <Sparkles className="h-4 w-4" />
            </div>
            <ol className="text-sm text-white/80 space-y-1.5 text-left list-decimal list-inside">
              <li>{t('booth.step1')}</li>
              <li>{t('booth.step2')} <span className="text-[#FF2D8D] font-bold">3… 2… 1</span></li>
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
              <div className="flex items-center gap-2 text-[#FF2D8D] mb-2">
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
            <p className="text-xs text-[#FF2D8D]/80">{t('booth.partyApprovalNote')}</p>
          </div>

          <Link
            href={`/live/${slug}`}
            className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.25em] text-white/50 hover:text-[#FF2D8D] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('booth.backToMain')}
          </Link>

          <p className="text-[10px] uppercase tracking-[0.32em] text-white/30">
            Powered by <span className="text-[#FF2D8D]">IOMIXO Live Hub</span>
          </p>
        </div>
      </PartyShell>
    )
  }

  // ─── WEDDING UI ──────────────────────────────────────────────
  const names = session.couple_names ?? session.event_name
  const weddingDate = formatWeddingGuestDate(session.wedding_date, locale)
  const languageSlot = <LanguageSwitcher variant="wedding" />
  const frame = 'overflow-hidden rounded-[20px] border border-wd-border bg-white'

  if (trialExpired) {
    return (
      <WeddingGuestShell whiteLabel={whiteLabel} languageSlot={languageSlot}>
        <WeddingGuestPageTitle eyebrow="Live Booth" title={names} />
        <div data-testid="booth-trial-ended"><WeddingGuestNotice tone="info">{t(closure.key ?? 'guestAlbum.trialEnded')}</WeddingGuestNotice></div>
        <div className="flex justify-center"><WeddingGuestBackLink href={`/live/${slug}`} label={t('booth.backToMain')} /></div>
      </WeddingGuestShell>
    )
  }

  // The owner switched "guest photo upload" off (the QR points here, so this page must honour it too; the server refuses the upload as well).
  if (isAlbum && (session.guest_config as Record<string, unknown> | null | undefined)?.live_booth === false) {
    return (
      <WeddingGuestShell whiteLabel={whiteLabel} languageSlot={languageSlot}>
        <WeddingGuestPageTitle eyebrow="Live Booth" title={names} />
        <div data-testid="booth-uploads-off"><WeddingGuestNotice tone="info">{t('guestAlbum.photosOff')}</WeddingGuestNotice></div>
        <div className="flex justify-center"><WeddingGuestBackLink href={`/live/${slug}`} label={t('booth.backToMain')} /></div>
      </WeddingGuestShell>
    )
  }

  if (photo) {
    return (
      <WeddingGuestShell whiteLabel={whiteLabel} languageSlot={languageSlot}>
        <WeddingGuestPageTitle eyebrow="Live Booth" title={names} />
        <div className={`${frame} p-2`}>
          {photo === 'pending' ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-wd-active text-[15px] text-wd-muted">
              {t('booth.uploadPhoto')}
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={photo} alt="Preview" className="h-auto w-full rounded-2xl" />
          )}
        </div>
        <div className="mt-5 space-y-3">
          <WeddingGuestButton onClick={uploadPhoto} disabled={uploading} loading={uploading} icon={<Check className="h-5 w-5" />}>{uploading ? `${t('booth.sendingPhoto')}${uploadPct > 0 ? ` ${uploadPct}%` : ''}` : uploadFailed ? t('booth.retryUpload') : t('booth.send')}</WeddingGuestButton>
          <WeddingGuestButton variant="secondary" onClick={retakePhoto} disabled={uploading} icon={<RotateCw className="h-5 w-5" />}>{t('booth.retake')}</WeddingGuestButton>
        </div>
      </WeddingGuestShell>
    )
  }

  if (cameraActive) {
    return (
      <WeddingGuestShell whiteLabel={whiteLabel} languageSlot={languageSlot}>
        <WeddingGuestPageTitle eyebrow="Live Booth" title={names} />
        <div className={`relative ${frame}`}>
          <video ref={videoRef} autoPlay playsInline muted className={`h-auto w-full ${facingMode === 'user' ? 'mirror' : ''}`} />
          {countdown !== null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-wd-ink/55 backdrop-blur-sm">
              <p className="mb-2 animate-pulse text-[20px] font-semibold text-white">{t('booth.weddingPhotoMoment')}</p>
              <p key={countdown} className="text-[9rem] font-bold leading-none text-white">{countdown}</p>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleNativePhotoSelected} className="hidden" />
        <div className="mt-5 space-y-3">
          <WeddingGuestButton onClick={startPhotoMoment} disabled={countdown !== null} icon={<Camera className="h-5 w-5" />}>
            {countdown !== null ? `${countdown}…` : t('booth.takePhoto')}
          </WeddingGuestButton>
          <div className="grid grid-cols-2 gap-3">
            <WeddingGuestButton variant="secondary" onClick={flipCamera} disabled={countdown !== null} icon={<RefreshCw className="h-4 w-4" />}>{t('booth.flip')}</WeddingGuestButton>
            <WeddingGuestButton variant="secondary" onClick={stopCamera} disabled={countdown !== null} icon={<X className="h-4 w-4" />}>{t('booth.close')}</WeddingGuestButton>
          </div>
          <button type="button" onClick={openFilePicker} className="mx-auto flex min-h-[44px] items-center gap-2 text-[15px] font-semibold text-wd-pink hover:text-wd-pink-hover">
            <ImagePlus className="h-4 w-4" />
            {t('booth.uploadPhoto')}
          </button>
        </div>
        <style jsx global>{`.mirror { transform: scaleX(-1); }`}</style>
      </WeddingGuestShell>
    )
  }

  return (
    <WeddingGuestShell whiteLabel={whiteLabel} languageSlot={languageSlot}>
      <WeddingGuestPageTitle eyebrow="Live Booth" title={names} subtitle={weddingDate ?? undefined} />
      <WeddingGuestPanel>
        <p className="mb-5 text-center text-[16px] leading-snug text-wd-muted">
          {isIOS ? t('booth.iosIntro') : isAlbum ? occasionText(t, session.occasion_type, 'boothIntro') : t('booth.weddingIntro')}
        </p>

        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleNativePhotoSelected} className="hidden" />

        {cameraError && (
          <div className="mb-5">
            <WeddingGuestNotice
              tone="error"
              title={t('booth.cameraUnavailableTitle')}
              action={isAlbum ? undefined : <WeddingGuestButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />}>{t('booth.uploadPhoto')}</WeddingGuestButton>}
            >
              {t('booth.cameraUnavailableText')}
            </WeddingGuestNotice>
          </div>
        )}

        {isAlbum ? (
          // MIOLOVE album: photos AND videos, several at once, original quality. The camera stays for a quick single photo (not on iOS: its picker already offers it).
          <div className="space-y-5">
            {!isIOS && (
              <WeddingGuestButton variant="secondary" onClick={() => startCamera()} icon={<Camera className="h-5 w-5" />}>{t('booth.openCamera')}</WeddingGuestButton>
            )}
            <GuestMediaUploader slug={slug!} />
            <WeddingGuestHelper tone="pink">{t('booth.weddingApprovalNote')}</WeddingGuestHelper>
          </div>
        ) : (
        <div className="space-y-3">
          {isIOS ? (
            <WeddingGuestButton onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />}>{t('booth.uploadPhoto')}</WeddingGuestButton>
          ) : (
            <>
              <WeddingGuestButton onClick={() => startCamera()} icon={<Camera className="h-5 w-5" />}>{t('booth.openCamera')}</WeddingGuestButton>
              <WeddingGuestButton variant="secondary" onClick={openFilePicker} icon={<ImagePlus className="h-5 w-5" />}>{t('booth.uploadPhoto')}</WeddingGuestButton>
              <WeddingGuestHelper>{t('booth.cameraHint')}</WeddingGuestHelper>
            </>
          )}
          <WeddingGuestHelper tone="pink">{t('booth.weddingApprovalNote')}</WeddingGuestHelper>
        </div>
        )}
      </WeddingGuestPanel>
      <div className="flex justify-center">
        <WeddingGuestBackLink href={`/live/${slug}`} label={t('booth.backToMain')} />
      </div>
    </WeddingGuestShell>
  )
}
