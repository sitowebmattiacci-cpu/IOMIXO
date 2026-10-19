/**
 * Product an entitlement belongs to. One Firebase identity can hold entitlements in BOTH products, and they never mix:
 * a plan / subscription / Event Pass is valid only in its own scope. Anything stored WITHOUT a scope (every Stripe record written before this field
 * existed) is IOMIXO: MIOLOVE has no pricing yet, so an old DJ plan must never unlock a MIOLOVE album.
 */
export type ProductScope = 'iomixo' | 'miolove'
export const scopeOf = (raw: unknown): ProductScope => (raw === 'miolove' ? 'miolove' : 'iomixo')
