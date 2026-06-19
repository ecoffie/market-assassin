/**
 * /api/cron/check-provider-health — refresh api_provider_status.
 *
 * Eric (daily-ops): the provider-status table was frozen at April 19-22 because
 * NOTHING refreshed it — the only updater was a manual admin action. This cron
 * pings each provider we actually use and upserts the row, so the Tool Health
 * dashboard reflects reality instead of stale "openai down".
 *
 * Checks: groq, openai, anthropic (the LLM fallback chain), sam_gov,
 * usaspending, grants_gov. Each is a lightweight liveness ping.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRotatedSAMKey } from '@/lib/sam/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface Check { provider: string; status: 'healthy' | 'degraded' | 'down' | 'skipped'; latency?: number; error?: string }

// Each checker returns a status. Missing key → 'skipped' (not an error — we just
// don't use it), so the dashboard doesn't show a false "down".
async function ping(name: string, key: string | undefined, run: () => Promise<Response>): Promise<Check> {
  if (!key) return { provider: name, status: 'skipped' };
  try {
    const start = Date.now();
    const res = await run();
    const latency = Date.now() - start;
    if (res.ok) return { provider: name, status: 'healthy', latency };
    if (res.status === 429) return { provider: name, status: 'degraded', latency, error: 'HTTP 429 (rate limited)' };
    // 400 = the endpoint is REACHABLE + the key worked; the request payload was
    // rejected (a probe quirk, not an outage). Real problems are auth (401/403) or
    // server errors (5xx). Treat 400 as healthy so a payload drift can't false-flag.
    if (res.status === 400) return { provider: name, status: 'healthy', latency, error: 'HTTP 400 (reachable; probe payload rejected)' };
    return { provider: name, status: 'down', latency, error: `HTTP ${res.status}` };
  } catch (e) {
    return { provider: name, status: 'down', error: e instanceof Error ? e.message.slice(0, 120) : 'fetch failed' };
  }
}

export async function GET(request: NextRequest) {
  // Cron auth: Vercel cron sends the CRON_SECRET; also allow the admin password.
  const auth = request.headers.get('authorization') || '';
  const pw = request.nextUrl.searchParams.get('password');
  const ok = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
    || pw === (process.env.ADMIN_PASSWORD);
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const samKey = getRotatedSAMKey();
  const checks = await Promise.all([
    ping('groq', process.env.GROQ_API_KEY, () =>
      fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } })),
    ping('openai', process.env.OPENAI_API_KEY, () =>
      fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } })),
    ping('anthropic', process.env.ANTHROPIC_API_KEY, () =>
      // Liveness via GET /v1/models — same pattern as groq/openai. A POST to
      // /v1/messages false-flagged "down" (HTTP 400) whenever the probe's model
      // name drifted from a current model ID; /v1/models has no model name or body
      // to get wrong, so it returns 200 when reachable+keyed and only 401/403 when
      // the key is bad (a real problem).
      fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      })),
    ping('sam_gov', samKey, () =>
      fetch(`https://api.sam.gov/opportunities/v2/search?api_key=${samKey}&limit=1&postedFrom=01/01/2026&postedTo=01/02/2026`)),
    ping('usaspending', 'public', () =>
      fetch('https://api.usaspending.gov/api/v2/references/toptier_agencies/')),
    ping('grants_gov', 'public', () =>
      fetch('https://api.grants.gov/v1/api/search2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: 1, keyword: 'test' }),
      })),
  ]);

  // Upsert each provider's status.
  const supabase = sb();
  const now = new Date().toISOString();
  for (const c of checks) {
    if (c.status === 'skipped') continue; // don't write a row for unused providers
    await supabase.from('api_provider_status').upsert({
      provider: c.provider,
      status: c.status,
      last_check_at: now,
      ...(c.status === 'healthy' ? { last_success_at: now, last_error_message: null } : { last_error_at: now, last_error_message: c.error || null }),
      ...(c.latency != null ? { avg_latency_ms: c.latency } : {}),
      updated_at: now,
    }, { onConflict: 'provider' });
  }

  return NextResponse.json({
    success: true,
    checked: checks.length,
    results: checks,
    healthy: checks.filter(c => c.status === 'healthy').length,
  });
}
