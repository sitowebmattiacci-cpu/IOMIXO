import { Router, Request } from 'express'
import { supabaseAdmin } from '../config/supabase'
import { requireAuth } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { getUserPlan, hasEventAccess } from '../services/plan'
import { PLAN_LIMITS } from '../config/plans'
import { isEventSession } from '../utils/sessionType'

export const liveGamesRouter = Router()

const userId = (req: Request) => (req as any).user.sub as string

// Penitenze for the Wedding Roulette (expanded list with categories).
const DEFAULT_ROULETTE_PENITENZE = [
  // SOFT
  { label: 'Brindisi agli sposi 🥂', category: 'soft', enabled: true },
  { label: 'Foto di gruppo 📸', category: 'soft', enabled: true },
  { label: 'Discorso romantico 💌', category: 'soft', enabled: true },
  // PARTY
  { label: 'Ballo di gruppo 🕺', category: 'party', enabled: true },
  { label: 'Discorso ubriaco 😂', category: 'party', enabled: true },
  { label: 'Servi da bere 🍾', category: 'party', enabled: true },
  { label: 'Fai cantare il tavolo 🎤', category: 'party', enabled: true },
  // WILD (solo penitenze esclusive, le altre vengono aggiunte dinamicamente)
  { label: 'Corri dagli sposi 🏃', category: 'wild', enabled: true },
  { label: 'Shot misterioso 🎯', category: 'wild', enabled: true },
]

// Default questions for the "Gioco della Scarpa".
const DEFAULT_SHOE_QUESTIONS: string[] = [
  'Chi ha fatto il primo passo?',
  'Chi è più geloso?',
  'Chi ha sempre ragione?',
  'Chi è più romantico?',
  'Chi cucina meglio?',
  'Chi spende più soldi?',
  'Chi è più disordinato?',
  'Chi guida meglio?',
  'Chi è più puntuale?',
  'Chi dorme di più?',
  'Chi è più social?',
  'Chi ha più pazienza?',
  'Chi decide cosa guardare in TV?',
  'Chi ha scelto questa musica?',
  'Chi ama di più l\u2019altro? ❤️',
]

async function ownedEventSession(sessionId: string, djId: string) {
  const { data } = await supabaseAdmin
    .from('live_sessions')
    .select('id, dj_id, session_type, is_active')
    .eq('id', sessionId).eq('dj_id', djId).maybeSingle()
  if (!data) throw new AppError('Sessione non trovata', 404)
  if (!isEventSession(data.session_type)) {
    throw new AppError('Funzione disponibile solo per sessioni Party Mode o Wedding Edition.', 400)
  }
  return data
}
// Backward-compat alias: callers in this file used to call ownedWeddingSession.
const ownedWeddingSession = ownedEventSession

async function requireEventAccess(djId: string, sessionId?: string) {
  const hasAccess = await hasEventAccess(djId, sessionId)
  if (!hasAccess) {
    throw new AppError('Le funzioni evento sono sospese. Riattiva il piano Advance o acquista un Event Pass 24H per continuare.', 402)
  }
}
const requireWeddingFeature = requireEventAccess

// ── DJ: start a roulette round ─────────────────────────────────
liveGamesRouter.post('/sessions/:id/games/roulette/start', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    await requireWeddingFeature(userId(req))

    // Fetch session to get custom penalties
    const { data: session } = await supabaseAdmin
      .from('live_sessions')
      .select('roulette_penitenze')
      .eq('id', req.params.id)
      .single()

    // Use custom penalties if available, otherwise use defaults
    const basePenitenze = session?.roulette_penitenze ?? DEFAULT_ROULETTE_PENITENZE

    // Accept categories array (soft / party / wild) or default to all
    const selectedCategories: string[] = Array.isArray(req.body?.categories) && req.body.categories.length > 0
      ? req.body.categories.filter((c: any) => ['soft', 'party', 'wild'].includes(c))
      : ['soft', 'party', 'wild']

    // Filter penitenze by selected categories
    let availablePenitenze = basePenitenze.filter(
      (p: any) => p.enabled && selectedCategories.includes(p.category)
    )

    // Se WILD è selezionato, aggiungi anche tutte le penitenze soft e party
    if (selectedCategories.includes('wild')) {
      const softAndParty = basePenitenze.filter(
        (p: any) => p.enabled && (p.category === 'soft' || p.category === 'party')
      )
      availablePenitenze = [...availablePenitenze, ...softAndParty]
    }

    if (availablePenitenze.length === 0) {
      throw new AppError('Nessuna penitenza disponibile con le categorie selezionate.', 400)
    }

    // Shuffle per randomizzare l'ordine (Fisher-Yates shuffle)
    const shuffled = [...availablePenitenze]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    // Close any previous active rounds (idle/running) for this game type
    await supabaseAdmin.from('live_game_rounds')
      .update({ status: 'completed' })
      .eq('session_id', req.params.id).eq('game_type', 'wedding_roulette')
      .in('status', ['idle', 'running'])

    const { data, error } = await supabaseAdmin.from('live_game_rounds').insert({
      session_id: req.params.id,
      game_type:  'wedding_roulette',
      status:     'idle',
      config:     { penitenze: shuffled, categories: selectedCategories },
      result:     null,
    }).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── DJ: spin (pick a random slot, mark completed) ──────────────
liveGamesRouter.post('/sessions/:id/games/roulette/spin', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    await requireWeddingFeature(userId(req))

    const { data: round } = await supabaseAdmin
      .from('live_game_rounds').select('*')
      .eq('session_id', req.params.id).eq('game_type', 'wedding_roulette')
      .in('status', ['idle', 'running'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!round) throw new AppError('Nessuna roulette attiva. Avvia un nuovo round.', 400)

    const penitenze: any[] = Array.isArray(round.config?.penitenze) && round.config.penitenze.length > 0
      ? round.config.penitenze
      : DEFAULT_ROULETTE_PENITENZE.filter((p) => p.enabled)

    const pickedIndex = Math.floor(Math.random() * penitenze.length)
    const picked = penitenze[pickedIndex]
    const result = {
      slot_index: pickedIndex,
      slot_label: typeof picked === 'string' ? picked : picked.label,
      category: typeof picked === 'object' ? picked.category : undefined,
      picked_at: new Date().toISOString(),
    }

    const { data, error } = await supabaseAdmin.from('live_game_rounds')
      .update({ status: 'completed', result })
      .eq('id', round.id).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: reset (mark all rounds completed; UI will hide result) ─
liveGamesRouter.post('/sessions/:id/games/roulette/reset', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    await requireWeddingFeature(userId(req))

    const { error } = await supabaseAdmin.from('live_game_rounds')
      .update({ status: 'completed', result: null })
      .eq('session_id', req.params.id).eq('game_type', 'wedding_roulette')
      .in('status', ['idle', 'running'])
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})

// ── PUBLIC: latest game round ──────────────────────────────────
liveGamesRouter.get('/public/:slug/games', async (req, res, next) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('live_sessions').select('id, session_type')
      .eq('public_slug', req.params.slug).maybeSingle()
    if (!session) throw new AppError('Sessione non trovata', 404)
    if (!isEventSession(session.session_type)) return res.json({ data: { roulette: null, shoeGame: null } })

    const { data: latest } = await supabaseAdmin
      .from('live_game_rounds').select('id, game_type, status, result, config, created_at, updated_at')
      .eq('session_id', session.id).eq('game_type', 'wedding_roulette')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    const { data: shoe } = await supabaseAdmin
      .from('live_game_rounds').select('id, game_type, status, result, config, created_at, updated_at')
      .eq('session_id', session.id).eq('game_type', 'shoe_game')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    res.json({ data: { roulette: latest ?? null, shoeGame: shoe ?? null } })
  } catch (e) { next(e) }
})

// ════════════════════════════════════════════════════════════════
// GIOCO DELLA SCARPA
// ════════════════════════════════════════════════════════════════

async function latestShoeRound(sessionId: string) {
  const { data } = await supabaseAdmin
    .from('live_game_rounds').select('*')
    .eq('session_id', sessionId).eq('game_type', 'shoe_game')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

// ── DJ: get current shoe-game state ────────────────────────────
liveGamesRouter.get('/sessions/:id/games/shoe/state', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    const round = await latestShoeRound(req.params.id)
    res.json({ data: round ?? null })
  } catch (e) { next(e) }
})

// ── DJ: start the shoe game ────────────────────────────────────
liveGamesRouter.post('/sessions/:id/games/shoe/start', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    await requireWeddingFeature(userId(req))

    // Fetch session to get custom questions
    const { data: session } = await supabaseAdmin
      .from('live_sessions')
      .select('shoe_game_questions')
      .eq('id', req.params.id)
      .single()

    // Use custom questions from session or request body, otherwise use defaults
    const customQuestions = session?.shoe_game_questions ?? null
    const questions = Array.isArray(req.body?.questions) && req.body.questions.length > 0
      ? req.body.questions.map((q: unknown) => String(q).slice(0, 200))
      : (customQuestions ?? DEFAULT_SHOE_QUESTIONS)

    await supabaseAdmin.from('live_game_rounds')
      .update({ status: 'completed' })
      .eq('session_id', req.params.id).eq('game_type', 'shoe_game')
      .in('status', ['idle', 'running'])

    const { data, error } = await supabaseAdmin.from('live_game_rounds').insert({
      session_id: req.params.id,
      game_type:  'shoe_game',
      status:     'running',
      config:     { questions, current_index: 0, is_active: true },
      result:     null,
    }).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.status(201).json({ data })
  } catch (e) { next(e) }
})

// ── DJ: advance to next question ───────────────────────────────
liveGamesRouter.post('/sessions/:id/games/shoe/next', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    await requireWeddingFeature(userId(req))

    const round = await latestShoeRound(req.params.id)
    if (!round || round.status === 'completed') {
      throw new AppError('Nessun gioco attivo. Avvia il gioco.', 400)
    }
    const questions: string[] = Array.isArray(round.config?.questions) ? round.config.questions : DEFAULT_SHOE_QUESTIONS
    const currentIndex: number = Number(round.config?.current_index ?? 0)
    const nextIndex = currentIndex + 1
    const finished = nextIndex >= questions.length

    const patch = finished
      ? {
          status: 'completed' as const,
          config: { ...round.config, questions, current_index: questions.length - 1, is_active: false },
          result: { finished_at: new Date().toISOString(), total: questions.length },
        }
      : {
          status: 'running' as const,
          config: { ...round.config, questions, current_index: nextIndex, is_active: true },
        }

    const { data, error } = await supabaseAdmin.from('live_game_rounds')
      .update(patch).eq('id', round.id).select('*').single()
    if (error) throw new AppError(error.message, 500)
    res.json({ data })
  } catch (e) { next(e) }
})

// ── DJ: reset the shoe game ────────────────────────────────────
liveGamesRouter.post('/sessions/:id/games/shoe/reset', requireAuth, async (req, res, next) => {
  try {
    await ownedWeddingSession(req.params.id, userId(req))
    await requireWeddingFeature(userId(req))

    const { error } = await supabaseAdmin.from('live_game_rounds')
      .update({ status: 'completed', result: null })
      .eq('session_id', req.params.id).eq('game_type', 'shoe_game')
      .in('status', ['idle', 'running'])
    if (error) throw new AppError(error.message, 500)
    res.status(204).end()
  } catch (e) { next(e) }
})
