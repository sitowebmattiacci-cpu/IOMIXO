#!/usr/bin/env node
/**
 * Quick script to add screen_config column to live_sessions table
 * Run: node backend/add-screen-config-column.js
 */

require('dotenv').config({ path: __dirname + '/.env' })
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

async function addColumn() {
  console.log('Adding screen_config column to live_sessions...')

  try {
    // Use raw SQL via the REST API's query endpoint
    const { data, error } = await supabase.rpc('exec', {
      sql: 'ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS screen_config JSONB DEFAULT NULL'
    })

    if (error) {
      console.error('❌ Error:', error.message)
      console.log('\nℹ️  Please run this SQL manually in the Supabase SQL Editor:')
      console.log('\n  ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS screen_config JSONB DEFAULT NULL;\n')
      process.exit(1)
    }

    console.log('✓ Column added successfully!')
  } catch (err) {
    console.error('❌ Failed:', err.message)
    console.log('\nℹ️  Please run this SQL manually in the Supabase SQL Editor:')
    console.log('\n  ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS screen_config JSONB DEFAULT NULL;\n')
    process.exit(1)
  }
}

addColumn()
