/**
 * GET /api/health — public, read-only liveness + dependency probe for external
 * uptime monitoring (Better Stack, see monitoring/betterstack-monitors.json).
 *
 * Contract:
 *   200 { ok: true,  status: 'ok' }        every dependency answered in time
 *   503 { ok: false, status: 'degraded' }  at least one dependency failed or timed out
 *
 * Read-only by design: one indexed single-row SELECT on Supabase and one KV GET
 * of a key nothing writes. It never touches BigQuery, never writes KV or the DB,
 * and never revalidates or regenerates pages, so an uptime monitor hitting it every
 * few minutes from several regions cannot change product or SEO state or run up
 * query cost. Errors are reported as a short code ('timeout' | 'error' |
 * 'unconfigured'), never the underlying message, because this route is public.
 */
import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getReadClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Per-dependency budget. The Better Stack latency monitor alerts at 3s, so the
// probe itself must finish well inside that even when a dependency hangs.
const DEPENDENCY_TIMEOUT_MS = 2000;

// A key nothing writes. GET of a missing key is a cheap, valid round trip.
const KV_PROBE_KEY = 'health:probe';

type CheckCode = 'timeout' | 'error' | 'unconfigured';
interface CheckResult {
  ok: boolean;
  ms: number;
  error?: CheckCode;
}

class ProbeTimeout extends Error {}
class UnconfiguredError extends Error {}

async function timed(probe: () => Promise<void>): Promise<CheckResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeout()), DEPENDENCY_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    const error: CheckCode =
      e instanceof ProbeTimeout ? 'timeout' : e instanceof UnconfiguredError ? 'unconfigured' : 'error';
    return { ok: false, ms: Date.now() - started, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeDatabase(): Promise<void> {
  let client;
  try {
    client = getReadClient();
  } catch {
    throw new UnconfiguredError();
  }
  // cron_jobs is small and always present; one row, one column.
  const { error } = await client.from('cron_jobs').select('job_name').limit(1);
  if (error) throw new Error('db');
}

async function probeKv(): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new UnconfiguredError();
  await kv.get(KV_PROBE_KEY);
}

export async function GET() {
  const [database, cache] = await Promise.all([timed(probeDatabase), timed(probeKv)]);
  const ok = database.ok && cache.ok;
  return NextResponse.json(
    {
      ok,
      status: ok ? 'ok' : 'degraded',
      checks: { database, cache },
      version: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
      region: process.env.VERCEL_REGION || 'local',
      time: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
