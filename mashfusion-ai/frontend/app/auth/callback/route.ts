import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Supabase PKCE OAuth / email-link callback handler.
 * Handles: email confirmation, password reset, magic links.
 *
 * Supabase redirects here with ?code=... after the user clicks any email link.
 * We exchange the code for a session, then redirect to the intended destination.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = createRouteHandlerClient({ cookies })
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Something went wrong — send to login with error flag
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
