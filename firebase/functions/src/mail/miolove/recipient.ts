/**
 * Recipient lookup of the MIOLOVE outbox: the e-mail address of an account, read from Firebase Auth when the e-mail is sent (no address is ever stored).
 *
 * ONLY "this account does not exist" means "nothing to send to" (null → the outbox marks the e-mail skipped for good: there is nobody to mail).
 * Every other failure (missing IAM permission, network, quota, Auth outage) is RETHROWN: the outbox treats it as retryable (back-off, 6 attempts, then `failed` with a logged error),
 * so a temporary or configuration problem can never silently drop a customer's e-mail.
 */
export type GetAuthUser = (uid: string) => Promise<{ email?: string | null }>

export const recipientResolver = (getUser: GetAuthUser) => async (uid: string): Promise<string | null> => {
  try {
    return (await getUser(uid)).email?.toLowerCase() ?? null
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'auth/user-not-found') return null
    throw e
  }
}
