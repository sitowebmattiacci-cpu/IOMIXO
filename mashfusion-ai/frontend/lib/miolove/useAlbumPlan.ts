'use client'
import useSWR from 'swr'
import { live } from '@/lib/api'
import { useAccountRole } from '@/lib/roles'
import { sessionsOfBrand } from '@/lib/brand/eventBrand'
import { albumPlanState, type AlbumPlanState } from './plans'

/** Plan of the signed-in owner's MIOLOVE album (the first one: a free account has exactly one, a paid one may have more). Shares the 'live-sessions' SWR cache. */
export function useAlbumPlan(): { loading: boolean; album: any | null; state: AlbumPlanState } {
  const { accountType, portal } = useAccountRole()
  const { data, isLoading } = useSWR('live-sessions', () => live.listSessions())
  const album = sessionsOfBrand(data, 'miolove', accountType)?.[0] ?? null
  void portal
  return { loading: isLoading, album, state: albumPlanState(album) }
}
