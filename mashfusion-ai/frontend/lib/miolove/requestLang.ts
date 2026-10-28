// Server only: the MIOLOVE language of a request whose URL does not carry one (sign-in, dashboard, guest page, privacy…).
//   1. the language the visitor chose last (cookie ml_lang), else
//   2. the browser's preferred language (Accept-Language), read exactly like the client does with navigator.language: the first tag, two letters, if supported,
//   3. Italian.
// Rendering the first HTML in that language is what keeps a guest abroad from seeing Italian before the page switches.
import { cookies, headers } from 'next/headers'
import { isLiveLang, DEFAULT_LANG, type MioloveLang } from './langs'
import { LANG_COOKIE } from './langCookie'

export function localeFromAcceptLanguage(header: string | null | undefined): MioloveLang {
  const first = (header ?? '').split(',')[0]?.trim().slice(0, 2).toLowerCase()
  return isLiveLang(first) ? first : DEFAULT_LANG
}

/** `explicit`: the visitor chose it (cookie). Otherwise it is only the browser's guess, and a language saved in localStorage may still override it on the client. */
export function requestLanguage(): { lang: MioloveLang; explicit: boolean } {
  const c = cookies().get(LANG_COOKIE)?.value
  if (isLiveLang(c)) return { lang: c, explicit: true }
  return { lang: localeFromAcceptLanguage(headers().get('accept-language')), explicit: false }
}

export const requestLang = (): MioloveLang => requestLanguage().lang
