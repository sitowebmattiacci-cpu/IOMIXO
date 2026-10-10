/**
 * Projects EXISTING legacy rows into the Firestore EMULATOR (music requests or dedications).
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx ts-node --transpile-only scripts/backfill-event-children.ts <requests|dedications> rows.json
 *
 * Input: a JSON array exported from Supabase `live_requests` / `live_dedications`
 *   requests:    [{ id, session_id, track_title, artist, message, status, created_at }]
 *   dedications: [{ id, session_id, guest_name, message, status, created_at }]
 * Never connects to Supabase; refuses to run without the emulator host. Idempotent.
 * Events must already be projected (events.legacySupabaseId == session_id); other rows are reported and skipped.
 * For requests it also sets each event's counter (events/{id}/state/requests.total) to the real number of docs.
 */
import { readFileSync } from 'fs'
import { FieldValue } from 'firebase-admin/firestore'
import { firestore } from '../src/lib/firebaseAdmin'
import { eventRefByLegacySession } from '../src/repositories/eventChildProjection'
import { projectRequestCreated } from '../src/repositories/requestRepository'
import { projectDedicationCreated } from '../src/repositories/dedicationRepository'

const KINDS = {
  requests:    { collection: 'requests',    counter: true,  project: (r: any) => projectRequestCreated(r) },
  dedications: { collection: 'dedications', counter: false, project: (r: any) => projectDedicationCreated(r) },
} as const

;(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (emulator only)')
  const [kindArg, file] = process.argv.slice(2)
  const kind = KINDS[kindArg as keyof typeof KINDS]
  if (!kind || !file) throw new Error('usage: backfill-event-children.ts <requests|dedications> <rows.json>')
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<{ id: string; session_id: string; created_at?: string }>

  let created = 0, existing = 0, noEvent = 0
  const sessions = new Set<string>()
  for (const row of [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    sessions.add(row.session_id)
    if (await kind.project(row)) { created++; continue }
    ;(await eventRefByLegacySession(row.session_id)) ? existing++ : noEvent++
  }

  if (kind.counter) {
    for (const sessionId of sessions) {
      const eventRef = await eventRefByLegacySession(sessionId)
      if (!eventRef) continue
      const total = (await eventRef.collection(kind.collection).count().get()).data().count
      await eventRef.collection('state').doc('requests').set({ total, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    }
  }
  console.log(`backfill ${kindArg} done: created=${created} alreadyProjected=${existing} skippedNoEvent=${noEvent}`)
})().catch((e) => { console.error(e.message); process.exit(1) })
