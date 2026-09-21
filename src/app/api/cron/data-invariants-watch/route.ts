/**
 * /api/cron/data-invariants-watch — "is the data the software produced still SANE?"
 *
 * The sibling watchdogs all answer "did it RUN?":
 *   dispatcher-watchdog  → job status
 *   db-health-watch      → reachability / latency / pressure
 *   check-data-freshness → is the source stale
 *
 * All three reported HEALTHY for the ~4 months the NAICS family blow-out was
 * corrupting profiles (1,144 of them). The jobs ran, the DB was fast, the data was
 * fresh — and it was wrong. This route is the missing check: it asserts the SHAPE
 * of user-owned data and alerts the moment an invariant breaks.
 *
 * Registry lives in src/lib/data-invariants/registry.ts — invariants are DATA, so
 * adding one after the next incident is ~6 lines, not a new route.
 *
 * ALERTING: transition-only, copied from db-health-watch. A breach alerts ONCE;
 * a sustained breach stays silent; recovery alerts once. This is deliberate — the
 * dispatcher watchdog's level-triggered FAILING check spammed Slack 8×/day off a
 * single stale row (fixed 2026-07-26), and this route must not repeat it.
 *
 * Scheduled by a cron_jobs row (dispatcher-fired), NOT vercel.json (100-cron cap).
 * Auth: Bearer CRON_SECRET, or ?password=ADMIN_PASSWORD for a manual run.
 * ?dry_run=true reports without alerting — usable as a manual audit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { sendOpsAlert } from '@/lib/ops-alert';
import { INVARIANTS, passes, type Invariant } from '@/lib/data-invariants/registry';
import { reportCronOutcome } from '@/lib/cron-self-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const STATE_KEY = 'datainv:breaches'; // ids currently in breach, as alerted
// Fired by exactly ONE cron_jobs row.
const CRON_JOB_NAME = 'data-invariants-watch';
const ALERT_TO = process.env.WATCHDOG_ALERT_EMAIL || 'eric@govcongiants.com';

/** ET + UTC together — "did it run today?" is unanswerable otherwise. */
function stamp(d: Date): string {
  const et = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short',
  });
  return `${et} (${d.toISOString().slice(11, 16)} UTC)`;
}

function fmt(inv: Invariant, n: number): string {
  return inv.format ? inv.format(n) : String(n);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  const password = searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  const authorized =
    (ADMIN_PASSWORD && password === ADMIN_PASSWORD) ||
    (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) ||
    isVercelCron;
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!dryRun) await reportCronOutcome(CRON_JOB_NAME, 'error', 'Supabase not configured');
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const now = new Date();
  const results: Array<{
    id: string; label: string; severity: string;
    measured: number | null; display: string; threshold: number;
    ok: boolean; error?: string; means: string;
  }> = [];

  // A probe that throws must not take down the whole run — record it and continue,
  // otherwise one bad query blinds every other invariant.
  for (const inv of INVARIANTS) {
    try {
      const measured = await inv.probe(db);
      results.push({
        id: inv.id, label: inv.label, severity: inv.severity,
        measured, display: fmt(inv, measured), threshold: inv.threshold,
        ok: passes(inv, measured), means: inv.means,
      });
    } catch (e) {
      results.push({
        id: inv.id, label: inv.label, severity: inv.severity,
        measured: null, display: 'probe failed', threshold: inv.threshold,
        ok: true, // a failed probe is not a data breach — don't cry wolf
        error: e instanceof Error ? e.message : String(e),
        means: inv.means,
      });
    }
  }

  const breached = results.filter((r) => !r.ok);
  const probeErrors = results.filter((r) => r.error);

  // Transition detection: alert only on invariants that are NEWLY breached, and
  // announce recovery once. A sustained breach stays quiet.
  let previouslyBreached: string[] = [];
  try {
    previouslyBreached = (await kv.get<string[]>(STATE_KEY)) || [];
  } catch { /* KV unavailable — treat as no prior state */ }

  const nowBreachedIds = breached.map((b) => b.id);
  const newlyBreached = breached.filter((b) => !previouslyBreached.includes(b.id));
  const recovered = previouslyBreached.filter((id) => !nowBreachedIds.includes(id));

  if (!dryRun && (newlyBreached.length > 0 || recovered.length > 0)) {
    const lines: string[] = [];
    for (const b of newlyBreached) {
      const icon = b.severity === 'critical' ? '🔴' : '🟠';
      lines.push(
        `<p>${icon} <strong>${b.label}</strong><br>` +
          `measured <strong>${b.display}</strong> vs threshold ${b.threshold}<br>` +
          `<span style="color:#666">${b.means}</span></p>`,
      );
    }
    for (const id of recovered) {
      const r = results.find((x) => x.id === id);
      lines.push(`<p>✅ <strong>Recovered:</strong> ${r?.label ?? id} (now ${r?.display ?? 'ok'})</p>`);
    }
    if (probeErrors.length) {
      lines.push(
        `<p style="color:#888">⚠️ ${probeErrors.length} probe(s) failed to run: ` +
          `${probeErrors.map((p) => p.id).join(', ')}</p>`,
      );
    }

    await sendOpsAlert({
      to: ALERT_TO,
      transactional: true,
      emailType: 'data_invariants_watch',
      subject:
        newlyBreached.length > 0
          ? `⚠️ Data invariant breached — ${newlyBreached[0].label}`
          : `✅ Data invariant recovered`,
      html:
        `<h2>Data invariants watch</h2>${lines.join('')}` +
        `<p style="color:#888">${breached.length} of ${results.length} invariants breached. ` +
        `Checked ${stamp(now)}.</p>`,
      text:
        `Data invariants: newly_breached=[${newlyBreached.map((b) => b.id).join(',')}] ` +
        `recovered=[${recovered.join(',')}] at ${stamp(now)}`,
    });
  }

  if (!dryRun) {
    try { await kv.set(STATE_KEY, nowBreachedIds); } catch { /* ignore */ }
  }

  // TERMINAL SELF-REPORT. All 30 runs in the 30 days before this was wired were
  // recorded `dispatched` with http_status NULL — this watch queries every invariant
  // serially and outlives the dispatcher's 12s ack, so nothing ever confirmed the
  // WATCH ITSELF had run. A silent watchdog is the worst kind: it reads as "no
  // breaches" when it may simply never have looked.
  //
  // EXECUTION vs ADVANCEMENT stay separate, and here they point opposite ways: a
  // BREACHED invariant is a healthy run of the watch (it found what it looks for),
  // so it is a success. A run whose PROBES failed to evaluate is the reverse — it
  // completed while establishing nothing, which is partial, never success. That
  // distinction is exactly what `ok: true // a failed probe is not a data breach`
  // encodes per-probe, carried up to the job's own status.
  if (!dryRun) {
    await reportCronOutcome(
      CRON_JOB_NAME,
      probeErrors.length === results.length && results.length > 0
        ? 'error'
        : probeErrors.length > 0
          ? 'partial'
          : 'success',
      probeErrors.length > 0
        ? `${probeErrors.length}/${results.length} probes failed to evaluate: ${probeErrors.map((p) => p.id).join(',')}`
        : undefined,
    );
  }

  return NextResponse.json({
    ok: breached.length === 0,
    checkedAt: now.toISOString(),
    checkedAtLocal: stamp(now),
    dryRun,
    total: results.length,
    breachedCount: breached.length,
    newlyBreached: newlyBreached.map((b) => b.id),
    recovered,
    results,
  });
}
