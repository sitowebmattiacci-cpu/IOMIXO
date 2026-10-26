'use client'
import Link from 'next/link'
import type { ComponentProps } from 'react'
import { usePortal } from '@/components/portal/PortalProvider'
import { useI18n } from '@/lib/i18n'
import { homePath } from '@/lib/miolove/paths'

/**
 * "Back to the home" link. IOMIXO and every other host: exactly the `<Link href="/">` it always was.
 * MIOLOVE: the home of the language the visitor is reading ("/", "/en", "/fr", "/es"). A plain anchor on purpose: a full page load makes the server render
 * the home in the language of its URL (a client-side navigation would keep the language of the page the visitor came from).
 */
export function HomeLink({ href: _ignored, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href?: string }) {
  const { config } = usePortal()
  const { locale } = useI18n()
  if (config.id === 'miolove') {
    const { prefetch: _p, replace: _r, scroll: _s, shallow: _sh, passHref: _ph, legacyBehavior: _lb, locale: _l, as: _as, ...anchor } = props as any
    return <a href={homePath(locale)} {...anchor} />
  }
  return <Link href="/" {...props} />
}
