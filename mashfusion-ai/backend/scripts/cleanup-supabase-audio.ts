/**
 * Supabase Storage cleanup (DEV ONLY).
 *
 * Deletes heavy audio test files from a fixed allowlist of buckets.
 * Never touches DB rows, auth users, or non-listed buckets (e.g. avatars).
 *
 * Usage:
 *   npm run cleanup:storage -- --dry-run
 *   npm run cleanup:storage -- --confirm
 */

import path from 'path';
import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TARGET_BUCKETS = [
  'track-uploads',
  'generated-outputs',
  'stems',
  'soundbank_samples',
  'user_samples',
] as const;

const PROTECTED_BUCKETS = new Set(['avatars']);

const PAGE_SIZE = 1000;

type Mode = 'dry-run' | 'confirm';

function parseMode(argv: string[]): Mode | null {
  const hasDry = argv.includes('--dry-run');
  const hasConfirm = argv.includes('--confirm');
  if (hasConfirm && hasDry) return null;
  if (hasConfirm) return 'confirm';
  if (hasDry) return 'dry-run';
  return null;
}

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${units[i]}`;
}

interface FileEntry {
  path: string;
  size: number;
}

async function listAllFiles(
  supabase: SupabaseClient,
  bucket: string,
  prefix = '',
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      const isFolder = item.id === null || item.id === undefined;
      if (isFolder) {
        const nested = await listAllFiles(supabase, bucket, fullPath);
        out.push(...nested);
      } else {
        const size =
          (item.metadata && typeof item.metadata.size === 'number'
            ? item.metadata.size
            : 0) || 0;
        out.push({ path: fullPath, size });
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return out;
}

async function bucketExists(
  supabase: SupabaseClient,
  bucket: string,
): Promise<boolean> {
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (error) return false;
  return !!data;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (!mode) {
    console.error(
      'Usage: npm run cleanup:storage -- --dry-run | --confirm\n' +
        '  --dry-run   list files that would be deleted (no changes)\n' +
        '  --confirm   actually delete files\n' +
        'Refusing to run without one of these flags.',
    );
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env',
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`Target buckets: ${TARGET_BUCKETS.join(', ')}`);
  console.log(`Protected (never touched): ${[...PROTECTED_BUCKETS].join(', ')}`);
  console.log('');

  let grandFiles = 0;
  let grandBytes = 0;
  let grandDeleted = 0;
  const errors: string[] = [];

  for (const bucket of TARGET_BUCKETS) {
    if (PROTECTED_BUCKETS.has(bucket)) {
      console.log(`[skip] ${bucket} — protected`);
      continue;
    }

    const exists = await bucketExists(supabase, bucket);
    if (!exists) {
      console.log(`[skip] ${bucket} — bucket not found`);
      continue;
    }

    let files: FileEntry[];
    try {
      files = await listAllFiles(supabase, bucket);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[error] ${bucket} — list failed: ${msg}`);
      errors.push(`${bucket}: list failed: ${msg}`);
      continue;
    }

    const totalBytes = files.reduce((a, f) => a + f.size, 0);
    grandFiles += files.length;
    grandBytes += totalBytes;

    console.log(
      `[bucket] ${bucket} — ${files.length} file(s), ~${fmtBytes(totalBytes)}`,
    );

    if (files.length === 0) continue;

    for (const f of files) {
      console.log(`   - ${f.path} (${fmtBytes(f.size)})`);
    }

    if (mode === 'confirm') {
      const BATCH = 100;
      for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH).map((f) => f.path);
        const { data, error } = await supabase.storage
          .from(bucket)
          .remove(batch);
        if (error) {
          console.log(`   [error] batch delete failed: ${error.message}`);
          errors.push(`${bucket}: delete batch failed: ${error.message}`);
          continue;
        }
        const removed = data?.length ?? 0;
        grandDeleted += removed;
        console.log(`   [deleted] ${removed} file(s)`);
      }
    }
  }

  console.log('');
  console.log('--- Summary ---');
  console.log(`Buckets scanned: ${TARGET_BUCKETS.length}`);
  console.log(`Files found:     ${grandFiles}`);
  console.log(`Total size:      ~${fmtBytes(grandBytes)}`);
  if (mode === 'confirm') {
    console.log(`Files deleted:   ${grandDeleted}`);
  } else {
    console.log('Dry run — no files were deleted.');
  }
  if (errors.length) {
    console.log(`Errors: ${errors.length}`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
