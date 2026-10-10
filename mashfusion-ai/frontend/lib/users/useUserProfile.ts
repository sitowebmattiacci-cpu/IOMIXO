'use client'
import useSWR from 'swr'
import { useAuth } from '../auth/AuthProvider'
import { authProvider } from '../auth'
import { getCurrentUserProfile } from './userService'

/** Firestore profile of the signed-in account (Firebase provider only). */
export function useUserProfile() {
  const { user, isAnonymous } = useAuth()
  const enabled = authProvider() === 'firebase' && !!user && !isAnonymous
  return useSWR(enabled ? ['userProfile', user!.uid] : null, () => getCurrentUserProfile(), { revalidateOnFocus: false })
}
