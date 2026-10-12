# Migrazione dei file foto: Supabase Storage → Firebase Storage

Stato: **strategia, nessun file spostato.** I metadati (Firestore) si migrano con `backend/scripts/backfill-photos.ts`; i binari sono un passo
separato, esplicito e reversibile. Questo documento definisce come farlo in sicurezza.

## Perché serve (e quando no)
- Le foto legacy stanno nel bucket **privato** `wedding-photos` di Supabase (`<sessionId>/<ts>-<rand>.<ext>`), servite con signed URL da Render.
  Con Render sospeso non sono raggiungibili: **ogni foto legacy che deve restare visibile va copiata**.
- Eventi **nuovi** (nati su Firebase) e eventi **senza foto legacy** non richiedono nulla.
- Foto non approvate / rifiutate di eventi chiusi possono essere lasciate indietro **solo** con decisione esplicita dell'owner (vanno archiviate prima di
  spegnere Supabase: il bucket non va cancellato finché il report di verifica non è chiuso).
- Foto vincitore (`screen_config.winner_announcement.{groom,bride}_photo_path`): stessa procedura, destinazione `events/{id}/winner/…`.

## Prerequisiti
1. Eventi già in Firestore (backfill eventi) e **metadati foto** già applicati (`backfill-photos.ts --apply`): ogni foto ha il suo doc con `storagePath: ''` e
   `legacyStoragePath`.
2. `storage.rules` + `firestore.rules` + Functions foto deployate e verificate (regole per `events/{id}/photos/**` e `events/{id}/winner/**`).
3. Il service account che esegue la copia ha `roles/storage.objectAdmin` **solo** sul bucket Firebase e può leggere (service role Supabase, dal secret
   manager o da env locale, mai nel repo) il bucket `wedding-photos`.
4. Manifest generato in dry-run: `backfill-photos.ts --plan-binaries --manifest-out manifest.json` (0600, locale, **non** committare). Contiene, per file,
   `legacyPath → targetPath` deterministici e il content-type atteso. Nessuna rete, nessuno Storage.

## Procedura (executor separato, da scrivere e rivedere prima dell'uso)
1. **Inventario**: contare file e byte dal manifest + `list` del bucket legacy; confrontare con le righe del DB (file mancanti = report, non errore bloccante).
2. **Dry-run dell'executor**: scarica i primi N file in una cartella temporanea locale, calcola `sha256`, **non scrive** su Firebase; stampa il report.
3. **Copia a lotti** (concorrenza bassa, ad es. 4): per ogni voce del manifest
   - se `targetPath` esiste già con stessa dimensione → salta (idempotente, rieseguibile);
   - scarica da Supabase (signed URL di breve durata o service role), verifica `content-type` ∈ {jpeg, png, webp} e `size ≤ 8 MB`
     (file fuori limite: **non** copiati, nel report);
   - carica con Admin SDK su `targetPath` con metadata `{contentType, firebaseStorageDownloadTokens: <uuid>, legacySha256, legacyPath}`;
   - rilegge i metadata e confronta `size` e `sha256`; solo allora aggiorna Firestore: `photos/{id}.storagePath = targetPath` (e `binaryCopiedAt`);
   - per le foto vincitore: aggiorna `screenConfig.winner_announcement.<role>_photo_path` con il nuovo path (via transazione, solo se il valore
     è ancora quello legacy: non sovrascrive modifiche dell'owner).
4. **Chiusura per evento**: quando **tutte** le foto dell'evento (e i file vincitore) hanno `storagePath` valido e verificato →
   `events/{id}.photosMigratedAt = now` (da qui la TV e la dashboard servono da Firebase). Prima di allora l'evento resta sul percorso legacy.
5. **Report finale**: copiati / saltati (già presenti) / falliti / fuori limite, byte totali, mismatch checksum (deve essere 0). Un solo mismatch ferma
   la chiusura dell'evento interessato.

## Sicurezza
- Nessuna cancellazione nel bucket legacy durante la migrazione. La pulizia (se mai) è un passo successivo, dopo ≥ 30 giorni e un backup/export.
- Nessun file legacy diventa pubblico: l'accesso resta governato da `storage.rules` (solo foto `approved` agli ospiti, tutto all'owner) e dai token
  ruotati alla de-approvazione.
- Credenziali Supabase solo in memoria/ambiente della sessione, mai su disco nel repo, mai nei log. I log contengono id mascherati e conteggi.
- Il manifest e i report sono locali (0600), come gli snapshot.

## Rollback
- Prima della chiusura di un evento: azzerare `storagePath` (e rimuovere l'oggetto copiato, se creato da questo run) riporta l'evento al percorso legacy;
  `photosMigratedAt` non è ancora impostato, quindi la TV usa ancora il payload legacy.
- Dopo la chiusura: rimuovere `photosMigratedAt` (e `storagePath`) ripristina il comportamento legacy; i file su Firebase possono restare.

## Ordine di cutover consigliato
1. Deploy regole + Functions foto → verifica cloud.  2. Backfill metadati (dry-run → apply).  3. Plan + copia binari (dry-run → copia a lotti → verifica).
4. Accensione del flag dashboard / public-read per l'owner.  5. Solo dopo, spegnimento definitivo del percorso legacy foto.
