import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'

import { tracksRouter }   from './routes/tracks'
import { jobsRouter }     from './routes/jobs'
import { userRouter }     from './routes/user'
import { stripeRouter }   from './routes/stripe'
import { internalRouter } from './routes/internal'
import { projectsRouter } from './routes/projects'

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
app.use('/tracks',   tracksRouter)
app.use('/jobs',     jobsRouter)
app.use('/user',     userRouter)
app.use('/stripe',   stripeRouter)
app.use('/internal', internalRouter)     // AI engine webhooks (internal only)
app.use('/projects', projectsRouter)

// ── Error handling ─────────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)
