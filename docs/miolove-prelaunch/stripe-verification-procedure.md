# Verifica in sola lettura dei due Price LIVE (EUR e USD) — procedura per il titolare

Obiettivo: confermare, senza modificare nulla e senza addebitare nulla, che l'importo mostrato (19,99) è quello che Stripe addebita. **Nessun valore segreto va incollato in chat, nel repo o nei log.** Il codice dell'app non viene toccato.

## A. Cosa si verifica e dove
| # | Controllo | Atteso | Dove si legge |
|---|---|---|---|
| 1 | Importo | `unit_amount` = **1999** (centesimi di euro / di dollaro) | Dashboard Stripe o script (§C) |
| 2 | Valuta | EUR sul Price EUR, USD sul Price USD | idem |
| 3 | Pagamento singolo | `type = one_time`, nessuna ricorrenza | idem |
| 4 | Prezzo attivo | `active = true` (e modalità **live**) | idem |
| 5 | Prodotto corretto | stesso prodotto per entrambi i Price, quello dell'«Album completo» MIOLOVE | idem (nome e id del prodotto) |
| 6 | Variabili usate dalla Function in produzione | `STRIPE_PRICE_MIOLOVE_ALBUM_EUR` e `…_USD` presenti e uguali ai due Price ID; chiave e webhook MIOLOVE presenti **come segreti** | §D |
| 7 | Imposte | `tax_behavior` del Price e impostazioni Stripe Tax: decisione fiscale, non tecnica | Dashboard (§B.6) |
Gli ID dei Price non sono segreti: stanno nel file tracciato `firebase/functions/.env.iomixo-494817`, righe 32-33 (`STRIPE_PRICE_MIOLOVE_ALBUM_EUR`, `…_USD`). Il codice non legge importo o valuta da nessun'altra parte: il Price di Stripe decide.

## B. Passaggi nel dashboard Stripe (account **MIOLOVE**, non quello di IOMIXO)
1. Accedi al dashboard dell'account Stripe di MIOLOVE e verifica in alto a destra che **«Modalità di test» sia disattivata** (stai guardando i dati LIVE).
2. Menu **Catalogo prodotti** → apri il prodotto «Album completo» (o simile). Annota il nome e l'ID del prodotto (`prod_…`): devono essere **uno solo** per i due Price.
3. Nella sezione **Prezzi** del prodotto devono comparire due prezzi: **€19,99** e **US$19,99**, entrambi con etichetta **«Una tantum»** (non «Ricorrente») e stato **Attivo**.
4. Apri ciascun prezzo: copia l'ID `price_…` e confronta i **primi 12 caratteri** con il file `.env.iomixo-494817` (righe 32-33). Se differiscono, la Function usa un Price diverso da quello che vedi.
5. In ciascun prezzo controlla «Tipo di fatturazione: una tantum», «Importo: 19,99», «Valuta», e che **non** ci siano scaglioni (tier).
6. Voce **Comportamento fiscale** del prezzo («Imposte incluse / escluse / non specificato») e, in **Impostazioni → Imposte**, se Stripe Tax è attivo e dove sei registrato. Annotalo: serve alla checklist legale.
7. (Facoltativo) **Sviluppatori → Webhook**: deve esistere un endpoint per l'evento `checkout.session.completed` che punta alla Function `miolovestripewebhook`.
Non cliccare «Modifica», «Archivia» né «Crea». Se qualcosa non corrisponde, fermati e segnalamelo: non va corretto durante la verifica.

## C. Controllo automatico (opzionale, sola lettura)
Script pronto, non eseguito da me: [verify-stripe-prices.mjs](verify-stripe-prices.mjs). Fa **due richieste GET** a `/v1/prices/{id}`; non scrive, non crea sessioni, non stampa la chiave. Autotest eseguito solo contro un server finto su `127.0.0.1` (esito corretto sia con dati giusti sia con importo sbagliato).
1. Dashboard → **Sviluppatori → Chiavi API → Crea chiave con restrizioni**, nome «verifica-prezzi-sola-lettura». Permessi: **Prezzi: Lettura**, **Prodotti: Lettura**, tutto il resto **Nessuno**.
2. Nel tuo terminale (la chiave NON va in chat né nel repo):
   ```
   cd /Users/macbookpro/Desktop/IOMIXO-seo
   read -s STRIPE_RESTRICTED_KEY; export STRIPE_RESTRICTED_KEY
   export PRICE_EUR=$(grep '^STRIPE_PRICE_MIOLOVE_ALBUM_EUR=' firebase/functions/.env.iomixo-494817 | cut -d= -f2)
   export PRICE_USD=$(grep '^STRIPE_PRICE_MIOLOVE_ALBUM_USD=' firebase/functions/.env.iomixo-494817 | cut -d= -f2)
   node docs/miolove-prelaunch/verify-stripe-prices.mjs
   unset STRIPE_RESTRICTED_KEY
   ```
3. Atteso: 7 righe `PASS` per valuta, «Same product … yes», `RESULT: CONFIRMED`. Incollami solo l'output dello script (non contiene chiavi).
4. **Elimina la chiave con restrizioni** dal dashboard.

## D. Variabili della Function in produzione (nessun segreto)
Il mio tentativo di leggerle è stato negato dal sistema di permessi (lettura di produzione) e non l'ho aggirato. Due modi, entrambi a tuo carico:
- **Console**: Google Cloud Console, progetto `iomixo-494817` → **Cloud Run** → servizio `createalbumcheckoutsession` → ultima revisione → **Variabili e segreti**. Devono comparire `STRIPE_PRICE_MIOLOVE_ALBUM_EUR`, `STRIPE_PRICE_MIOLOVE_ALBUM_USD`, `MIOLOVE_BASE_URL` (`https://miolovealbum.com`) come variabili, e `STRIPE_MIOLOVE_SECRET_KEY` come **riferimento a un segreto** (non un valore in chiaro). Stesso controllo su `miolovestripewebhook` per `STRIPE_MIOLOVE_WEBHOOK_SECRET`.
- **Terminale** (stampa solo i nomi e i primi 12 caratteri dei Price ID; i segreti compaiono solo come «SECRET-REF»):
  ```
  gcloud run services describe createalbumcheckoutsession --project iomixo-494817 --region europe-west1 --format=json | python3 -c "
  import sys,json
  for e in json.load(sys.stdin)['spec']['template']['spec']['containers'][0].get('env',[]):
      n=e['name']
      if 'valueFrom' in e: print('SECRET-REF',n)
      elif 'PRICE' in n: print(n,(e.get('value') or '')[:12]+'…')
      elif n in ('MIOLOVE_BASE_URL',): print(n,e.get('value'))"
  ```
  (la regione `europe-west1` è quella indicata dal dossier legale; se il servizio non risponde, `gcloud run services list --project iomixo-494817` la mostra.)
Confronta i 12 caratteri con quelli del dashboard (§B.4).

## E. Esito e cosa fare
- Tutto coincide → la verifica è chiusa; annota data e chi l'ha fatta.
- Importo o valuta diversi, Price non attivo, ricorrente, o variabile mancante → **non lanciare**: il checkout fallirebbe (`checkout_unavailable`) o addebiterebbe un importo diverso da quello mostrato.
- Raccomandazione (non implementata): ripetere questo controllo prima di ogni deploy che tocchi i prezzi.
