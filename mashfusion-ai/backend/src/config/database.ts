import { Pool } from 'pg'
import { logger } from './logger'

// In production, require valid TLS certs (OWASP A02: Cryptographic Failures).
// Set DATABASE_SSL_REJECT_UNAUTHORIZED=false only when using self-signed certs.
const sslConfig = process.env.NODE_ENV === 'production'
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : false

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:             20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: sslConfig,
})

db.on('error', (err) => logger.error('Unexpected pg pool error', { err }))
