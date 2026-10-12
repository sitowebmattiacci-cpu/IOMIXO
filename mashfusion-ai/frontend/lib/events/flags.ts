/** Build-time switches of the Firestore cutover. Both `on` and `true` enable; anything else (or unset) = legacy behaviour. */
const on = (v: string | undefined) => v === 'on' || v === 'true'
export const ownerOpsFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_OWNER_OPS)
export const publicReadFlag = () => on(process.env.NEXT_PUBLIC_FIRESTORE_PUBLIC_READ)
