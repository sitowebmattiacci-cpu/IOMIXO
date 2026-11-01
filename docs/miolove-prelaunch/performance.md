# Fase 4 — Prestazioni: Firebase / Auth / App Check / reCAPTCHA sulla home pubblica

## Problema (verificato)
`AuthProvider` è nel layout radice: su **ogni** pagina caricava il Firebase SDK, inizializzava Auth e App Check e quindi scaricava `google.com/recaptcha/enterprise.js` — anche per chi apre la home, la guida o le pagine legali senza avere un account (la quasi totalità del traffico di promozione). Effetti: ~50 kB di JS in più, uno script di terzi con cookie (`_GRECAPTCHA`, causa del punteggio "best practices" 75), lavoro inutile sul thread principale.

## Correzione (implementata in locale, NON deployata)
`lib/auth/deferAuth.ts` + `lib/auth/AuthProvider.tsx`:
* Su una **pagina pubblica MIOLOVE** (home e guida in ogni lingua pubblicata, `/privacy`, `/terms`) il SDK **non viene scaricato né inizializzato** se il browser **non ha una sessione Firebase**. La sessione si legge direttamente dall'IndexedDB del SDK (`firebaseLocalStorageDb`, chiave `firebase:authUser:…`) senza caricare nulla.
* Se la sessione c'è (cliente che ritorna) → parte tutto come prima e l'intestazione mostra "I miei album".
* Se il browser non sa dirlo (niente `indexedDB.databases()`, errore, niente IndexedDB) → parte tutto come prima.
* **Qualsiasi altra pagina** (login, registrazione, area del proprietario, pagine ospite `/live /booth /screen /remote`, `/auth/action`, tedesco) → comportamento identico a prima. **IOMIXO non è toccato** (la deroga vale solo per l'host MIOLOVE).
* Il SDK è ora importato dinamicamente: la home non lo scarica più (`First Load JS` home 312 → 265 kB, guida 308 → 261 kB).

## Misure (build di produzione locale, Chrome headless, ogni uscita verso Internet bloccata e registrata)
| Scenario | File JS | JS kB | Richieste esterne |
|---|---|---|---|
| Nuovo visitatore `/`, `/en`, `/es/ideas` | 17 | 271–274 | **nessuna** |
| Nuovo visitatore `/privacy`, `/terms` | 14 | 248 | **nessuna** |
| Cliente con sessione `/` (= comportamento di prima per tutti) | 20 | 322 | `google.com/recaptcha/enterprise.js` |
| Nuovo visitatore `/login`, `/register` | 21–23 | 450–462 | `google.com/recaptcha/enterprise.js` (come prima) |

Lighthouse mobile (locale, throttling standard; i numeri assoluti dipendono dalla macchina): performance 76–85, accessibilità 96, SEO 100. L'LCP resta 4.3–6.6 s in laboratorio (immagine hero + font): **non risolto da questa modifica** e non è un blocco al lancio, ma è il prossimo punto da guardare (misurare su dati reali CrUX/Search Console dopo la messa online).

## Effetti su sicurezza, login, prova gratuita, IOMIXO
| Area | Effetto |
|---|---|
| **Sicurezza** | Nessuna riduzione: l'App Check è *non obbligatorio* oggi (osservato, non imposto) e comunque protegge le chiamate, che iniziano solo su pagine che avviano Firebase. Le regole Firestore/Storage e le Functions non cambiano. Meno script di terzi sulla home = meno superficie. |
| **Login / registrazione / Google** | Invariati: `/login` e `/register` avviano Firebase come prima (misurato: reCAPTCHA caricato). Navigando dalla home a `/login` con un clic, l'`AuthProvider` (che resta montato) avvia il SDK alla prima pagina non pubblica. |
| **Prova gratuita** | Invariata: parte dalla registrazione/onboarding, pagine che avviano Firebase. |
| **Cliente già autenticato** | Vede la home con "I miei album" come prima (legge la sessione dall'IndexedDB). Un cliente che ha *fatto logout* trova l'archivio vuoto → home senza Firebase (corretto). |
| **Guest** (QR) | Invariato: `/live /booth /screen` non sono pagine pubbliche nel registro. Un ospite che apre poi la home: l'IndexedDB contiene l'utente anonimo → Firebase parte come prima (innocuo). |
| **IOMIXO** | Nessun cambio (host diverso → nessuna deroga). Il caricamento dinamico del SDK riguarda anche IOMIXO ma non ne cambia il comportamento: l'`AuthProvider` avvia comunque l'ascolto al primo render. |
| **Rischio residuo** | Se in futuro una pagina pubblica dovesse mostrare dati dell'utente o chiamare una callable, va tolta dal registro pubblico o deve avviare Firebase. Il test `miolovaDeferAuth.test.ts` fissa l'elenco delle pagine che possono rimandare Firebase. |

## Contrasto (WCAG AA) — rispettando il design MIOLOVE
Lighthouse sulla home: **81 nodi con contrasto insufficiente** nel progetto di partenza, tutti riconducibili a tre colori della palette:
| Colore | Uso | Contrasto | Correzione applicata |
|---|---|---|---|
| `#85858C` (`wd-muted`) su bianco/rosa chiaro | testi secondari, descrizioni, etichette | 3.3–3.7 | `#6B6B73` (grigio impercettibilmente più scuro): 4.5–5.3 |
| `#F06A9B` / `#E8538A` come **testo** piccolo (eyebrow, "COME FUNZIONA", "Pagamento unico", link) | testo | 2.6–3.5 | nuovo token `wd-pink-ink #CF1C5E` per il solo testo piccolo rosa (stessa tonalità, 4.5–5.3) nelle pagine pubbliche; i riempimenti e le icone restano nel rosa del brand |
| `#9E9EA4` (prezzo barrato 39,99 €, `muted/70`) | testo | 2.7 | colore `wd-muted` pieno |

Risultato (stessa misura, dopo la correzione): **81 → 6 nodi** sulla home, **1** nella guida.
**Bottoni rosa con testo bianco (applicato su richiesta del titolare):** il rosa del brand `#F06A9B` con testo bianco dava 2,9:1. Il riempimento resta identico; l'etichetta passa dal bianco all'inchiostro del tema (`wd-ink #1F2028`): **5,6:1** (4,7:1 in hover su `#E8538A`). Interessati solo i bottoni MIOLOVE: CTA e navigazione della home, guida, schede piano e badge "Consigliato", stato album, onboarding. **Non toccati** (stesso schema ma fuori dal perimetro pubblico/IOMIXO): pannelli admin e pagine ospite del matrimonio, `LanguageSwitcher`, telecomando, finestra d'acquisto tedesca: elenco in `release-plan.md`.
