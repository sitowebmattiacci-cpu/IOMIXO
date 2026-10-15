'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { PORTAL_CONFIG, DEFAULT_PORTAL, type PortalConfig } from '@/lib/portal'

interface PortalCtx { config: PortalConfig; /** true when the request host is a real portal domain */ matched: boolean }
const Ctx = createContext<PortalCtx>({ config: PORTAL_CONFIG[DEFAULT_PORTAL], matched: false })

/** Fed by the server layout from the request host, so the first paint already has the right brand (no cross-brand flash). */
export function PortalProvider({ portalId, matched, children }: { portalId: PortalConfig['id']; matched: boolean; children: ReactNode }) {
  return <Ctx.Provider value={{ config: PORTAL_CONFIG[portalId], matched }}>{children}</Ctx.Provider>
}

export const usePortal = () => useContext(Ctx)
