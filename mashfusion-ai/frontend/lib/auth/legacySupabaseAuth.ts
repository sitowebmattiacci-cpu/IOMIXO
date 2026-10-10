/**
 * TODO(firebase-migration): TRANSITIONAL — Supabase Auth implementation, used only
 * while Firebase is not configured (current production). Delete this file, lib/supabase.ts,
 * app/auth/callback/route.ts and the @supabase/* deps when Supabase Auth is retired.
 */
import { getSupabaseClient, getAccessToken } from '@/lib/supabase'

const cb = () => `${window.location.origin}/auth/callback`

export const legacy = {
  async signIn(email: string, password: string) {
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
    if (error) throw error
  },
  async signUp(email: string, password: string, fullName: string) {
    const { error } = await getSupabaseClient().auth.signUp({
      email, password, options: { data: { full_name: fullName }, emailRedirectTo: cb() },
    })
    if (error) throw error
  },
  async resend(email: string) {
    const { error } = await getSupabaseClient().auth.resend({ type: 'signup', email, options: { emailRedirectTo: cb() } })
    if (error) throw error
  },
  async signOut() { await getSupabaseClient().auth.signOut() },
  async requestPasswordReset(email: string) {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo: `${cb()}?next=/reset-password` })
    if (error) throw error
  },
  async updatePassword(password: string) {
    const { error } = await getSupabaseClient().auth.updateUser({ password })
    if (error) throw error
  },
  getToken: getAccessToken,
}
