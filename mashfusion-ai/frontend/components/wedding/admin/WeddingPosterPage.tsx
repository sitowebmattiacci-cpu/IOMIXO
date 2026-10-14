'use client'
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, Pencil, Download } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { WdPage, WdButton, WdField, WdInput, WdToggleRow, WdSectionCard } from './WeddingAdminUI'
import { publicOrigin, downloadQrPng } from './WeddingHomePage'

export function WeddingPosterPage({ session }: { session: any }) {
  const { t } = useI18n()
  const url = `${publicOrigin()}/live/${session.public_slug}`
  const [headline, setHeadline] = useState(t('wdAdmin.poster.defaultHeadline'))
  const [subline, setSubline] = useState(t('wdAdmin.poster.defaultSubline'))
  const [caption, setCaption] = useState(t('wdAdmin.poster.defaultCaption'))
  const [showNames, setShowNames] = useState(true)
  const [showDate, setShowDate] = useState(true)
  const [editing, setEditing] = useState(false)

  const names: string = session.couple_names ?? session.event_name
  const dateLabel = session.wedding_date
    ? new Date(session.wedding_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.')
    : null

  return (
    <WdPage width="default" title={t('wdAdmin.poster.title')} subtitle={t('wdAdmin.poster.subtitle')}>
      <div className="rounded-[24px] border border-wd-border bg-[#F4F4F5] px-4 py-8 sm:py-10 flex flex-col items-center">
        <span className="mb-6 rounded-full border border-wd-border bg-white px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-wd-muted">{t('wdAdmin.poster.previewA4')}</span>
        <div className="wd-poster-print aspect-[210/297] w-full max-w-[330px] bg-white px-7 py-12 text-center shadow-[0_12px_40px_rgba(0,0,0,0.12)] flex flex-col items-center">
          <h2 className="w-full break-words text-[40px] font-black uppercase leading-[1.05] tracking-tight text-[#1b1b1f]">{headline}</h2>
          <p className="mt-1 font-wedding-great-vibes text-[34px] leading-none text-[#1b1b1f]">{subline}</p>
          <div className="mt-4 h-px w-24 bg-[#1b1b1f]/60" />
          <div className="mt-6 bg-white"><QRCodeSVG id="wd-poster-qr" value={url} size={108} level="M" includeMargin={false} /></div>
          <p className="mt-5 text-[8px] font-semibold uppercase leading-snug tracking-[0.12em] text-[#1b1b1f]">{caption}</p>
          {showNames && <p className="mt-5 text-[11px] font-black uppercase tracking-[0.1em] text-[#1b1b1f]">{names}</p>}
          {showDate && dateLabel && <p className="mt-1 text-[9px] text-[#1b1b1f]/70">{dateLabel}</p>}
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <WdButton className="!rounded-2xl !px-6 !py-3.5" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>{t('wdAdmin.poster.print')}</WdButton>
          <WdButton className="!rounded-2xl !py-3.5" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(!editing)}>{t('wdAdmin.poster.edit')}</WdButton>
          <WdButton className="!rounded-2xl !py-3.5" variant="secondary" icon={<Download className="h-4 w-4" />}
            onClick={() => downloadQrPng('wd-poster-qr', `iomixo-poster-qr-${session.public_slug}.png`)}>{t('wdAdmin.home.downloadQr')}</WdButton>
        </div>
      </div>

      {editing && (
        <WdSectionCard>
          <div className="grid gap-4 px-6 py-6 sm:grid-cols-2 sm:px-7">
            <WdField label={t('wdAdmin.poster.headline')}><WdInput value={headline} maxLength={16} onChange={(e) => setHeadline(e.target.value)} /></WdField>
            <WdField label={t('wdAdmin.poster.subline')}><WdInput value={subline} maxLength={24} onChange={(e) => setSubline(e.target.value)} /></WdField>
            <div className="sm:col-span-2"><WdField label={t('wdAdmin.poster.caption')}><WdInput value={caption} maxLength={90} onChange={(e) => setCaption(e.target.value)} /></WdField></div>
          </div>
          <WdToggleRow section title={t('wdAdmin.poster.showNames')} checked={showNames} onChange={setShowNames} />
          <WdToggleRow section title={t('wdAdmin.poster.showDate')} checked={showDate} onChange={setShowDate} />
        </WdSectionCard>
      )}
    </WdPage>
  )
}
