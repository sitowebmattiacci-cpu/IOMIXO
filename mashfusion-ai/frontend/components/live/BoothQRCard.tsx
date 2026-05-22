'use client'
import { QRCodeSVG } from 'qrcode.react'

export function BoothQRCard({ slug }: { slug: string }) {
  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  const origin = envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
  const url = `${origin}/booth/${slug}`

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
