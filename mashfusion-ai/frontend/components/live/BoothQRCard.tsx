'use client'
import { QRCodeSVG } from 'qrcode.react'
import { publicOriginFor } from '@/lib/portalLinks'

export function BoothQRCard({ slug, eventType }: { slug: string; eventType?: string }) {
  const url = `${publicOriginFor(eventType)}/booth/${slug}`

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white p-6 rounded-2xl shadow-wedding-lg border-2 border-wedding-gold/30">
        <QRCodeSVG
          value={url}
          size={200}
          level="M"
          includeMargin={false}
        />
      </div>
      <p className="text-xs uppercase tracking-[0.28em] text-wedding-champagne/70 mt-4">
        Scansiona per partecipare
      </p>
    </div>
  )
}
