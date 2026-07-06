import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { backupVaultFiles } from '@/lib/vault/vault-file-backup';

/**
 * Daily vault-file backup cron. Copies new/changed customer files from
 * `vault-assets` → `vault-assets-backup` (a separate private bucket), closing
 * the one real backup gap: Supabase's database backups + PITR both EXCLUDE
 * Storage objects, so the actual uploaded resumes / cap statements / pricing
 * docs had no backup.
 *
 * Dispatcher-fired (a cron_jobs row: route=/api/cron/backup-vault-files) — never
 * vercel.json (the 100-cron cap rule). Incremental + bounded, so a daily run
 * only copies what's new; the dispatcher re-fires if a run truncates.
 *
 * AUTH: matches sibling crons — Bearer CRON_SECRET (dispatcher) / x-cron-dispatch
 * / x-vercel-cron / ?password=ADMIN_PASSWORD (manual).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET;

function isAuthed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  return (
    (!!ADMIN_PASSWORD && pw === ADMIN_PASSWORD) ||
    (!!CRON_SECRET && bearer === CRON_SECRET) ||
    isVercelCron ||
    isDispatch
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const maxObjects = parseInt(request.nextUrl.searchParams.get('max') || '500', 10);
  const startedAt = new Date().toISOString();

  try {
    const result = await backupVaultFiles(supabase, { maxObjects });
    return NextResponse.json({
      success: result.errors.length === 0,
      startedAt,
      ...result,
      note: result.truncated
        ? 'Run truncated at maxObjects — dispatcher will re-fire to finish.'
        : 'All vault files scanned this run.',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, startedAt, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
