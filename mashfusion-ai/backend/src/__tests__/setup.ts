/**
 * Jest global setup — stub out external services so tests run in-process
 * without needing Redis, Postgres, SMTP or the AI engine.
 */

// Prevent accidental real DB/Redis/SMTP connections in unit tests
process.env.DATABASE_URL       = 'postgresql://test:test@localhost:5432/test_noop'
process.env.REDIS_URL          = 'redis://localhost:6379/15'
process.env.JWT_SECRET         = 'test_jwt_secret_not_for_production'
process.env.INTERNAL_API_KEY   = 'test_internal_key'
process.env.NODE_ENV           = 'test'
// No SMTP_HOST → mailer falls into dev-mode (logs, doesn't send)
delete process.env.SMTP_HOST
// No OPENAI_API_KEY → remixDirector skips LLM
delete process.env.OPENAI_API_KEY
