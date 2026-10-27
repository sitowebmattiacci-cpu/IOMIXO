// Server / test only: every MIOLOVE text of a language — the core file (locales/miolove/<lang>.json, bundled for the browser) plus the public-page file
// (locales/miolove/public/<lang>.json: home, guide, service-page titles; delivered by the server with the pages that read them). Never import this from a client
// component: it would put the public texts back in the browser bundle. A language is added here when it goes live.
import itCore from '@/locales/miolove/it.json'
import enCore from '@/locales/miolove/en.json'
import frCore from '@/locales/miolove/fr.json'
import esCore from '@/locales/miolove/es.json'
import itPublic from '@/locales/miolove/public/it.json'
import enPublic from '@/locales/miolove/public/en.json'
import frPublic from '@/locales/miolove/public/fr.json'
import esPublic from '@/locales/miolove/public/es.json'

export const CORE_FILES = { it: itCore, en: enCore, fr: frCore, es: esCore } as const
export const PUBLIC_FILES = { it: itPublic, en: enPublic, fr: frPublic, es: esPublic } as const
/** Core + public, per published language. */
export const MIOLOVE_FULL = {
  it: { ...itCore, ...itPublic }, en: { ...enCore, ...enPublic }, fr: { ...frCore, ...frPublic }, es: { ...esCore, ...esPublic },
} as const
