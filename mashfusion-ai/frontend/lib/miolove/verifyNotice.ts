/**
 * MIOLOVE "confirm your e-mail" notice: pure rules (no React, no Firebase imports), used by components/miolove/VerifyEmailNotice and by the unit tests.
 * The notice is informational ONLY: nothing in the app waits for it (an album, the free trial and every other feature work with emailVerified=false).
 */
export const VERIFY_RECHECK_MS = 15_000          // at most one user.reload() per 15 s when the tab comes back
export const VERIFY_RESEND_COOLDOWN_MS = 60_000  // mirrors the server's minimum gap between two sends

export interface NoticeInput {
  /** The Firebase user (only what the rule needs). */
  user: { isAnonymous: boolean; emailVerified: boolean } | null | undefined
  /** The MIOLOVE portal is open (decided by the domain). */
  isCouple: boolean
  /** users/{uid}.accountType: the server only mails 'couple' accounts, so only they get a button that can work. */
  accountType: string | null | undefined
  /** The account document has been read. */
  ready: boolean
  dismissed: boolean
}

export const shouldShowVerifyNotice = (i: NoticeInput): boolean =>
  !!i.user && !i.user.isAnonymous && !i.user.emailVerified && i.isCouple && i.accountType === 'couple' && i.ready && !i.dismissed

/** Per account and per browser tab (sessionStorage): closing the notice never changes anything server-side. */
export const verifyNoticeDismissKey = (uid: string) => `miolove.verifyNotice.dismissed.${uid}`

export type NoticePlacement = 'layout' | 'onboarding'
/**
 * The first-album screen (/onboarding) is a full-screen layer above the dashboard layout: it carries its own notice, so the layout one must not also exist there
 * (it would sit hidden underneath, duplicated in the page and for screen readers).
 */
export const verifyNoticeHiddenHere = (placement: NoticePlacement, pathname: string | null | undefined): boolean =>
  placement === 'layout' && (pathname === '/onboarding' || (pathname ?? '').startsWith('/onboarding/'))
