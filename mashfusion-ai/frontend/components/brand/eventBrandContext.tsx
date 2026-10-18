'use client'
import { createContext, useContext, type ReactNode } from 'react'
import { EVENT_BRAND_NAME, type EventBrand } from '@/lib/brand/eventBrand'

// The Wedding UI (wd-* light theme) is shared by MIOLOVE albums and IOMIXO Wedding DJ events: this context tells it whose brand to show.
// Default 'miolove' so every MIOLOVE surface keeps working unchanged; IOMIXO Wedding surfaces wrap themselves in <EventBrandProvider brand="iomixo">.
const EventBrandContext = createContext<EventBrand>('miolove')

export function EventBrandProvider({ brand, children }: { brand: EventBrand; children: ReactNode }) {
  return <EventBrandContext.Provider value={brand}>{children}</EventBrandContext.Provider>
}

export const useEventBrand = (): EventBrand => useContext(EventBrandContext)
export const useEventBrandName = (): string => EVENT_BRAND_NAME[useEventBrand()]
