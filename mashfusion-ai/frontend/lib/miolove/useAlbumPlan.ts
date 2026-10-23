'use client'
import useSWR from 'swr'
import { live } from '@/lib/api'
import { useAccountRole } from '@/lib/roles'
import { sessionsOfBrand } from '@/lib/brand/eventBrand'
import { albumStatus, type AlbumStatus } from './albumStatus'

export interface OwnedAlbum { album: any; status: AlbumStatus | null }

/**
 * The signed-in owner's MIOLOVE albums, each with ITS OWN status. There is no account plan: an account owns any number of albums (shares the 'live-sessions' SWR cache).
 * `toActivate` = the albums that can still be paid for (pending, trial running, trial paused inside its recovery window).
 */
export function useOwnedAlbums(): { loading: boolean; albums: OwnedAlbum[]; toActivate: OwnedAlbum[] } {
  const { accountType } = useAccountRole()
  const { data, isLoading } = useSWR('live-sessions', () => live.listSessions())
  const albums = (sessionsOfBrand(data, 'miolove', accountType) ?? []).map((album: any) => ({ album, status: albumStatus(album) }))
  return { loading: isLoading, albums, toActivate: albums.filter((a) => a.status?.canActivate) }
}
