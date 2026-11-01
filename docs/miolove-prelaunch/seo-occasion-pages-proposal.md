# Proposta — prime pagine SEO per occasione (NON implementata)

Obiettivo: intercettare ricerche del tipo "album foto matrimonio QR code", "raccogliere foto invitati compleanno", "album battesimo condiviso". Oggi esistono solo la home e la guida "Idee" (registro `lib/miolove/pages.ts`: ogni pagina nuova = una voce + un file di testi per lingua; sitemap, hreflang, canonical e 404 delle lingue in bozza sono automatici).

## Pagine e URL (4 lingue)
| Pagina | IT | EN | FR | ES |
|---|---|---|---|---|
| Matrimonio | `/matrimonio` | `/en/wedding` | `/fr/mariage` | `/es/bodas` |
| Compleanno | `/compleanno` | `/en/birthday` | `/fr/anniversaire` | `/es/cumpleanos` |
| Battesimo | `/battesimo` | `/en/baptism` | `/fr/bapteme` | `/es/bautizo` |

Ordine di lavoro consigliato: **matrimonio** (prodotto nato per quello, più ricerche e più valore per ordine), poi **compleanno**, poi **battesimo**. Una alla volta, con un passaggio di revisione per ciascuna.

## Contenuto di ogni pagina (400–700 parole originali, non una variante del testo della home)
1. H1 con la ricerca principale ("Album foto con QR code per il tuo matrimonio") e una promessa verificabile: 7 giorni gratis, nessuna app per gli invitati, slideshow live.
2. Come funziona **in quell'occasione** (matrimonio: tavoli con QR, cerimonia/ricevimento, slideshow durante la festa; compleanno: festa a sorpresa, dediche; battesimo: familiari lontani che non hanno app).
3. Cosa ricevi: foto e video originali, scarico in un unico ZIP, 365 giorni, prezzo unico 19,99 € per album (dato preso da `plans.ts`, mai ricopiato a mano).
4. 4–5 FAQ **specifiche** dell'occasione (visibili sulla pagina, marcate `FAQPage`).
5. CTA "Prova gratis 7 giorni" e link incrociati alla guida Idee e alle altre occasioni.
6. Immagine propria per occasione con `alt` descrittivo (nessuna immagine di stock con persone riconoscibili senza licenza).

## SEO tecnico
* `canonical` autoreferenziale, `hreflang` completo tra le 4 lingue + `x-default` (italiano), voce in sitemap: tutto da registro.
* Dati strutturati: `BreadcrumbList` + `FAQPage` + `WebPage`; **nessun `aggregateRating`/recensione** (non esistono).
* Title ≤ 60 e description ≤ 160 caratteri (test già presente: `miolovaMetaLatam.test.ts`, da estendere alle nuove pagine).
* Nessuna pagina duplicata: ogni occasione ha testo e FAQ propri; un test confronta le similarità tra pagine.

## Spagnolo per il mercato latinoamericano
* Una sola variante neutra (tú, "video", "teléfono", "tomar fotos"), già applicata ai testi esistenti.
* Parole di ricerca: *boda*, *cumpleaños*, *bautizo*; in America Latina esiste forte domanda per **quinceañera / XV años**: è un'occasione commerciale distinta (non un compleanno qualunque). Proposta per una fase successiva: pagina `/es/quinceaneras`, solo in spagnolo, **solo se il titolare vuole puntare davvero a quel mercato** (richiede anche valuta e IVA/imposte locali: oggi la lingua spagnola vende in EUR).
* Verifica con un madrelingua latinoamericano prima di pubblicare (non ho potuto: nessun revisore a disposizione).

## Prima di scrivere
Decisioni richieste: (1) ordine delle pagine; (2) se mostrare il prezzo nelle pagine (consigliato sì, da `plans.ts`); (3) immagini (da fornire o generare); (4) revisione madrelingua per FR/ES.
