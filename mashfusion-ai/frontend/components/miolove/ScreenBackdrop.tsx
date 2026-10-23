import { resolveScreenBackground } from '@/lib/miolove/screenBackgrounds'

/** The chosen background of an album's big screen, behind everything else. Renders nothing for the default theme (the original stage look). */
export function ScreenBackdrop({ screenConfig }: { screenConfig: unknown }) {
  const bg = resolveScreenBackground(screenConfig)
  if (!bg.asset) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-0" data-testid="screen-backdrop" data-theme={bg.id} aria-hidden>
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bg.asset})` }} />
      {bg.overlay && <div className="absolute inset-0" style={{ background: bg.overlay }} />}
    </div>
  )
}
