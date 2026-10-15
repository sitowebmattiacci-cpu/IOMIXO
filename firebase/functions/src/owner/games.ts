import { FieldValue, Timestamp, type DocumentData, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { fail } from '../shared/guard'
import { idField, requireEventOwner, requireOwnerEventAccess, type CallerAuth } from './guard'

/**
 * DJ-side games on Firestore: events/{eventId}/games/{roundId} { type, status, config, result, createdAt, updatedAt } (same shape the
 * guest / TV listeners already read) and the owner-private customisation events/{eventId}/private/gameConfig
 * { roulettePenitenze?: Penitenza[], shoeGameQuestions?: string[] } (readable only by the owner, written only here).
 * Behaviour is a port of routes/liveGames.ts (roulette start/spin/reset, shoe start/next/reset). Team Battle is NOT part of this.
 */
export type GameKey = 'roulette' | 'shoe'
export type GameAction = 'start' | 'spin' | 'next' | 'reset'
const TYPE = { roulette: 'wedding_roulette', shoe: 'shoe_game' } as const
const ACTIONS: Record<GameKey, readonly GameAction[]> = { roulette: ['start', 'spin', 'reset'], shoe: ['start', 'next', 'reset'] }
export const CATEGORIES = ['soft', 'party', 'wild'] as const
export const GAME_LIMITS = { label: 120, question: 200, maxItems: 60 } as const

export interface Penitenza { label: string; category: 'soft' | 'party' | 'wild'; enabled: boolean }
export interface GameActionInput { eventId: string; game: GameKey; action: GameAction; categories?: string[]; questions?: string[] }

export const DEFAULT_ROULETTE_PENITENZE: Penitenza[] = [
  { label: 'Brindisi agli sposi 🥂', category: 'soft', enabled: true }, { label: 'Foto di gruppo 📸', category: 'soft', enabled: true },
  { label: 'Discorso romantico 💌', category: 'soft', enabled: true }, { label: 'Ballo di gruppo 🕺', category: 'party', enabled: true },
  { label: 'Discorso ubriaco 😂', category: 'party', enabled: true }, { label: 'Servi da bere 🍾', category: 'party', enabled: true },
  { label: 'Fai cantare il tavolo 🎤', category: 'party', enabled: true }, { label: 'Corri dagli sposi 🏃', category: 'wild', enabled: true },
  { label: 'Shot misterioso 🎯', category: 'wild', enabled: true },
]
export const DEFAULT_SHOE_QUESTIONS: string[] = [
  'Chi ha fatto il primo passo?', 'Chi è più geloso?', 'Chi ha sempre ragione?', 'Chi è più romantico?', 'Chi cucina meglio?',
  'Chi spende più soldi?', 'Chi è più disordinato?', 'Chi guida meglio?', 'Chi è più puntuale?', 'Chi dorme di più?',
  'Chi è più social?', 'Chi ha più pazienza?', 'Chi decide cosa guardare in TV?', 'Chi ha scelto questa musica?', 'Chi ama di più l’altro? ❤️',
]

const bad = (field: string, msg = 'invalid') => new HttpsError('invalid-argument', `${field} ${msg}`, { reason: 'invalid_payload', field })

export function parseGameActionInput(data: unknown): GameActionInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const game = d.game as GameKey, action = d.action as GameAction
  if (game !== 'roulette' && game !== 'shoe') throw bad('game')
  if (!ACTIONS[game].includes(action)) throw bad('action')
  const out: GameActionInput = { eventId: idField(d.eventId, 'eventId'), game, action }
  if (d.categories !== undefined) {
    if (!Array.isArray(d.categories)) throw bad('categories')
    out.categories = d.categories.filter((c): c is string => typeof c === 'string' && (CATEGORIES as readonly string[]).includes(c))
  }
  if (d.questions !== undefined) out.questions = cleanQuestions(d.questions, 'questions')
  return out
}

function cleanQuestions(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw) || raw.length > GAME_LIMITS.maxItems) throw bad(field)
  return raw.map((q) => String(q).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, GAME_LIMITS.question)).filter(Boolean)
}
function cleanPenitenze(raw: unknown): Penitenza[] {
  if (!Array.isArray(raw) || raw.length > GAME_LIMITS.maxItems) throw bad('roulettePenitenze')
  return raw.map((p) => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    const label = typeof o.label === 'string' ? o.label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, GAME_LIMITS.label) : ''
    if (!label || !(CATEGORIES as readonly string[]).includes(o.category as string)) throw bad('roulettePenitenze')
    return { label, category: o.category as Penitenza['category'], enabled: o.enabled !== false }
  })
}

/** Port of utils/smartRandom.getSmartRandomOption: avoid the last `avoidCount` picks, never repeat the very last one if possible. */
export function smartPick<T extends { id: string }>(options: T[], recentIds: string[], avoidCount = 3): T | null {
  if (!options.length) return null
  const avoid = recentIds.slice(-avoidCount)
  let available = options.filter((o) => !avoid.includes(o.id))
  if (!available.length && recentIds.length) available = options.filter((o) => o.id !== recentIds[recentIds.length - 1])
  if (!available.length) available = options
  return available[Math.floor(Math.random() * available.length)]
}
const shuffle = <T>(a: T[]): T[] => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] } return r }

const millis = (d: QueryDocumentSnapshot) => (d.data().createdAt instanceof Timestamp ? (d.data().createdAt as Timestamp).toMillis() : 0)

/** Games exist only for Party / Wedding events and need the premium gate (legacy ownedEventSession + hasEventAccess). */
async function gate(db: Firestore, request: CallerAuth, eventId: string, fn: string) {
  const owner = await requireEventOwner(db, request, eventId, { djOnly: true })
  if (owner.data.type !== 'party' && owner.data.type !== 'wedding') throw fail('failed-precondition', 'Games are for Party / Wedding events', 'games_unavailable')
  await requireOwnerEventAccess(db, eventId, owner.data, fn)
  return owner
}

export interface GameActionResult { roundId: string | null; status: 'idle' | 'running' | 'completed' | null }

export async function gameAction(db: Firestore, request: CallerAuth, input: GameActionInput): Promise<GameActionResult> {
  const { ref: eventRef } = await gate(db, request, input.eventId, `game_${input.game}_${input.action}`)
  const games = eventRef.collection('games'), type = TYPE[input.game]
  const activeOf = (tx: FirebaseFirestore.Transaction) => tx.get(games.where('type', '==', type).where('status', 'in', ['idle', 'running']).limit(50))
  const cfg = (await eventRef.collection('private').doc('gameConfig').get()).data() ?? {}
  const now = FieldValue.serverTimestamp()

  if (input.game === 'roulette' && input.action === 'start') {
    const base: Penitenza[] = Array.isArray(cfg.roulettePenitenze) && cfg.roulettePenitenze.length ? cfg.roulettePenitenze : DEFAULT_ROULETTE_PENITENZE
    const selected = input.categories && input.categories.length ? input.categories : [...CATEGORIES]
    let available = base.filter((p) => p.enabled && selected.includes(p.category))
    if (selected.includes('wild')) available = [...available, ...base.filter((p) => p.enabled && (p.category === 'soft' || p.category === 'party'))]   // legacy: WILD also pulls soft + party
    if (!available.length) throw fail('failed-precondition', 'No penalty available for the selected categories', 'no_penalties')
    const ref = games.doc()
    await db.runTransaction(async (tx) => {
      const active = await activeOf(tx)
      active.docs.forEach((r) => tx.update(r.ref, { status: 'completed', updatedAt: now }))
      tx.create(ref, { type, status: 'idle', config: { penitenze: shuffle(available), categories: selected }, result: null, createdAt: now, updatedAt: now })
    })
    return { roundId: ref.id, status: 'idle' }
  }

  if (input.game === 'roulette' && input.action === 'spin') {
    const recent = (await games.where('type', '==', type).orderBy('createdAt', 'desc').limit(5).get()).docs
    return db.runTransaction(async (tx) => {
      const active = (await activeOf(tx)).docs.sort((a, b) => millis(b) - millis(a))[0]
      if (!active) throw fail('failed-precondition', 'No active roulette. Start a new round.', 'no_active_game')
      const c = active.data().config as DocumentData | null
      const penitenze: Array<Penitenza | string> = Array.isArray(c?.penitenze) && c!.penitenze.length ? c!.penitenze : DEFAULT_ROULETTE_PENITENZE.filter((p) => p.enabled)
      // Newest-last labels of the previous spins, plus this round's own result (re-spin of the same round).
      const labels = recent.filter((r) => r.id !== active.id).slice(0, 3).map((r) => r.data().result?.slot_label).filter((l): l is string => typeof l === 'string').reverse()
      const own = active.data().result?.slot_label
      if (typeof own === 'string') labels.push(own)
      const candidates = penitenze.map((p, idx) => ({ id: typeof p === 'string' ? p : p.label, idx }))
      const idx = smartPick(candidates, labels, 3)?.idx ?? 0
      const picked = penitenze[idx]
      tx.update(active.ref, {
        status: 'completed', updatedAt: now,
        result: { slot_index: idx, slot_label: typeof picked === 'string' ? picked : picked.label, ...(typeof picked === 'object' ? { category: picked.category } : {}), picked_at: new Date().toISOString() },
      })
      return { roundId: active.id, status: 'completed' as const }
    })
  }

  if (input.action === 'reset') {
    await db.runTransaction(async (tx) => {
      const active = await activeOf(tx)
      active.docs.forEach((r) => tx.update(r.ref, { status: 'completed', result: null, updatedAt: now }))
    })
    return { roundId: null, status: null }
  }

  if (input.game === 'shoe' && input.action === 'start') {
    const questions = input.questions?.length ? input.questions
      : Array.isArray(cfg.shoeGameQuestions) && cfg.shoeGameQuestions.length ? cfg.shoeGameQuestions as string[] : DEFAULT_SHOE_QUESTIONS
    const ref = games.doc()
    await db.runTransaction(async (tx) => {
      const active = await activeOf(tx)
      active.docs.forEach((r) => tx.update(r.ref, { status: 'completed', updatedAt: now }))
      tx.create(ref, { type, status: 'running', config: { questions, current_index: 0, is_active: true }, result: null, createdAt: now, updatedAt: now })
    })
    return { roundId: ref.id, status: 'running' }
  }

  // shoe / next
  const latest = (await games.where('type', '==', type).orderBy('createdAt', 'desc').limit(1).get()).docs[0]
  if (!latest || latest.data().status === 'completed') throw fail('failed-precondition', 'No active game. Start the game.', 'no_active_game')
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(latest.ref), r = snap.data()!
    if (r.status === 'completed') throw fail('failed-precondition', 'No active game. Start the game.', 'no_active_game')
    const questions: string[] = Array.isArray(r.config?.questions) ? r.config.questions : DEFAULT_SHOE_QUESTIONS
    const next = Number(r.config?.current_index ?? 0) + 1
    if (next >= questions.length) {
      tx.update(latest.ref, { status: 'completed', config: { ...r.config, questions, current_index: questions.length - 1, is_active: false }, result: { finished_at: new Date().toISOString(), total: questions.length }, updatedAt: now })
      return { roundId: latest.id, status: 'completed' as const }
    }
    tx.update(latest.ref, { status: 'running', config: { ...r.config, questions, current_index: next, is_active: true }, updatedAt: now })
    return { roundId: latest.id, status: 'running' as const }
  })
}

// ── owner-private customisation (roulette_penitenze / shoe_game_questions) ──
export interface GameConfigInput { eventId: string; roulettePenitenze?: Penitenza[] | null; shoeGameQuestions?: string[] | null }

export function parseGameConfigInput(data: unknown): GameConfigInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const out: GameConfigInput = { eventId: idField(d.eventId, 'eventId') }
  if ('roulettePenitenze' in d) out.roulettePenitenze = d.roulettePenitenze === null ? null : cleanPenitenze(d.roulettePenitenze)
  if ('shoeGameQuestions' in d) out.shoeGameQuestions = d.shoeGameQuestions === null ? null : cleanQuestions(d.shoeGameQuestions, 'shoeGameQuestions')
  if (Object.keys(out).length === 1) throw bad('payload', 'nothing to update')
  return out
}

/** null (or an empty list) = back to the defaults: the field is removed. Same semantics as the legacy `roulette_penitenze: null` reset. */
export async function setGameConfig(db: Firestore, request: CallerAuth, input: GameConfigInput): Promise<{ updated: string[] }> {
  const { ref } = await requireEventOwner(db, request, input.eventId, { djOnly: true })
  const patch: Record<string, unknown> = {}
  const put = (key: string, v: unknown[] | null | undefined) => { if (v !== undefined) patch[key] = v && v.length ? v : FieldValue.delete() }
  put('roulettePenitenze', input.roulettePenitenze); put('shoeGameQuestions', input.shoeGameQuestions)
  await ref.collection('private').doc('gameConfig').set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { updated: Object.keys(patch) }
}
