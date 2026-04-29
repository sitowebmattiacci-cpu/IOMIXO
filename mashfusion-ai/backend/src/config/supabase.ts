import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for backend use only.
 * Bypasses RLS — never expose to the browser.
 */
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
