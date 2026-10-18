'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { Download, RotateCcw, Save } from 'lucide-react'
import { live } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  BODY_FONTS, POSTER_FORMATS, POSTER_PRESETS, POSTER_SIZES_MM, POSTER_TEXT_MAX, SCRIPT_FONTS, TITLE_FONTS, TITLE_SIZES,
  asOccasion, posterFileName, resolvePoster, sanitizeOverrides,
  type PosterConfig, type PosterOverrides, type PosterTextField,
} from '@/lib/poster/posterConfig'
import { qrModulesFromSvg, type QrModules } from '@/lib/poster/qr'
import { drawPoster, ensurePosterFonts } from '@/lib/poster/renderPoster'
import { buildPdf } from '@/lib/poster/pdf'
import { WdPage, WdCard, WdButton, WdField, WdInput, WdSelect, WdPills } from './WeddingAdminUI'
import { publicOrigin } from './WeddingHomePage'

const FONT_NAMES: Record<string, string> = {
  playfair: 'Playfair Display', cormorant: 'Cormorant', cinzel: 'Cinzel', inter: 'Inter',
  greatVibes: 'Great Vibes', dancing: 'Dancing Script', tangerine: 'Tangerine',
}
const TEXT_FIELDS: PosterTextField[] = ['title1', 'title2', 'title3', 'instruction1', 'instruction2', 'displayName', 'displayDate']
const PREVIEW_PX = 1000          // preview canvas width; the PDF is drawn at 300 dpi
const PDF_DPI = 300

/** MIOLOVE table sign editor: live preview on the right, simple controls on the left, saved overrides + one-click PDF. */
export function MiolovePosterEditor({ session }: { session: any }) {
  const { t, locale } = useI18n()
  const url = `${publicOrigin()}/live/${session.public_slug}`
  const saved = useMemo(() => sanitizeOverrides(session.poster_config), [session.poster_config])
  const [overrides, setOverrides] = useState<PosterOverrides>(saved)
  const [baseline, setBaseline] = useState<string>(JSON.stringify(saved))
  const [saving, setSaving] = useState(false), [pdfBusy, setPdfBusy] = useState(false)
  const [qr, setQr] = useState<QrModules | null>(null)
  const qrHost = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), drawSeq = useRef(0)

  // The session id is the only reason to throw local edits away (a polled refresh of the same album must not).
  const sessionId: string = session.id
  useEffect(() => { setOverrides(saved); setBaseline(JSON.stringify(saved)) }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const cfg: PosterConfig = useMemo(() => resolvePoster(overrides, { occasion: asOccasion(session.occasion_type), locale, eventName: session.event_name ?? '', eventDate: session.wedding_date }), [overrides, locale, session.occasion_type, session.event_name, session.wedding_date])
  const dirty = JSON.stringify(overrides) !== baseline
  const hasCustom = Object.keys(overrides).some((k) => k !== 'format')

  useEffect(() => { setQr(qrModulesFromSvg(qrHost.current?.innerHTML ?? '')) }, [url])

  const size = POSTER_SIZES_MM[cfg.format]
  const previewH = Math.round((PREVIEW_PX * size.h) / size.w)
  useEffect(() => {
    if (!qr || !canvas.current) return
    const seq = ++drawSeq.current
    ensurePosterFonts(cfg).then(() => {
      if (seq !== drawSeq.current || !canvas.current) return
      const ctx = canvas.current.getContext('2d'); if (!ctx) return
      drawPoster(ctx, cfg, qr, PREVIEW_PX, previewH)
      canvas.current.dataset.drawn = String(seq)
    })
  }, [cfg, qr, previewH])

  const set = useCallback(<K extends keyof PosterConfig>(k: K, v: PosterConfig[K]) => setOverrides((o) => ({ ...o, [k]: v })), [])

  const persist = async (next: PosterOverrides) => {
    setSaving(true)
    try {
      await live.updateSession(session.id, { poster_config: next as Record<string, unknown> })
      setBaseline(JSON.stringify(next)); toast.success(t('wdAdmin.posterEditor.saved'))
    } catch (e: any) { toast.error(e?.message ?? t('wdAdmin.posterEditor.saveError')) } finally { setSaving(false) }
  }
  const reset = async () => {
    if (hasCustom && !window.confirm(t('wdAdmin.posterEditor.resetConfirm'))) return
    const next: PosterOverrides = overrides.format ? { format: overrides.format } : {}
    setOverrides(next); await persist(next)
  }

  const downloadPdf = async () => {
    if (!qr) return
    setPdfBusy(true)
    try {
      await ensurePosterFonts(cfg)
      const pxW = Math.round((size.w / 25.4) * PDF_DPI), pxH = Math.round((size.h / 25.4) * PDF_DPI)
      const c = document.createElement('canvas'); c.width = pxW; c.height = pxH
      const ctx = c.getContext('2d')!
      const texts = drawPoster(ctx, cfg, qr, pxW, pxH)
      const pdf = await buildPdf({ wMm: size.w, hMm: size.h, pxW, pxH, rgba: ctx.getImageData(0, 0, pxW, pxH).data, texts })
      const href = URL.createObjectURL(pdf)
      const a = document.createElement('a'); a.href = href; a.download = posterFileName(session.public_slug ?? ''); document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
    } catch (e: any) { toast.error(e?.message ?? t('wdAdmin.posterEditor.pdfError')) } finally { setPdfBusy(false) }
  }

  const textLabel: Record<PosterTextField, string> = {
    title1: t('wdAdmin.posterEditor.title1'), title2: t('wdAdmin.posterEditor.title2'), title3: t('wdAdmin.posterEditor.title3'),
    instruction1: t('wdAdmin.posterEditor.instruction1'), instruction2: t('wdAdmin.posterEditor.instruction2'),
    displayName: t('wdAdmin.posterEditor.displayName'), displayDate: t('wdAdmin.posterEditor.displayDate'),
  }
  const colorInput = (label: string, key: 'primaryColor' | 'backgroundColor', id: string) => (
    <WdField label={label}>
      <div className="flex items-center gap-2">
        <input type="color" data-testid={id} value={cfg[key]} onChange={(e) => set(key, e.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-wd-border bg-white p-1" />
        <span className="font-mono text-xs text-wd-muted">{cfg[key]}</span>
      </div>
    </WdField>
  )
  const section = (title: string, children: React.ReactNode) => (
    <div className="space-y-4 border-b border-wd-border pb-6 last:border-0 last:pb-0">
      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-wd-muted">{title}</h3>{children}
    </div>
  )

  return (
    <WdPage width="wide" title={t('wdAdmin.posterEditor.title')} subtitle={t('wdAdmin.posterEditor.subtitle')}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,430px)_minmax(0,1fr)]" data-testid="poster-editor">
        <div className="space-y-5">
          <WdCard className="space-y-6">
            {section(t('wdAdmin.posterEditor.format'), (
              <WdPills value={cfg.format} onChange={(v) => set('format', v)} options={POSTER_FORMATS.map((f) => ({ value: f, label: f }))} />
            ))}
            {section(t('wdAdmin.posterEditor.texts'), (
              <div className="grid gap-4">
                {TEXT_FIELDS.map((k) => (
                  <WdField key={k} label={textLabel[k]}>
                    <WdInput data-testid={`poster-${k}`} value={cfg[k]} maxLength={POSTER_TEXT_MAX[k]} onChange={(e) => set(k, e.target.value)} />
                  </WdField>
                ))}
                <div role="group" aria-label={t('wdAdmin.posterEditor.titleSize')}>
                  <span className="mb-1.5 block text-sm font-medium text-wd-ink">{t('wdAdmin.posterEditor.titleSize')}</span>
                  <WdPills value={cfg.titleSize} onChange={(v) => set('titleSize', v)} options={TITLE_SIZES.map((s) => ({ value: s, label: t(`wdAdmin.posterEditor.size_${s}`) }))} />
                </div>
              </div>
            ))}
            {section(t('wdAdmin.posterEditor.colors'), (
              <>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('wdAdmin.posterEditor.presets')}>
                  {POSTER_PRESETS.map((p) => {
                    const on = cfg.primaryColor === p.primary && cfg.backgroundColor === p.background
                    return (
                      <button key={p.id} type="button" data-testid={`poster-preset-${p.id}`} aria-pressed={on} title={t(`wdAdmin.posterEditor.preset_${p.id}`)}
                        onClick={() => setOverrides((o) => ({ ...o, primaryColor: p.primary, backgroundColor: p.background }))}
                        className={cn('flex items-center gap-2 rounded-full border bg-white py-1.5 pl-1.5 pr-3 text-xs font-semibold text-wd-ink transition', on ? 'border-wd-pink ring-2 ring-wd-pink/25' : 'border-wd-border hover:border-wd-pink/50')}>
                        <span className="flex h-6 w-6 overflow-hidden rounded-full border border-black/10"><span className="w-1/2" style={{ background: p.background }} /><span className="w-1/2" style={{ background: p.primary }} /></span>
                        {t(`wdAdmin.posterEditor.preset_${p.id}`)}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {colorInput(t('wdAdmin.posterEditor.primaryColor'), 'primaryColor', 'poster-primary')}
                  {colorInput(t('wdAdmin.posterEditor.backgroundColor'), 'backgroundColor', 'poster-background')}
                </div>
              </>
            ))}
            {section(t('wdAdmin.posterEditor.fonts'), (
              <div className="grid gap-4">
                <WdField label={t('wdAdmin.posterEditor.titleFont')}>
                  <WdSelect data-testid="poster-titleFont" value={cfg.titleFont} onChange={(e) => set('titleFont', e.target.value as PosterConfig['titleFont'])}>
                    {TITLE_FONTS.map((f) => <option key={f} value={f}>{FONT_NAMES[f]}</option>)}
                  </WdSelect>
                </WdField>
                <WdField label={t('wdAdmin.posterEditor.scriptFont')}>
                  <WdSelect data-testid="poster-scriptFont" value={cfg.scriptFont} onChange={(e) => set('scriptFont', e.target.value as PosterConfig['scriptFont'])}>
                    {SCRIPT_FONTS.map((f) => <option key={f} value={f}>{FONT_NAMES[f]}</option>)}
                  </WdSelect>
                </WdField>
                <WdField label={t('wdAdmin.posterEditor.bodyFont')}>
                  <WdSelect data-testid="poster-bodyFont" value={cfg.bodyFont} onChange={(e) => set('bodyFont', e.target.value as PosterConfig['bodyFont'])}>
                    {BODY_FONTS.map((f) => <option key={f} value={f}>{FONT_NAMES[f]}</option>)}
                  </WdSelect>
                </WdField>
              </div>
            ))}
            <p className="text-[13px] leading-relaxed text-wd-muted" data-testid="poster-qr-note">{t('wdAdmin.posterEditor.qrNote')}</p>
            <WdButton className="!rounded-2xl" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={saving} data-testid="poster-reset">
              {t('wdAdmin.posterEditor.reset')}
            </WdButton>
          </WdCard>

          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2.5 rounded-2xl border border-wd-border bg-white/95 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur" data-testid="poster-actions">
            <WdButton className="!rounded-2xl" icon={<Download className="h-4 w-4" />} onClick={downloadPdf} disabled={!qr || pdfBusy} data-testid="poster-download">
              {pdfBusy ? t('wdAdmin.posterEditor.pdfBusy') : t('wdAdmin.posterEditor.download')}
            </WdButton>
            <WdButton className="!rounded-2xl" variant="secondary" icon={<Save className="h-4 w-4" />} onClick={() => persist(overrides)} disabled={saving || !dirty} data-testid="poster-save">
              {saving ? t('wdAdmin.posterEditor.saving') : t('wdAdmin.posterEditor.save')}
            </WdButton>
            {dirty && <span className="text-xs font-semibold text-wd-muted" data-testid="poster-dirty">{t('wdAdmin.posterEditor.unsaved')}</span>}
          </div>
        </div>

        <div className="min-w-0 self-start rounded-[24px] border border-wd-border bg-[#F4F1F2] px-4 py-6 sm:py-8 lg:sticky lg:top-4">
          <p className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('wdAdmin.posterEditor.preview')} · {cfg.format} · {size.w} × {size.h} mm</p>
          <div className="mx-auto w-full" style={{ maxWidth: `min(520px, calc((100vh - 310px) * ${size.w / size.h}))` }} data-testid="poster-preview" data-qr-value={url} data-format={cfg.format} data-poster={JSON.stringify(cfg)}>
            <canvas ref={canvas} width={PREVIEW_PX} height={previewH} className="block h-auto w-full bg-white shadow-[0_12px_40px_rgba(0,0,0,0.14)]" style={{ aspectRatio: `${size.w} / ${size.h}` }}
              role="img" aria-label={`${cfg.title1} ${cfg.title2} ${cfg.title3}`} data-testid="poster-canvas" />
          </div>
        </div>
      </div>

      {/* The code itself comes from this hidden render: black on white, never restyled. */}
      <div ref={qrHost} aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
        <QRCodeSVG value={url} size={256} level="M" includeMargin={false} fgColor="#000000" bgColor="#FFFFFF" />
      </div>
    </WdPage>
  )
}
