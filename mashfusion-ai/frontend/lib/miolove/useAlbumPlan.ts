'use client'
import useSWR from 'swr'
import { live } from '@/lib/api'
import { useAccountRole } from '@/lib/roles'
import { sessionsOfBrand } from '@/lib/brand/eventBrand'
import { albumPlanState, type AlbumPlanState } from './plans'

/** Plan of the signed-in owner's MIOLOVE album (the first one: a free account has exactly one, a paid one may have more). Shares the 'live-sessions' SWR cache. */
export function useAlbumPlan(): { loading: boolean; album: any | null; /** The album to activate: the first MIOLOVE album that is not activated yet (else the first one). */ activatable: any | null; state: AlbumPlanState } {
  const { accountType, portal } = useAccountRole()
  const { data, isLoading } = useSWR('live-sessions', () => live.listSessions())
  const albums = sessionsOfBrand(data, 'miolove', accountType) ?? []
  const album = albums[0] ?? null
  const activatable = albums.find((a: any) => a.access_mode !== 'activated') ?? album
  void portal
  return { loading: isLoading, album, activatable, state: albumPlanState(activatable) }
}
