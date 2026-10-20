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

// White label: an ACTIVATED (paid) MIOLOVE album shows no MIOLOVE mark on its public pages (guest page, Live Booth, TV screen). Trial albums keep it.
const WhiteLabelContext = createContext(false)
export function WhiteLabelProvider({ whiteLabel, children }: { whiteLabel: boolean; children: ReactNode }) {
  return <WhiteLabelContext.Provider value={whiteLabel}>{children}</WhiteLabelContext.Provider>
}
export const useWhiteLabel = (): boolean => useContext(WhiteLabelContext)

// Title printed on the photo frame of the TV slideshow ("Oggi Sposi" for a wedding; a MIOLOVE album supplies its occasion's own). null = the default text.
const FrameTitleContext = createContext<string | null>(null)
export function FrameTitleProvider({ title, children }: { title: string | null; children: ReactNode }) {
  return <FrameTitleContext.Provider value={title}>{children}</FrameTitleContext.Provider>
}
export const useFrameTitle = (): string | null => useContext(FrameTitleContext)
export const useEventBrandName = (): string => EVENT_BRAND_NAME[useEventBrand()]
