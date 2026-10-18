// Pure role rules (no React / Firebase imports): shared by the UI guards and the unit tests.
/** Internal value 'couple'; the user-facing label is ALWAYS and ONLY "Sposi". */
export type AccountType = 'dj' | 'couple'
export const COUPLE_LABEL = 'Sposi'

/** No field = legacy account (created before roles existed) = DJ, so nobody is locked out. */
export const resolveAccountType = (raw: unknown): AccountType => (raw === 'couple' ? 'couple' : 'dj')

/** Home of a Sposi account (album list; the album itself opens on its Home tab). */
export const COUPLE_HOME = '/sessions'

/** Dashboard routes a Sposi account may open. Everything else under (dashboard) is DJ-only. */
const COUPLE_ALLOWED_PREFIXES = ['/sessions', '/onboarding', '/billing', '/settings'] as const
export function isCoupleAllowedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return COUPLE_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/** Sections of the wedding admin visible to a Sposi account (no live-control / DJ tools). */
export const COUPLE_WEDDING_TABS = ['home', 'photos', 'privacy', 'poster', 'settings'] as const
export const isCoupleWeddingTab = (key: string) => (COUPLE_WEDDING_TABS as readonly string[]).includes(key)
/** Wedding sections that belong to MIOLOVE albums only (photos): a DJ's Wedding (IOMIXO) never opens them. */
export const MIOLOVE_ONLY_WEDDING_TABS = ['photos', 'poster', 'booth'] as const
export const isMioloveOnlyTab = (key: string) => (MIOLOVE_ONLY_WEDDING_TABS as readonly string[]).includes(key)

