# Checklist test manuale — MIOLOVE (produzione, account ed evento di PROVA)

Da fare una volta sola dopo ogni rilascio frontend. Usare un account di prova creato apposta (`prova+miolove@…`) e un evento di prova intitolato "TEST – da cancellare". **Nessun pagamento Stripe live.** Alla fine cancellare l'evento di prova dal pannello.

## 0. Prima di iniziare (2 min)
- [ ] Browser: Chrome Android (telefono vero), Safari iPhone, un computer. Modalità normale, non anonima, non automatica (App Check dà 403 ai browser automatici: è atteso).
- [ ] Aprire https://miolovealbum.com — il titolo della scheda è "MIOLOVE ALBUM — Album foto con QR code per matrimoni e feste".

## 1. Lingue e home senza sessione
- [ ] `/`, `/en`, `/fr`, `/es`: testo nella lingua giusta, nessuna chiave grezza (es. `home.nav…`), menu ☰ si apre, i pulsanti rosa hanno l'etichetta scura leggibile.
- [ ] `/de` risponde "pagina non trovata" (il tedesco è in bozza: DEVE essere 404).

## 2. Registrazione e login
- [ ] `/register` con l'account di prova (e-mail vera tua): arriva la mail di verifica col marchio MIOLOVE; il link la conferma.
- [ ] Logout, poi `/login` con e-mail e password; poi "Accedi con Google" (se in uso).
- [ ] Home con sessione: il pulsante diventa "I miei album" (non "Accedi").
- [ ] Home dopo logout: torna "Accedi" e nessuna richiesta a reCAPTCHA prima di aprire /login (DevTools → Rete, facoltativo).

## 3. Prova gratuita ed evento
- [ ] Crea un evento di prova con la prova gratuita di 7 giorni (nessuna carta richiesta). Appare "Prova gratuita" con il contatore foto 0/50.

## 4. QR e link ospiti
- [ ] Dal pannello: apri il QR; scansionalo con il telefono → si apre la pagina ospite (non il login).
- [ ] Copia il link e aprilo in una finestra anonima e su un altro telefono: la pagina ospite si apre senza account.
- [ ] Android: aprire il link dal telefono con Chrome e anche da WhatsApp (browser interno) — la pagina deve caricarsi (è il caso dei bug Android già corretti).

## 5. Foto e video (ospite)
- [ ] Foto dalla galleria e foto dalla fotocamera (permesso fotocamera): compare nella galleria del pannello; contatore 1/50.
- [ ] Video breve (~10 s): caricato e riproducibile; qualità originale.
- [ ] Nome ospite digitato → compare sulla foto; vuoto → "Anonimo".
- [ ] Download di UNA foto originale dal pannello. (Con 2+ foto in prova: lo ZIP è bloccato e viene proposto "Attiva l'album" — atteso.)
- [ ] Elimina una foto: il contatore scende.

## 6. Slideshow / TV
- [ ] Apri la schermata TV dall'evento: mostra le foto nuove entro pochi secondi.

## 7. PWA e Android
- [ ] Chrome Android → menu ⋮ → "Aggiungi a schermata Home": nome "MIOLOVE", icona rosa corretta; aprendola si avvia a tutto schermo sulla home/pannello.
- [ ] iPhone Safari → Condividi → "Aggiungi a Home": icona e nome corretti.
- [ ] Ruotare il telefono e tornare indietro/avanti non perde la sessione.

## 8. IOMIXO (non deve essere cambiato)
- [ ] https://iomixo.com si apre, `/login` mostra il modulo; accesso con un account IOMIXO esistente se ne hai uno.

## 9. Pulizia
- [ ] Elimina l'evento di prova e, se vuoi, l'account di prova.

## Cosa segnalare come BLOCCANTE
Ospite che non riesce a caricare una foto/video; QR che porta al login; login/registrazione che non completano; mail di verifica che non arriva entro 5 minuti; pagina bianca su Android; `/de` raggiungibile; prezzo diverso da 19,99 € (39,99 € barrato).
