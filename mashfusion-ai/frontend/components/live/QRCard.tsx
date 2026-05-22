'use client'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { Copy, Check, Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export function QRCard({ slug }: { slug: string }) {
  const envBase = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL
  const origin = envBase || (typeof window !== 'undefined' ? window.location.origin : 'https://www.iomixo.com')
  const url    = `${origin}/live/${slug}`
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const download = () => {
    const svg = document.getElementById('qrcode-svg') as SVGSVGElement | null
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    const blob = new Blob([xml], { type: 'image/svg+xml' })
    const objectUrl = URL.createObjectURL(blob)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 512
      canvas.width = size; canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `iomixo-${slug}.png`
      a.click()
      URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl
  }

  return (
    <div className="glass rounded-2xl p-6 flex flex-col items-center">
      <div className="bg-white p-4 rounded-xl">
        <QRCodeSVG id="qrcode-svg" value={url} size={208} level="M" includeMargin={false} />
      </div>
      <p className="text-xs text-white/40 mt-4 break-all text-center">{url}</p>
      <div className="flex gap-2 mt-4 w-full">
        <Button variant="secondary" size="sm" className="flex-1" onClick={copy}
          icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
          {copied ? 'Copiato' : 'Copia link'}
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={download}
          icon={<Download className="h-3.5 w-3.5" />}>
          Scarica PNG
        </Button>
      </div>
    </div>
  )
}
