'use client'

// ════════════════════════════════════════════════════════════════
// IOMIXO — Wedding Edition · Proclamazione Vincitore (pannello DJ)
// Sezione "Strumenti finali". NON è un gioco: il DJ carica le foto degli
// sposi, sceglie MANUALMENTE il vincitore e proclama sul Wedding Screen.
//
// Persistenza:
// - Config → `screen_config.winner_announcement` (JSONB, nessuna migration).
// - Foto  → bucket privato `wedding-photos` via `/photos/init` (già
//   esistente). Nessuna riga in `live_photos` → le foto NON compaiono
//   nell'album ospiti né sul Live Booth Screen.
// - Signed URLs per l'anteprima → `liveScreen.get(slug)` (già in uso,
//   rigenera signed URLs ogni chiamata, TTL 1h).
// - Pulizia dei file sostituiti → gestita lato backend nel PATCH
//   `/api/live/sessions/:id` (confronta i vecchi path e cancella).
//
// Idempotenza dell'animazione:
// - `run_id` nuovo SOLO su "Avvia proclamazione".
// - `started_at` = now al momento di Avvia → lo Screen calcola l'elapsed.
// ════════════════════════════════════════════════════════════════

import { useMemo, useRef, useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import toast from 'react-hot-toast'
import { Award, Play, StopCircle, EyeOff, RotateCw, Upload, Trash2, Loader2 } from 'lucide-react'
import {
  live, livePhotos, liveScreen,
  type WinnerAnnouncementConfig,
  type WinnerAnnouncementRole,
} from '@/lib/api'
import { WeddingCard, WeddingButton, WeddingInput } from '@/components/wedding/WeddingUI'
import { useI18n } from '@/lib/i18n'
import { compressImage } from '@/lib/imageCompress'

const newRunId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

function defaultWinnerConfig(): WinnerAnnouncementConfig {
  return {
    phase: 'hidden',
    run_id: null,
    winner: null,
    groom_photo_path: null,
    bride_photo_path: null,
    groom_name: null,
    bride_name: null,
    started_at: null,
    updated_at: new Date(0).toISOString(),
  }
}

function normalizeWinnerConfig(raw: any): WinnerAnnouncementConfig {
  const base = defaultWinnerConfig()
  if (!raw || typeof raw !== 'object') return base
  const phases: WinnerAnnouncementConfig['phase'][] = ['hidden', 'running', 'revealed', 'stopped']
  const winners: WinnerAnnouncementRole[] = ['groom', 'bride']
  return {
    phase: phases.includes(raw.phase) ? raw.phase : 'hidden',
    run_id: typeof raw.run_id === 'string' ? raw.run_id : null,
    winner: winners.includes(raw.winner) ? raw.winner : null,
    groom_photo_path: typeof raw.groom_photo_path === 'string' ? raw.groom_photo_path : null,
    bride_photo_path: typeof raw.bride_photo_path === 'string' ? raw.bride_photo_path : null,
    groom_name: typeof raw.groom_name === 'string' && raw.groom_name.trim() ? raw.groom_name : null,
    bride_name: typeof raw.bride_name === 'string' && raw.bride_name.trim() ? raw.bride_name : null,
    started_at: typeof raw.started_at === 'string' ? raw.started_at : null,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date(0).toISOString(),
  }
}

interface Props {
  sessionId: string
}

export function WinnerAnnouncementPanel({ sessionId }: Props) {
  const { t } = useI18n()
  const { data: session, mutate: mutateSession } = useSWR(
    ['session', sessionId],
    () => live.getSession(sessionId),
  )
  const slug = session?.public_slug ?? null

  // Signed URLs delle foto sposo/sposa: le prendiamo dal payload pubblico
  // dello Screen (già arricchito dal backend). Refresh su richiesta dopo
  // ogni upload/save. Non pollato per non aggiungere carico API.
  const { data: screenPayload, mutate: mutateScreen } = useSWR(
    slug ? ['screen-preview', slug] : null,
    () => liveScreen.get(slug!),
  )

  const cfg = useMemo(
    () => normalizeWinnerConfig(session?.screen_config?.winner_announcement),
    [session?.screen_config?.winner_announcement],
  )

  const [groomNameDraft, setGroomNameDraft] = useState<string>('')
  const [brideNameDraft, setBrideNameDraft] = useState<string>('')
  // Sync draft names dai valori server (una volta all'arrivo).
  const syncedRef = useRef(false)
  if (session && !syncedRef.current) {
    syncedRef.current = true
    setGroomNameDraft(cfg.groom_name ?? '')
    setBrideNameDraft(cfg.bride_name ?? '')
  }

  // Anteprima locale immediata durante l'upload (ObjectURL del File selezionato).
  const [localPreview, setLocalPreview] = useState<{ groom?: string; bride?: string }>({})
  const [uploading, setUploading] = useState<{ groom?: boolean; bride?: boolean }>({})
  const [busy, setBusy] = useState(false)

  const groomServerUrl = (screenPayload?.session?.screen_config as any)?.winner_announcement?.groom_photo_url ?? null
  const brideServerUrl = (screenPayload?.session?.screen_config as any)?.winner_announcement?.bride_photo_url ?? null
  const groomPreviewUrl = localPreview.groom ?? groomServerUrl ?? null
  const bridePreviewUrl = localPreview.bride ?? brideServerUrl ?? null

  // ── Persistenza ────────────────────────────────────────────
  const persist = async (next: WinnerAnnouncementConfig, successToast?: string) => {
    if (!session) return
    setBusy(true)
    try {
      const currentScreenConfig = (session.screen_config as Record<string, unknown> | null | undefined) ?? {}
      await live.updateSession(sessionId, {
        screen_config: {
          ...currentScreenConfig,
          winner_announcement: {
            ...next,
            updated_at: new Date().toISOString(),
          },
        } as any,
      })
      await mutateSession()
      await mutateScreen()
      if (successToast) toast.success(successToast)
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  // ── Upload foto (sposo/sposa) ───────────────────────────────
  const handleUpload = async (role: WinnerAnnouncementRole, file: File) => {
    if (!slug) return
    if (!file.type.startsWith('image/')) {
      toast.error(t('weddingPanels.winnerInvalidFile'))
      return
    }
    // Preview locale immediata
    const objectUrl = URL.createObjectURL(file)
    setLocalPreview((s) => ({ ...s, [role]: objectUrl }))
    setUploading((s) => ({ ...s, [role]: true }))
    try {
      const compressed = await compressImage(file, { maxWidth: 1400, maxHeight: 1400, quality: 0.85 })
      const { storage_path } = await livePhotos.winnerUploadPhoto(slug, compressed)
      // Salva il path e resetta la fase (il vecchio file viene rimosso dal backend).
      await persist({
        ...cfg,
        [role === 'groom' ? 'groom_photo_path' : 'bride_photo_path']: storage_path,
        phase: 'hidden',
        run_id: null,
        started_at: null,
      }, t('weddingPanels.winnerPhotoUploaded'))
      // Refresh signed URLs, poi rilascia l'ObjectURL locale.
      await mutateScreen()
      setLocalPreview((s) => {
        if (s[role]) URL.revokeObjectURL(s[role]!)
        return { ...s, [role]: undefined }
      })
    } catch (e: any) {
      toast.error(e?.message ?? t('common.errorGeneric'))
      // In caso di errore, mantieni il preview locale così l'utente vede cosa aveva scelto.
    } finally {
      setUploading((s) => ({ ...s, [role]: false }))
    }
  }

  const handleRemove = async (role: WinnerAnnouncementRole) => {
    // Il path viene azzerato: il backend cancella il file dal bucket.
    await persist({
      ...cfg,
      [role === 'groom' ? 'groom_photo_path' : 'bride_photo_path']: null,
      phase: 'hidden',
      run_id: null,
      started_at: null,
    }, t('weddingPanels.winnerPhotoRemoved'))
  }

  const handleSaveNames = async () => {
    await persist({
      ...cfg,
      groom_name: groomNameDraft.trim() || null,
      bride_name: brideNameDraft.trim() || null,
    }, t('weddingPanels.updated'))
  }

  const handleSelectWinner = async (role: WinnerAnnouncementRole) => {
    await persist({ ...cfg, winner: role })
  }

  // ── Azioni proclamazione ─────────────────────────────────────
  const canStart = !!cfg.groom_photo_path && !!cfg.bride_photo_path && !!cfg.winner

  const handleStart = async () => {
    if (!cfg.groom_photo_path || !cfg.bride_photo_path) {
      toast.error(t('weddingPanels.winnerNeedPhotos'))
      return
    }
    if (!cfg.winner) {
      toast.error(t('weddingPanels.winnerNeedChoice'))
      return
    }
    await persist({
      ...cfg,
      phase: 'running',
      run_id: newRunId(),
      started_at: new Date().toISOString(),
    }, t('weddingPanels.winnerStarted'))
  }

  const handleStop = async () => {
    // Interrompi = ferma la suspense SENZA proclamare. Non completa il reveal.
    await persist({ ...cfg, phase: 'stopped' }, t('weddingPanels.winnerStopped'))
  }

  const handleHide = async () => {
    // Nascondi = overlay via dallo Screen. La configurazione (foto, nomi,
    // vincitore) resta salvata per un riuso rapido.
    await persist({ ...cfg, phase: 'hidden' }, t('weddingPanels.winnerHidden'))
  }

  const handleReset = async () => {
    // Ripristina = torna allo stato "pronto per un nuovo utilizzo": overlay
    // nascosto, vincitore azzerato. Le foto restano (riutilizzabili). Se il
    // DJ vuole cambiare le foto, usa "Rimuovi" per singola foto.
    await persist({
      ...cfg,
      phase: 'hidden',
      winner: null,
      run_id: null,
      started_at: null,
    }, t('weddingPanels.winnerResetDone'))
  }

  const phaseLabel: Record<WinnerAnnouncementConfig['phase'], string> = {
    hidden: t('weddingPanels.winnerPhaseHidden'),
    running: t('weddingPanels.winnerPhaseRunning'),
    revealed: t('weddingPanels.winnerPhaseRevealed'),
    stopped: t('weddingPanels.winnerPhaseStopped'),
  }

  return (
    <section className="mt-8">
      {/* Header sezione "Strumenti finali" (contenitore separato dai giochi) */}
      <header className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#8F1D2C] font-semibold mb-2">
          {t('weddingPanels.finalToolsEyebrow')}
        </p>
        <h2 className="font-wedding text-2xl text-[#2B2424] leading-tight">
          {t('weddingPanels.finalToolsTitle')}
        </h2>
        <p className="text-xs text-[#6F6260] mt-1">{t('weddingPanels.finalToolsHint')}</p>
      </header>

      <WeddingCard tone="ivory" className="!p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-[#FBEAF0] border border-[#E8B7C8] flex items-center justify-center shrink-0">
            <Award className="h-5 w-5 text-[#8F1D2C]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#2B2424] tracking-tight">
              {t('weddingPanels.winnerName')}
            </h3>
            <p className="text-xs text-[#6F6260] mt-0.5">{t('weddingPanels.winnerSubtitle')}</p>
          </div>
        </div>

        {/* Nomi opzionali (fallback su couple_names) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-[11px] uppercase tracking-[0.24em] text-[#6F6260] mb-1 block">
              {t('weddingPanels.winnerGroomName')}
            </label>
            <WeddingInput
              value={groomNameDraft}
              onChange={(e) => setGroomNameDraft(e.target.value)}
              placeholder={t('weddingPanels.winnerGroomNamePlaceholder')}
              maxLength={40}
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.24em] text-[#6F6260] mb-1 block">
              {t('weddingPanels.winnerBrideName')}
            </label>
            <WeddingInput
              value={brideNameDraft}
              onChange={(e) => setBrideNameDraft(e.target.value)}
              placeholder={t('weddingPanels.winnerBrideNamePlaceholder')}
              maxLength={40}
            />
          </div>
        </div>
        <div className="flex justify-end mb-6">
          <WeddingButton
            variant="ghost"
            size="sm"
            onClick={handleSaveNames}
            disabled={busy}
          >
            {t('weddingPanels.winnerSaveNames')}
          </WeddingButton>
        </div>

        {/* Foto sposo/sposa affiancate */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
          <PhotoSlot
            role="groom"
            label={t('weddingPanels.winnerGroomPhoto')}
            previewUrl={groomPreviewUrl}
            uploading={!!uploading.groom}
            hasPath={!!cfg.groom_photo_path}
            disabled={busy}
            uploadLabel={t('weddingPanels.winnerUploadPhoto')}
            replaceLabel={t('weddingPanels.winnerReplacePhoto')}
            removeLabel={t('weddingPanels.winnerRemovePhoto')}
            emptyLabel={t('weddingPanels.winnerNoPhoto')}
            onFile={(f) => handleUpload('groom', f)}
            onRemove={() => handleRemove('groom')}
          />
          <PhotoSlot
            role="bride"
            label={t('weddingPanels.winnerBridePhoto')}
            previewUrl={bridePreviewUrl}
            uploading={!!uploading.bride}
            hasPath={!!cfg.bride_photo_path}
            disabled={busy}
            uploadLabel={t('weddingPanels.winnerUploadPhoto')}
            replaceLabel={t('weddingPanels.winnerReplacePhoto')}
            removeLabel={t('weddingPanels.winnerRemovePhoto')}
            emptyLabel={t('weddingPanels.winnerNoPhoto')}
            onFile={(f) => handleUpload('bride', f)}
            onRemove={() => handleRemove('bride')}
          />
        </div>

        {/* Selezione manuale del vincitore */}
        <fieldset className="mb-6">
          <legend className="text-xs uppercase tracking-[0.24em] text-[#6F6260] mb-2">
            {t('weddingPanels.winnerSelectWinner')}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <WinnerChoice
              active={cfg.winner === 'groom'}
              disabled={busy || !cfg.groom_photo_path}
              onClick={() => handleSelectWinner('groom')}
            >
              {t('weddingPanels.winnerGroom')}
            </WinnerChoice>
            <WinnerChoice
              active={cfg.winner === 'bride'}
              disabled={busy || !cfg.bride_photo_path}
              onClick={() => handleSelectWinner('bride')}
            >
              {t('weddingPanels.winnerBride')}
            </WinnerChoice>
          </div>
        </fieldset>

        {/* Stato + azioni */}
        <div className="flex items-center justify-between text-xs text-[#6F6260] mb-3">
          <span className="uppercase tracking-[0.24em]">
            {t('weddingPanels.winnerStatus')}:{' '}
            <span className="normal-case tracking-normal text-[#2B2424]">{phaseLabel[cfg.phase]}</span>
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <WeddingButton
            variant="gold"
            onClick={handleStart}
            disabled={busy || !canStart}
            icon={<Play className="h-4 w-4" />}
          >
            {t('weddingPanels.winnerStart')}
          </WeddingButton>
          <WeddingButton
            variant="outline"
            onClick={handleStop}
            disabled={busy || cfg.phase !== 'running'}
            icon={<StopCircle className="h-4 w-4" />}
          >
            {t('weddingPanels.winnerStop')}
          </WeddingButton>
          <WeddingButton
            variant="outline"
            onClick={handleHide}
            disabled={busy || cfg.phase === 'hidden'}
            icon={<EyeOff className="h-4 w-4" />}
          >
            {t('weddingPanels.winnerHide')}
          </WeddingButton>
          <WeddingButton
            variant="ghost"
            onClick={handleReset}
            disabled={busy}
            icon={<RotateCw className="h-4 w-4" />}
          >
            {t('weddingPanels.winnerReset')}
          </WeddingButton>
        </div>

        {!canStart && (
          <p className="text-[11px] text-[#6F6260] mt-3">
            {t(!cfg.groom_photo_path || !cfg.bride_photo_path
              ? 'weddingPanels.winnerNeedPhotos'
              : 'weddingPanels.winnerNeedChoice')}
          </p>
        )}
      </WeddingCard>
    </section>
  )
}

// ── Sub-componenti ──────────────────────────────────────────────

function PhotoSlot({
  role,
  label,
  previewUrl,
  uploading,
  hasPath,
  disabled,
  uploadLabel,
  replaceLabel,
  removeLabel,
  emptyLabel,
  onFile,
  onRemove,
}: {
  role: WinnerAnnouncementRole
  label: string
  previewUrl: string | null
  uploading: boolean
  hasPath: boolean
  disabled: boolean
  uploadLabel: string
  replaceLabel: string
  removeLabel: string
  emptyLabel: string
  onFile: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="rounded-2xl border border-[#E8B7C8] bg-white/60 p-4 flex flex-col items-center gap-3">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[#8F1D2C] font-semibold">{label}</p>
      <div className="relative w-full aspect-[3/4] rounded-xl overflow-hidden bg-[#FBEAF0] border border-[#E8B7C8]">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={label} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[11px] uppercase tracking-[0.24em] text-[#B8A89A] px-4 text-center">
            {emptyLabel}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-[#8F1D2C] animate-spin" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          // Reset per permettere di ricaricare lo stesso file
          e.target.value = ''
        }}
      />
      <div className="flex gap-2 w-full">
        <WeddingButton
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          icon={<Upload className="h-3.5 w-3.5" />}
        >
          {hasPath ? replaceLabel : uploadLabel}
        </WeddingButton>
        {hasPath && (
          <WeddingButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled || uploading}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            aria-label={removeLabel}
          >
            {removeLabel}
          </WeddingButton>
        )}
      </div>
    </div>
  )
}

function WinnerChoice({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border-2 px-4 py-3 text-sm uppercase tracking-[0.16em] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? 'bg-[#F3DCE3] border-[#8F1D2C] text-[#8F1D2C] shadow-wedding'
          : 'bg-white border-[#E8B7C8] text-[#6F6260] hover:border-[#8F1D2C] hover:text-[#2B2424]'
      }`}
    >
      {children}
    </button>
  )
}
// Silence unused-imports warning (react used implicitly in JSX above).
void globalMutate
