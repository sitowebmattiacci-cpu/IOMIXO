/**
 * One-shot: gives pre-existing MIOLOVE albums their retention dates (see src/albums/backfill.ts).
 *
 *   DRY RUN (default, writes nothing):  GCLOUD_PROJECT=iomixo-494817 npx tsx scripts/backfill-album-expiry.ts
 *   APPLY:                              GCLOUD_PROJECT=iomixo-494817 npx tsx scripts/backfill-album-expiry.ts --apply
 *
 * Uses Application Default Credentials (gcloud auth application-default login). Run the dry run first and read the report.
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { backfillAlbumExpiry } from '../src/albums/backfill'

initializeApp()
backfillAlbumExpiry(getFirestore(), { apply: process.argv.includes('--apply') })
  .then((r) => { console.log(JSON.stringify(r, null, 2)); if (!r.applied) console.log('\nDRY RUN: nothing was written. Re-run with --apply to write.') })
  .catch((e) => { console.error(e); process.exit(1) })
