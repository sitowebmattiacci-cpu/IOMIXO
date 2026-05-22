import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function maskUrl(u: string | undefined): string {
  if (!u) return '(missing)';
  return u;
}

function maskKey(k: string | undefined): string {
  if (!k) return '(missing)';
  if (k.length < 12) return '***';
  return `${k.slice(0, 6)}…${k.slice(-4)} (len=${k.length})`;
}

async function main() {
  console.log('SUPABASE_URL:              ', maskUrl(url));
  console.log('SUPABASE_SERVICE_ROLE_KEY: ', maskKey(key));
  console.log('');

  if (!url || !key) {
    console.error('Missing env. Aborting.');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('listBuckets error:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No buckets found in this project.');
    return;
  }

  console.log(`Found ${data.length} bucket(s):`);
  for (const b of data) {
    console.log(
      `  - ${b.name}  (id=${b.id}, public=${b.public}, created=${b.created_at})`,
    );
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
