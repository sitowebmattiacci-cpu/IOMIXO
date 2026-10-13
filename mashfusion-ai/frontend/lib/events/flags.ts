/** Build-time switches of the Firestore cutover. Both `on` and `true` enable; anything else (or unset) = legacy behaviour. */
const on = (v: string | undefined) => v === 'on' || v === 'true'
export const ownerOpsFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS)
export const publicReadFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_PUBLIC_READ)
/** Dashboard read path (sessions list/detail, user plan, Event Passes) served by Firestore. Off → legacy Express routes. NEVER on in production until the cutover. */
export const dashboardFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_DASHBOARD)
/** Owner callables are used when EITHER owner-ops or the dashboard switch is on (the dashboard switch is a superset). */
export const ownerCallablesFlag = () => ownerOpsFlag() || dashboardFlag()
/** Billing (checkout, portal, subscription, payments, Event Passes) served by Firebase: callables + Firestore. Off → legacy Express /stripe routes. NEVER on in production before the Stripe cutover. */
export const billingFlag = () => on(process.env.NEXT_PUBLIC_FIREBASE_BILLING)
