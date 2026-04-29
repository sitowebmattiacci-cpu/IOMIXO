import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

/**
 * Browser-side Supabase client singleton.
 * Safe to call multiple times — returns the same instance.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClientComponentClient({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    })
  }
  return _client as SupabaseClient
}

/**
 * Returns the current session's access token, or null if not authenticated.
 * Used by the API client to attach Bearer tokens to Express backend requests.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseClient().auth.getSession()
  return data.session?.access_token ?? null
}
