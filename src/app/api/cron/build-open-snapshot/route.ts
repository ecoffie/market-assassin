/**
 * BUILD OPEN SNAPSHOT (Agent 3, 2026-11-15; Agent 5 cache review #3). Development only — NOT registered in cron_jobs and
 * the bucket does not exist yet: both are infrastructure steps for Eric. OPEN_SNAPSHOT_RETRIEVAL stays off.
 *
 * Builds ONE complete snapshot of open sam_opportunities text (complete-or-refuse; read-only on the table) and writes it,
 * gzipped and checksummed, to the PRIVATE `open-snapshots` bucket. Intended to run right after each SAM sync so FIND
 * instances download instead of building. Auth: the dispatcher's CRON_SECRET bearer only (x-vercel-cron is not trusted).
 * Responds 503 with the reason when the build or the write is refused (bucket missing / public, incomplete read).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hasValidCronSecret } from '@/lib/cron/cron-request-auth';
import { buildOpenSnapshot } from '@/lib/opportunities/open-cache';
import { writeOpenSnapshot, supabaseSnapshotStore } from '@/lib/opportunities/open-snapshot-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) return new NextResponse(null, { status: 401 });
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const t0 = Date.now();
  try {
    const snap = await buildOpenSnapshot(client);
    const buildMs = Date.now() - t0;
    const w = await writeOpenSnapshot(supabaseSnapshotStore(client), snap);
    return NextResponse.json({ ok: true, rows: snap.count, built_at: snap.builtAt, build_ms: buildMs, gzip_bytes: w.gzipBytes, sha256: w.sha256 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, elapsed_ms: Date.now() - t0 }, { status: 503 });
  }
}
