'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { live } from '@/lib/api'
import { useAccountRole, COUPLE_HOME } from '@/lib/roles'
import { CoupleOnboarding } from '@/components/wedding/onboarding/CoupleOnboarding'

/** MIOLOVE only: shown to a Sposi account that has no album yet. Anyone else (an account that already has albums, a DJ) is sent on, never shown this. */
export default function OnboardingPage() {
  const router = useRouter()
  const { ready, isCouple } = useAccountRole()
  const { data: all } = useSWR('live-sessions', () => live.listSessions())
  const albums = all?.filter((s) => s.session_type === 'wedding')
  const hasAlbums = !!albums && albums.length > 0

  useEffect(() => {
    if (!ready) return
    if (!isCouple) router.replace('/dashboard')
    else if (hasAlbums) router.replace(COUPLE_HOME)
  }, [ready, isCouple, hasAlbums, router])

  if (!ready || !isCouple || !albums || hasAlbums) return <div className="min-h-screen bg-wd-bg" aria-busy="true" />
  return <CoupleOnboarding />
}
