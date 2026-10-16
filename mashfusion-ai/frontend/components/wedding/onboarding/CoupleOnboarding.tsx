'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { mutate } from 'swr'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { live, type OccasionType } from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useAccountRole } from '@/lib/roles'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { MioloveLogo } from '@/components/brand/MioloveLogo'
import { WdButton, WdField, WdInput } from '@/components/wedding/admin/WeddingAdminUI'
import { COUPLE_DEFAULT_GUEST_CONFIG, OCCASIONS, OCCASION_EMOJI, albumNamePlaceholder, firstNameOf, suggestAlbumName } from '@/lib/coupleAlbum'
import { cn } from '@/lib/utils'

/** First screen of a new MIOLOVE account: what the event is, how to call the album, when it is. Nothing is written until the button is pressed. */
export function CoupleOnboarding() {
  const { t } = useI18n()
  const router = useRouter()
  const { user } = useAccountRole()
  const firstName = firstNameOf(user?.full_name, user?.email)

  const [occasion, setOccasion] = useState<OccasionType>('wedding')
  const [typedName, setTypedName] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [dateUnknown, setDateUnknown] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // The name follows the occasion until the user types in it; after that it is never overwritten.
  const name = typedName ?? suggestAlbumName(occasion, firstName, t)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = name.trim()
    if (!title) { toast.error(t('onboarding.nameRequired')); return }
    setSubmitting(true)
    try {
      // The engine stays 'wedding' for every MIOLOVE album; what the album is for lives in occasion_type.
      const album = await live.createSession({
        event_name: title, session_type: 'wedding', occasion_type: occasion,
        wedding_date: dateUnknown || !date ? undefined : date,
      })
      // A failure here only leaves the defaults; retrying would create a second album, so it never blocks the user.
      await live.updateSession(album.id, { guest_config: { ...COUPLE_DEFAULT_GUEST_CONFIG } }).catch(() => undefined)
      await mutate('live-sessions')
      router.replace(`/sessions/${album.id}`)
    } catch (err: any) {
      toast.error(err?.reason === 'miolove_trial_album_exists' ? t('onboarding.trialAlbumExists') : (err?.message ?? t('common.errorGeneric')))
      setSubmitting(false)
    }
  }

  const welcome = firstName ? t('onboarding.welcome').replace('{name}', firstName) : t('onboarding.welcomeNoName')

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-wd-bg font-sans text-wd-ink antialiased" data-portal="miolove" data-testid="couple-onboarding">
      <header className="mx-auto flex h-[68px] w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-8">
        <MioloveLogo height={36} className="text-wd-ink" />
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden truncate rounded-full border border-wd-border bg-white px-4 py-1.5 text-sm text-wd-muted sm:inline-block" data-testid="onboarding-welcome">{welcome}</span>
          <LanguageSwitcher variant="wedding" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[620px] px-4 pb-14 pt-6 sm:pt-10">
        <form onSubmit={create} className="rounded-[28px] border border-wd-border bg-white p-6 shadow-[0_10px_40px_rgba(240,106,155,0.08)] sm:p-10">
          <p className="mb-3 text-center text-sm text-wd-muted sm:hidden" data-testid="onboarding-welcome-mobile">{welcome}</p>
          <h1 className="text-center font-wedding text-[34px] font-semibold leading-tight sm:text-[40px]">{t('onboarding.title')}</h1>
          <p className="mx-auto mt-3 max-w-[420px] text-center text-[15px] leading-relaxed text-wd-muted">{t('onboarding.subtitle')}</p>

          <div className="mt-8" role="radiogroup" aria-label={t('onboarding.eventType')}>
            <p className="mb-3 text-sm font-medium">{t('onboarding.eventType')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {OCCASIONS.map((o) => {
                const selected = o === occasion
                return (
                  <button
                    key={o} type="button" role="radio" aria-checked={selected} data-testid={`occasion-${o}`}
                    onClick={() => setOccasion(o)}
                    className={cn(
                      'flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40',
                      selected ? 'border-wd-pink bg-wd-active text-wd-pink-hover' : 'border-wd-border bg-white text-wd-ink hover:border-wd-pink/50',
                    )}
                  >
                    <span className="text-[26px] leading-none" aria-hidden>{OCCASION_EMOJI[o]}</span>
                    {t(`onboarding.occasion.${o}`)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-7 space-y-5">
            <WdField label={t('onboarding.albumName')}>
              <WdInput
                value={name} maxLength={200} data-testid="onboarding-name" placeholder={albumNamePlaceholder(occasion, t)}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </WdField>

            <div>
              <WdField label={t('onboarding.date')}>
                <WdInput
                  type="date" value={dateUnknown ? '' : date} disabled={dateUnknown} data-testid="onboarding-date" aria-label={t('onboarding.chooseDate')}
                  onChange={(e) => { setDate(e.target.value); if (e.target.value) setDateUnknown(false) }}
                />
              </WdField>
              <button
                type="button" aria-pressed={dateUnknown} data-testid="onboarding-date-unknown"
                onClick={() => { setDateUnknown(!dateUnknown); setDate('') }}
                className="mt-2.5 inline-flex min-h-[32px] items-center gap-2 rounded-lg text-sm font-medium text-wd-pink-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-wd-pink/40"
              >
                <span className={cn('flex h-4 w-4 items-center justify-center rounded border', dateUnknown ? 'border-wd-pink bg-wd-pink text-white' : 'border-wd-border bg-white')}>
                  {dateUnknown && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                {t('onboarding.unknownDate')}
              </button>
              {dateUnknown && <p className="mt-1.5 text-xs text-wd-muted">{t('onboarding.unknownDateOn')}</p>}
            </div>
          </div>

          <WdButton type="submit" data-testid="onboarding-create" disabled={submitting || !name.trim()} className="mt-8 w-full !rounded-2xl !py-3.5 !text-base">
            {submitting ? t('onboarding.creating') : t('onboarding.cta')}
          </WdButton>
        </form>
      </main>
    </div>
  )
}
