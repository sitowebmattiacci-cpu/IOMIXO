# MIOLOVE ALBUM — checklist definitiva delle informazioni mancanti (pagine legali e checkout)

Data 2026-11-02. Non è consulenza legale: è l'elenco di cosa **serve** prima di vendere, con lo stato verificato nel codice. **Nessun dato è stato inventato**: dove manca, è scritto «da fornire». I riferimenti normativi sono promemoria da far confermare dal consulente.
Legenda stato: **NOTO** (verificato nel codice o deciso dal titolare) · **DA FORNIRE** (dato che solo il titolare ha) · **DA DECIDERE** · **DA VERIFICARE** (con il consulente o con Stripe).
Fonti lette in sola lettura: questo ramo (`lib/legal/privacy.ts`, `terms.ts`, `types.ts`) e, con `git show`, le bozze dell'altro ramo (`feat/miolove-de-functions`: `lib/legal/miolove.ts`, `docs/miolove-prelaunch/legal-review.md`). Nulla è stato copiato.

## 1. Dati del venditore
| Informazione | Stato | Note |
|---|---|---|
| Nome / denominazione del venditore | NOTO (decisione del titolare, bozza altro ramo): «Enrico Mattia Curzi», marchio MIOLOVE ALBUM | non pubblicato in questo ramo; «EMC Group» non deve comparire |
| Indirizzo geografico (o domicilio eleggibile) | **DA FORNIRE** | obbligatorio nelle informazioni precontrattuali e nell'informativa art. 13 GDPR; serve anche per inviare il recesso |
| Partita IVA / codice fiscale e regime fiscale | **DA FORNIRE** | anche se forfettario o altro regime: va indicato correttamente |
| Iscrizione a registro (se dovuta) | DA FORNIRE / DA VERIFICARE | |
| Email di contatto | NOTO: `info@miolovealbum.com` | |
| Secondo recapito rapido (telefono o modulo) | DA DECIDERE | le regole sui contratti a distanza chiedono un recapito che consenta contatto rapido |
| Dove compare l'identità del venditore | DA DECIDERE | Termini, Privacy, footer, pagina checkout |

## 2. Prezzo e trattamento fiscale
| Informazione | Stato |
|---|---|
| Prezzo 19,99 € per album, pagamento unico | NOTO (`plans.ts`; l'importo addebitato lo decide il Price Stripe: **da confermare** con `stripe-verification-procedure.md`) |
| Prezzo in USD (19,99 $) e sua conferma | DA DECIDERE (oggi replica la cifra in euro) e DA VERIFICARE su Stripe |
| Il prezzo è **IVA inclusa**? aliquota? | **DA FORNIRE / DA DECIDERE** (oggi `terms.ts:49,55`: «IVA o altre imposte sono aggiunte ove richiesto» e la sessione non imposta `automatic_tax`: l'importo finale potrebbe non coincidere con quello mostrato) |
| IVA per consumatori UE fuori Italia (OSS) e imposte per clienti USA/extra-UE | DA DECIDERE con il commercialista; Stripe Tax sì/no |
| Ricevuta / fattura e dati richiesti all'acquirente | DA DECIDERE |
| Prezzo barrato / Omnibus | RISOLTO sul sito (rimosso il 39,99); resta solo il prezzo reale. Prima di future promozioni: regola dei 30 giorni |
| Codici promozionali (`allow_promotion_codes: true`) | DA DECIDERE: condizioni, validità, o disattivarli (richiede modifica alla Function: tua autorizzazione) |
| Valuta in funzione di lingua e non del paese | DA DECIDERE (v. `currency-language-proposal.md`) |

## 3. Durata del servizio
| Informazione | Stato (verificato nel codice) |
|---|---|
| Prova gratuita | NOTO: 1 per account, 7 giorni, max 50 tra foto e video, nessun metodo di pagamento |
| Dopo la prova | NOTO: nuovi caricamenti fermi; contenuti conservati altri **30 giorni** poi eliminati (`purge.ts:13`, `TRIAL_GRACE_DAYS`) |
| Album a pagamento | NOTO: **365 giorni** dall'attivazione; eliminazione alla scadenza, nessun periodo di grazia dopo i 365 giorni |
| Cosa accade alla scadenza; promemoria via email | NOTO (30, 7, 1 giorni prima per l'album pagato) |
| Rinnovo | NOTO: nessun rinnovo automatico, nessun abbonamento |
| Limiti tecnici | NOTO: nessun tetto agli invitati né al totale dell'album; per invitato fino a 500 contenuti; video ≤ 150 MB, foto ≤ 50 MB |
| Cosa resta dopo l'eliminazione (record amministrativo, pagamenti, riserva «una prova per account») | NOTO ma **DA DICHIARARE** nella privacy |
| Garanzia di conformità del contenuto/servizio digitale e assistenza | DA DECIDERE / DA VERIFICARE (diritti del consumatore su contenuto digitale) |

## 4. Diritto di recesso (consumatori)
| Informazione | Stato |
|---|---|
| Regime scelto | **DA DECIDERE**: (1) 14 giorni pieni (oggi nelle bozze, nessun consenso richiesto); (2) servizio digitale con inizio immediato su richiesta espressa e presa d'atto della perdita del recesso a esecuzione completa (richiede due dichiarazioni nel checkout **prima** di Stripe; l'articolo applicabile lo indica il consulente) |
| Testo attuale in produzione («pagamenti non rimborsabili salvo legge») | NON adatto a un regime senza consenso espresso: **DA CORREGGERE** (`terms.ts:49,55`) |
| Modulo tipo di recesso e indirizzo/recapito per inviarlo | **DA FORNIRE** |
| Email di conferma dell'ordine con le informazioni precontrattuali su supporto durevole | DA IMPLEMENTARE (oggi non verificato) |
| Pulsante di recesso elettronico (Dir. 2023/2673, dal 19/06/2026) | DA VERIFICARE con il consulente |
| Rimborsi oltre il recesso (doppio addebito, errore tecnico) e procedura | DA DECIDERE |

## 5. Consensi eventualmente necessari
| Consenso / dichiarazione | Stato |
|---|---|
| Accettazione di Termini e Privacy alla registrazione | DA VERIFICARE nel flusso di registrazione (testo e collegamenti) |
| Richiesta espressa di esecuzione immediata + presa d'atto della perdita del recesso | DA DECIDERE (v. §4); oggi non raccolta per IT/FR/ES/EN |
| Pulsante «ordine con obbligo di pagare» (o dicitura equivalente) prima del pagamento | DA VERIFICARE (testo attuale «Attiva album — {prezzo}») |
| Cookie e strumenti tecnici (sessione, preferenze lingua, App Check, reCAPTCHA Enterprise) | DA VERIFICARE: «strettamente necessari» o consenso? oggi nessun banner |
| Marketing / newsletter | NOTO: nessuna; se verranno aggiunte serve consenso separato |
| Segnalazione di contenuti illeciti (DSA art. 16) | DA VERIFICARE: l'email basta come meccanismo? |

## 6. Privacy e trattamento delle foto degli invitati
| Informazione | Stato |
|---|---|
| Titolare e contatti completi (nome, indirizzo, email); DPO se necessario | NOTO in parte; **indirizzo DA FORNIRE** |
| **Ruoli sulle foto degli ospiti**: titolare l'organizzatore dell'album e MIOLOVE responsabile (art. 28) oppure contitolarità | **DA DECIDERE con il consulente**; il testo deve dire chi informa gli ospiti e chi risponde |
| Basi giuridiche (contratto, legittimo interesse, obbligo di legge) per account, pagamenti, foto di terzi | DA VERIFICARE |
| **Foto di minori** (battesimi, feste di bambini: le landing li citano) e età minima del servizio (16 nel testo; 14 per il consenso digitale in Italia) | DA DECIDERE / DA VERIFICARE |
| Dati trattati e conservati: file originali con metadati EXIF, nome facoltativo dell'ospite, log tecnici, pagamenti | NOTO (codice) → **DA DICHIARARE** |
| Tempi di conservazione (account, album, log, backup, dati fiscali) | DA DICHIARARE; periodi di log e backup non verificati |
| Fornitori: Google Firebase / Google Cloud (Auth, Firestore, Storage, Functions in europe-west1, hosting), App Check, reCAPTCHA Enterprise, Stripe, Resend | NOTO; **regione di Storage/Firestore non verificabile dal repository** (da confermare in console) |
| Trasferimenti extra-SEE e garanzie (DPF / clausole contrattuali, DPA firmati) | DA VERIFICARE |
| Diritti dell'interessato, reclamo al Garante, modalità di richiesta | testo presente in forma generica; **DA COMPLETARE** con i recapiti |
| Testi in produzione ancora generici/IOMIXO: «piano, stato dell'abbonamento» (`privacy.ts:12,69,126,183`) | **DA CORREGGERE** per MIOLOVE |
| Quale testo vale alla data di pubblicazione (produzione vs bozze dell'altro ramo con `MIOLOVE_LEGAL_REVIEWED = false`) | DA DECIDERE; non copiato qui |

## 7. Informazioni obbligatorie **prima del pagamento** (contratto a distanza con consumatori)
Da mostrare in modo chiaro prima del clic finale (pagina di attivazione e/o Termini collegati) — verificare l'elenco esatto con il consulente:
1. Caratteristiche principali del servizio (album digitale per evento, QR code, caricamenti degli invitati, slideshow, scarico ZIP, cartoncini) — NOTO.
2. Identità e indirizzo del venditore, recapito — **DA FORNIRE**.
3. **Prezzo totale comprensivo di imposte** e modalità di pagamento (carta, PayPal) — prezzo NOTO, trattamento fiscale **DA DECIDERE**.
4. Durata del contratto e condizioni di cessazione (365 giorni, nessun rinnovo, eliminazione dei contenuti) — NOTO.
5. Diritto di recesso (condizioni, termini, modulo) oppure informazione sulla sua perdita se si sceglie il regime con inizio immediato — **DA DECIDERE**.
6. Funzionalità e requisiti tecnici del contenuto digitale (browser, nessuna app, formati e dimensioni dei file) — NOTO.
7. Assistenza post-vendita, gestione dei reclami, garanzia legale di conformità — **DA FORNIRE**.
8. Dicitura del pulsante di pagamento e conferma su supporto durevole dopo l'acquisto — **DA VERIFICARE / DA IMPLEMENTARE**.

## 8. Sintesi: cosa serve da te prima di aprire le vendite
(a) indirizzo e partita IVA/regime; (b) IVA inclusa o no e gestione imposte USD/UE; (c) scelta sul recesso; (d) ruoli privacy sulle foto degli ospiti e minori; (e) testo legale valido e revisione del consulente; (f) conferma Stripe dei due Price (procedura separata); (g) decisione su codici promozionali e valuta. Finché mancano (a)-(e) **non attivare le vendite**.
