/** Firebase is the only runtime: every switch is ON unless explicitly disabled with `off` / `false` (emulator tests only). */
const on = (v: string | undefined) => v !== 'off' && v !== 'false'
export const ownerOpsFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS)
export const publicReadFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_PUBLIC_READ)
export const dashboardFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_DASHBOARD)
export const ownerCallablesFlag = () => ownerOpsFlag() || dashboardFlag()
export const billingFlag = () => on(process.env.NEXT_PUBLIC_FIREBASE_BILLING)
