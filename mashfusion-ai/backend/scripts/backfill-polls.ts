/**
 * Projects EXISTING legacy polls and their vote counts into the Firestore EMULATOR.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx ts-node --transpile-only scripts/backfill-polls.ts polls.json votes.json
 *
 * polls.json : export of `live_polls`       [{ id, session_id, question, options, is_active, created_at }]
 * votes.json : export of `live_poll_votes`  [{ poll_id, option_index }]
 * Never connects to Supabase; refuses to run without the emulator host. Idempotent: polls are created once,
 * and the `legacy` tally shard is REPLACED with the counts computed from votes.json (all pre-existing votes
 * are legacy votes). Events must already be projected (events.legacySupabaseId == session_id).
 */
import { readFileSync } from 'fs'
import { eventRefByLegacySession } from '../src/repositories/eventChildProjection'
import { projectPollCreated, projectPollActive, setLegacyTally, type LegacyPollRow } from '../src/repositories/pollRepository'

;(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (emulator only)')
  const [pollsFile, votesFile] = process.argv.slice(2)
  if (!pollsFile || !votesFile) throw new Error('usage: backfill-polls.ts <polls.json> <votes.json>')
  const polls = JSON.parse(readFileSync(pollsFile, 'utf8')) as LegacyPollRow[]
  const votes = JSON.parse(readFileSync(votesFile, 'utf8')) as Array<{ poll_id: string; option_index: number }>

  let created = 0, existing = 0, noEvent = 0, tallies = 0
  for (const p of [...polls].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!(await eventRefByLegacySession(p.session_id))) { noEvent++; continue }
    if (await projectPollCreated(p)) created++
    else { existing++; await projectPollActive(p.session_id, p.id, p.is_active) }
    const counts = new Array(p.options.length).fill(0)
    for (const v of votes) if (v.poll_id === p.id && v.option_index < counts.length) counts[v.option_index]++
    if (await setLegacyTally(p.session_id, p.id, counts)) tallies++
  }
  console.log(`backfill polls done: created=${created} alreadyProjected=${existing} tallies=${tallies} skippedNoEvent=${noEvent}`)
})().catch((e) => { console.error(e.message); process.exit(1) })
