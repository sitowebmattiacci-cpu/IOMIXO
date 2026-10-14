'use client'
import { Check, X, Trash2, Music2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatRelativeTime } from '@/lib/utils'
import type { LiveRequest, LiveRequestStatus } from '@/lib/api'

const STATUS_VARIANT: Record<LiveRequestStatus, 'queued' | 'complete' | 'failed'> = {
  pending:  'queued',
  approved: 'complete',
  rejected: 'failed',
}
const STATUS_LABEL: Record<LiveRequestStatus, string> = {
  pending:  'In attesa',
  approved: 'Approvata',
  rejected: 'Rifiutata',
}

interface Props {
  request: LiveRequest
  onUpdate: (status: LiveRequestStatus) => void
  onDelete: () => void
  busy?: boolean
  readOnly?: boolean
  wedding?: boolean
}

export function RequestItem({ request, onUpdate, onDelete, busy, readOnly, wedding }: Props) {
  if (wedding) {
    return (
      <div className="rounded-[18px] p-4 bg-[#F7F4F3] border border-[#E8B7C8]">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-[#FBEAF0] text-[#8F1D2C] flex items-center justify-center">
            <Music2 className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#2B2424] truncate">{request.track_title}</p>
            {request.artist && <p className="text-xs text-[#6F6260] truncate">{request.artist}</p>}
            {request.message && (
              <p className="text-xs text-[#6F6260] italic mt-1 line-clamp-2">&ldquo;{request.message}&rdquo;</p>
            )}
            <p className="text-[11px] text-[#6F6260]/70 mt-2">{formatRelativeTime(request.created_at)}</p>
          </div>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider bg-[#FBEAF0] border-[#E8B7C8] text-[#8F1D2C]">
            {STATUS_LABEL[request.status]}
          </span>
        </div>
        <div className="flex gap-2">
          {!readOnly && request.status !== 'approved' && (
            <button disabled={busy} onClick={() => onUpdate('approved')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-[#8F1D2C] text-white hover:bg-[#741625] transition disabled:opacity-50">
              <Check className="h-3.5 w-3.5" /> Approva
            </button>
          )}
          {!readOnly && request.status !== 'rejected' && (
            <button disabled={busy} onClick={() => onUpdate('rejected')}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-[#FBEAF0] text-[#8F1D2C] border border-[#E8B7C8] hover:bg-[#E8B7C8]/50 transition disabled:opacity-50">
              <X className="h-3.5 w-3.5" /> Rifiuta
            </button>
          )}
          <button disabled={busy} onClick={onDelete}
            className="inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[#6F6260] hover:text-[#2B2424] hover:bg-[#FBEAF0] transition disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> Elimina
          </button>
        </div>
      </div>
    )
  }

  const statusTone: Record<LiveRequestStatus, string> = {
    pending:  'bg-[#F4FF3A]/10 text-[#F4FF3A] border-[#F4FF3A]/30',
    approved: 'bg-[#43E08D]/10 text-[#43E08D] border-[#43E08D]/30',
    rejected: 'bg-[#FF5C75]/10 text-[#FF5C75] border-[#FF5C75]/30',
  }
  return (
    <div className={`rounded-2xl border bg-[#15151B] p-4 ${request.status === 'pending' ? 'border-[#F4FF3A]/25' : 'border-[#2A2A33]'}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-[#FF2D8D]/12 text-[#FF2D8D] flex items-center justify-center">
          <Music2 className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#F8F8FA] truncate">{request.track_title}</p>
          {request.artist && <p className="text-xs text-[#9A9AA3] truncate">{request.artist}</p>}
          {request.message && (
            <p className="text-xs text-[#F8F8FA]/70 italic mt-1 line-clamp-2">&ldquo;{request.message}&rdquo;</p>
          )}
          <p className="text-[11px] text-[#9A9AA3] mt-2">{formatRelativeTime(request.created_at)}</p>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusTone[request.status]}`}>
          {STATUS_LABEL[request.status]}
        </span>
      </div>
      <div className="flex gap-2">
        {!readOnly && request.status !== 'approved' && (
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => onUpdate('approved')}
            icon={<Check className="h-3.5 w-3.5" />}>
            Approva
          </Button>
        )}
        {!readOnly && request.status !== 'rejected' && (
          <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => onUpdate('rejected')}
            icon={<X className="h-3.5 w-3.5" />}>
            Rifiuta
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}
          icon={<Trash2 className="h-3.5 w-3.5" />}>
          Elimina
        </Button>
      </div>
    </div>
  )
}
