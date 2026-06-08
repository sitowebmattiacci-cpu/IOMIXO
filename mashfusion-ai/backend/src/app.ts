import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'

// ── LEGACY MashFusion AI routers (DISABLED 2026-06-08 — to be removed) ──
// import { tracksRouter }   from './routes/tracks'
// import { jobsRouter }     from './routes/jobs'
// import { internalRouter } from './routes/internal'
// import { projectsRouter } from './routes/projects'
// import { soundbankRouter, samplesRouter } from './routes/soundbank'
// import { adminRouter } from './routes/admin'
// import { aiRouter } from './routes/ai'

import { userRouter }     from './routes/user'
import { stripeRouter }   from './routes/stripe'
import { liveSessionsRouter } from './routes/liveSessions'
import { livePublicRouter }   from './routes/livePublic'
import { liveDedicationsRouter } from './routes/liveDedications'
import { liveGamesRouter }       from './routes/liveGames'
import { livePollsRouter }       from './routes/livePolls'
import { livePhotosRouter }      from './routes/livePhotos'
import { liveScreenRouter }      from './routes/liveScreen'
import { weddingGamesRouter }    from './routes/weddingGames'
import { djProfileRouter }    from './routes/djProfile'
import { djEventsRouter }     from './routes/djEvents'

import { errorHandler, notFound } from './middleware/errorHandler'
import { apiRateLimit }           from './middleware/rateLimit'
import { requestId }              from './middleware/requestId'

export const app = express()

// ── Security headers ───────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

// ── CORS ───────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',')
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}))

// ── Body parsing — Stripe webhook needs raw body ───────────────
app.use('/stripe/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))

// ── Misc middleware ────────────────────────────────────────────
app.use(compression())
app.use(morgan('combined'))
app.use(requestId)

// ── Health ─────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

// ── Rate limiting ──────────────────────────────────────────────
app.use('/api', apiRateLimit({ windowMs: 60_000, max: 120 }))

// ── Routes ─────────────────────────────────────────────────────
// Auth is handled entirely by Supabase on the frontend.
// Express only exposes business-logic routes.
app.use('/user',     userRouter)
app.use('/stripe',   stripeRouter)

// ── LEGACY MashFusion AI mounts (DISABLED 2026-06-08) ──────────
// TODO: remove with the corresponding route files in cleanup/remove-legacy-ai.
// app.use('/tracks',   tracksRouter)
// app.use('/jobs',     jobsRouter)
// app.use('/internal', internalRouter)     // AI engine webhooks (internal only)
// app.use('/projects', projectsRouter)
// app.use('/soundbank', soundbankRouter)
// app.use('/samples',   samplesRouter)
// app.use('/admin',     adminRouter)
// app.use('/api/ai',    aiRouter)
// app.use('/ai',        aiRouter)  // backward-compatible alias

// ── IOMIXO Live Hub ────────────────────────────────────────────
app.use('/api/live',        liveSessionsRouter)   // /sessions/*, /requests/*
app.use('/api/live/public', livePublicRouter)
// Wedding Edition routers — each owns a distinct path prefix to avoid Express
// route-precedence collisions with the legacy live routers above.
app.use('/api/live',        liveDedicationsRouter) // /public/:slug/dedications, /sessions/:id/dedications, /dedications/:id
app.use('/api/live',        liveGamesRouter)       // /sessions/:id/games/*, /public/:slug/games
app.use('/api/live',        livePollsRouter)       // /sessions/:id/polls, /polls/:id, /public/:slug/polls/*
app.use('/api/live',        livePhotosRouter)      // /sessions/:id/photos, /photos/:id, /public/:slug/photos*
app.use('/api/live',        liveScreenRouter)      // /public/:slug/screen
app.use('/api/live',        weddingGamesRouter)    // Future Messages + Best Photo Contest
app.use('/api/dj/profile',  djProfileRouter)
app.use('/api/dj/events',   djEventsRouter)

// ── Error handling ─────────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)
