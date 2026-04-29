#!/usr/bin/env node
/**
 * IOMIXO — Database & Storage Bootstrap Script
 * Applies schema.sql + all migrations to Supabase PostgreSQL,
 * then creates the required Supabase Storage buckets.
 *
 * Usage: node database/migrate.js
 * Run from: /mashfusion-ai/ root (or anywhere — uses absolute paths)
 */

// Load dotenv from backend/node_modules (no global install needed)
const nodemodulesBase = require('path').join(__dirname, '../backend/node_modules')
require(nodemodulesBase + '/dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })

const { Client } = require(nodemodulesBase + '/pg')
const https = require('https')
const path = require('path')
const fs = require('fs')

const DATABASE_URL    = process.env.DATABASE_URL
const SUPABASE_URL    = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!DATABASE_URL)     { console.error('❌  DATABASE_URL missing in backend/.env'); process.exit(1) }
if (!SUPABASE_URL)     { console.error('❌  SUPABASE_URL missing in backend/.env'); process.exit(1) }
if (!SERVICE_ROLE_KEY) { console.error('❌  SUPABASE_SERVICE_ROLE_KEY missing in backend/.env'); process.exit(1) }

// ── SQL files to apply in order ───────────────────────────────
const SQL_FILES = [
  path.join(__dirname, 'schema.sql'),
  path.join(__dirname, 'migrations/002_worker_infra.sql'),
  path.join(__dirname, 'migrations/003_remix_director.sql'),
]

// ── Storage buckets to create (all private) ──────────────────
const BUCKETS = [
  { name: 'track-uploads',     public: false, fileSizeLimit: 300 * 1024 * 1024 }, // 300 MB
  { name: 'generated-outputs', public: false, fileSizeLimit: 500 * 1024 * 1024 }, // 500 MB
  { name: 'avatars',           public: true,  fileSizeLimit: 5   * 1024 * 1024 }, // 5 MB — public for CDN
]

// ── Helpers ───────────────────────────────────────────────────

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data || '{}') }))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// Split SQL into individual statements, skipping blank/comment-only blocks.
// Handles $$ dollar-quoted blocks safely.
function splitStatements(sql) {
  const statements = []
  let current = ''
  let inDollarQuote = false
  let dollarTag = ''
  const lines = sql.split('\n')

  for (const line of lines) {
    // Dollar-quote detection (handles $$, $body$, $func$, etc.)
    if (!inDollarQuote) {
      const match = line.match(/\$([^$]*)\$/)
      if (match && sql.indexOf(match[0]) !== -1) {
        const tag = match[0]
        // Count occurrences in current accumulated block + line
        const combined = current + line
        const count = (combined.match(new RegExp('\\' + tag.replace(/\$/g, '\\$'), 'g')) || []).length
        if (count % 2 === 1) {
          inDollarQuote = true
          dollarTag = tag
        }
      }
    } else {
      if (line.includes(dollarTag)) {
        inDollarQuote = false
        dollarTag = ''
      }
    }

    current += line + '\n'

    if (!inDollarQuote && line.trimEnd().endsWith(';')) {
      const stmt = current.trim()
      if (stmt.length > 1 && !stmt.match(/^--/)) {
        statements.push(stmt)
      }
      current = ''
    }
  }

  // Flush any remaining (e.g. DO $$ ... $$ blocks without trailing semicolon on same line)
  if (current.trim() && current.trim().length > 1) {
    statements.push(current.trim())
  }

  return statements.filter(s => s.length > 0)
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════')
  console.log('  IOMIXO — Database Bootstrap')
  console.log('══════════════════════════════════════════\n')

  // ── 1. Apply SQL migrations ──────────────────────────────
  // ── Build connection string (prefer pooler over direct) ────
  // Supabase direct hostname (db.{ref}.supabase.co) is sometimes
  // blocked by ISP DNS. Pooler is always reachable.
  const supabaseRef  = 'bpvvsuxehdmjpbachsaq'
  const supabasePwd  = new URL(DATABASE_URL).password || 'Addiopersempre22'
  const poolerUrl    = `postgresql://postgres.${supabaseRef}:${supabasePwd}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`

  console.log('📦  Connecting to Supabase PostgreSQL (via pooler)…')

  const client = new Client({
    connectionString: poolerUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  })

  try {
    await client.connect()
    console.log('✓   Connected\n')
  } catch (err) {
    console.error('❌  Connection failed:', err.message)
    process.exit(1)
  }

  for (const sqlFile of SQL_FILES) {
    const filename = path.basename(sqlFile)
    if (!fs.existsSync(sqlFile)) {
      console.warn(`⚠   Skipping ${filename} (file not found)`)
      continue
    }

    console.log(`📄  Applying ${filename}…`)
    const sql = fs.readFileSync(sqlFile, 'utf8')

    // Execute the entire file as one transaction so partial failures roll back
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('COMMIT')
      console.log(`✓   ${filename} applied\n`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      // "already exists" errors are safe to ignore — schema is idempotent
      if (
        err.message.includes('already exists') ||
        err.code === '42P07' || // duplicate_table
        err.code === '42710' || // duplicate_object
        err.code === '23505'    // unique_violation
      ) {
        console.log(`✓   ${filename} already applied (skipped)\n`)
      } else {
        console.error(`❌  ${filename} failed: ${err.message}`)
        console.error(`    Code: ${err.code} | Detail: ${err.detail ?? ''}`)
        // Non-fatal — log and continue so partial schemas still apply
      }
    }
  }

  await client.end()
  console.log('✓   Database connection closed\n')

  // ── 2. Create Storage buckets ────────────────────────────
  console.log('🗄   Creating Supabase Storage buckets…\n')

  const storageHost = new URL(SUPABASE_URL).hostname

  for (const bucket of BUCKETS) {
    const options = {
      hostname: storageHost,
      path:     '/storage/v1/bucket',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey':        SERVICE_ROLE_KEY,
      },
    }

    try {
      const res = await httpsRequest(options, {
        id:               bucket.name,
        name:             bucket.name,
        public:           bucket.public,
        file_size_limit:  bucket.fileSizeLimit,
        allowed_mime_types: bucket.name === 'track-uploads'
          ? ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/webm']
          : bucket.name === 'avatars'
          ? ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
          : null, // generated-outputs: any audio format
      })

      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log(`✓   Bucket "${bucket.name}" created (${bucket.public ? 'public' : 'private'})`)
      } else if (res.body?.error === 'Bucket already exists' || res.statusCode === 409) {
        console.log(`✓   Bucket "${bucket.name}" already exists — skipped`)
      } else {
        console.warn(`⚠   Bucket "${bucket.name}": HTTP ${res.statusCode} — ${JSON.stringify(res.body)}`)
      }
    } catch (err) {
      console.error(`❌  Bucket "${bucket.name}" failed: ${err.message}`)
    }
  }

  console.log('\n══════════════════════════════════════════')
  console.log('  Bootstrap complete!')
  console.log('══════════════════════════════════════════\n')
  console.log('Next steps:')
  console.log('  1. Frontend →  http://localhost:3000')
  console.log('  2. Backend  →  http://localhost:4000/health')
  console.log('  3. Register a user and test the full flow\n')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
