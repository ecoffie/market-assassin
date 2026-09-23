/**
 * Deliverability P0 — teach Mindy what Resend already knows.
 *
 *   npx tsx scripts/email-p0-reconcile-suppressions.ts                 # DRY RUN (default, read-only)
 *   npx tsx scripts/email-p0-reconcile-suppressions.ts --out <file>    # also write the per-address CSV
 *   npx tsx scripts/email-p0-reconcile-suppressions.ts --go            # WRITE (requires explicit approval)
 *
 * Sources, all read-only:
 *   A. Resend's account suppression list (GET /suppressions): addresses Resend will no
 *      longer deliver to, with origin (bounce|complaint) and the triggering email id.
 *   B. Mindy's own email_provider_events history, replayed through the SAME rules the
 *      webhook now applies (src/lib/email/suppression.ts): Permanent bounce, complaint,
 *      and the repeated-transient rule over the trailing window.
 *
 * Excluded: the synthetic healthcheck population (scripts/email-p0-healthcheck-cleanup.ts
 * handles it) — reported separately so the two write sets never overlap.
 *
 * --go writes ONLY insert-if-absent rows into email_suppressions (mailbox suppression).
 * It never deletes users, watches or saved searches, never changes alerts_enabled (the
 * product preference), and never touches Resend's provider-side list.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  evaluateTransientHistory,
  HEALTHCHECK_ADDRESS_RE,
  TRANSIENT_WINDOW_DAYS,
  type HistoryEvent,
  type SuppressionReason,
} from '../src/lib/email/suppression';

const GO = process.argv.includes('--go');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : null;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const RESEND_KEY = process.env.RESEND_API_KEY?.replace(/\\n$/, '').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * INTERNAL-MAILBOX SAFETY FILTER. An address on our own domains is bulk-suppressed only
 * when it is recognisably synthetic/test/demo. Anything else on these domains — a real
 * working mailbox (eric@) or an uncertain one (hello@) — is HELD out of this bulk write
 * and reported for separate investigation: a delivery problem on a real internal mailbox
 * must be diagnosed, not silently turned into a permanent suppression.
 */
const INTERNAL_DOMAIN = /@(govcongiants\.com|getmindy\.ai)$/;
const SYNTHETIC_INTERNAL = [
  /^test-[a-z0-9-]+@govcongiants\.com$/,
  /^(demo|pestdemo)@govcongiants\.com$/,
  /^disa-demo@getmindy\.ai$/,
  /^seed\+[a-z]+-\d+@getmindy\.ai$/,
  /^(credit-integrity-acceptance|p0-credits-contract-verify)@getmindy\.ai$/,
  /^cyrus-[a-z0-9-]+@getmindy\.ai$/,
];
function internalHoldReason(email: string): string | null {
  if (!INTERNAL_DOMAIN.test(email)) return null;
  return SYNTHETIC_INTERNAL.some((re) => re.test(email)) ? null : 'internal_mailbox_not_known_synthetic';
}

interface Candidate {
  email: string;
  reason: SuppressionReason;
  source: string;
  provider_event_id: string | null;
  provider_message_id: string | null;
  bounce_type: string | null;
  bounce_subtype: string | null;
  diagnostic: string | null;
  event_at: string | null;
  metadata: Record<string, unknown>;
}

async function resendSuppressions() {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY missing');
  const out: Array<{ email: string; origin: string; source_id: string | null; created_at: string }> = [];
  let after: string | null = null;
  for (;;) {
    const url = `https://api.resend.com/suppressions?limit=100${after ? `&after=${after}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${RESEND_KEY}` } });
    if (!res.ok) throw new Error(`Resend /suppressions ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data: typeof out & { id: string }[]; has_more: boolean };
    out.push(...body.data.map((r) => ({ ...r, email: r.email.trim().toLowerCase() })));
    if (!body.has_more || body.data.length === 0) break;
    after = (body.data[body.data.length - 1] as unknown as { id: string }).id;
    await sleep(600);
  }
  return out;
}

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

type EvRow = { provider_event_id: string | null; provider_message_id: string | null; user_email: string | null; event_type: string; occurred_at: string; bounce_type: string | null; bounce_subtype: string | null; diagnostic: string | null };
const EV_COLS = 'provider_event_id, provider_message_id, user_email, event_type, occurred_at, bounce_type:raw_payload->data->bounce->>type, bounce_subtype:raw_payload->data->bounce->>subType, diagnostic:raw_payload->data->bounce->>message';

async function main() {
  const now = new Date();
  const candidates = new Map<string, Candidate>();
  const put = (c: Candidate) => { if (!candidates.has(c.email)) candidates.set(c.email, c); };
  let healthcheckSeen = 0;
  const skipHealthcheck = (e: string) => { if (HEALTHCHECK_ADDRESS_RE.test(e)) { healthcheckSeen++; return true; } return false; };

  // ---- A. Resend's account suppression list ------------------------------------
  const provider = await resendSuppressions();
  const sourceIds = provider.map((p) => p.source_id).filter(Boolean) as string[];
  const bySourceMsg = new Map<string, EvRow>();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data, error } = await sb.from('email_provider_events').select(EV_COLS)
      .in('provider_message_id', sourceIds.slice(i, i + 100)).in('event_type', ['email.bounced', 'email.complained']);
    if (error) throw new Error(`source event lookup failed: ${error.message}`);
    for (const r of (data || []) as EvRow[]) if (r.provider_message_id) bySourceMsg.set(r.provider_message_id, r);
  }
  for (const p of provider) {
    if (skipHealthcheck(p.email)) continue;
    const ev = p.source_id ? bySourceMsg.get(p.source_id) : undefined;
    put({
      email: p.email,
      reason: p.origin === 'complaint' ? 'complaint' : ev?.bounce_type === 'Permanent' ? 'hard_bounce' : 'provider_suppressed',
      source: 'p0_reconcile_resend_list',
      provider_event_id: ev?.provider_event_id ?? null,
      provider_message_id: p.source_id,
      bounce_type: ev?.bounce_type ?? null,
      bounce_subtype: ev?.bounce_subtype ?? null,
      diagnostic: ev?.diagnostic ? ev.diagnostic.slice(0, 1000) : null,
      event_at: ev?.occurred_at ?? p.created_at,
      metadata: { resend_origin: p.origin, resend_suppressed_at: p.created_at },
    });
  }

  // ---- B. History replayed through the webhook rules ---------------------------
  const hard = await pageAll<EvRow>((f, t) => sb.from('email_provider_events').select(EV_COLS)
    .eq('event_type', 'email.bounced').eq('raw_payload->data->bounce->>type', 'Permanent').range(f, t));
  const complaints = await pageAll<EvRow>((f, t) => sb.from('email_provider_events').select(EV_COLS)
    .eq('event_type', 'email.complained').range(f, t));
  for (const [rows, reason] of [[complaints, 'complaint'], [hard, 'hard_bounce']] as const) {
    for (const r of rows) {
      const e = r.user_email?.toLowerCase();
      if (!e || skipHealthcheck(e)) continue;
      put({
        email: e, reason, source: 'p0_reconcile_history',
        provider_event_id: r.provider_event_id, provider_message_id: r.provider_message_id,
        bounce_type: r.bounce_type, bounce_subtype: r.bounce_subtype,
        diagnostic: r.diagnostic ? r.diagnostic.slice(0, 1000) : null,
        event_at: r.occurred_at, metadata: {},
      });
    }
  }

  const since = new Date(now.getTime() - TRANSIENT_WINDOW_DAYS * 86_400_000).toISOString();
  const recentBounces = await pageAll<EvRow>((f, t) => sb.from('email_provider_events').select(EV_COLS)
    .eq('event_type', 'email.bounced').gte('occurred_at', since).range(f, t));
  const byAddr = new Map<string, EvRow[]>();
  for (const r of recentBounces) {
    const e = r.user_email?.toLowerCase();
    if (!e || HEALTHCHECK_ADDRESS_RE.test(e)) continue;
    byAddr.set(e, [...(byAddr.get(e) || []), r]);
  }
  const addrs = [...byAddr.keys()];
  for (let i = 0; i < addrs.length; i += 100) {
    const part = addrs.slice(i, i + 100);
    const delivered = await pageAll<EvRow>((f, t) => sb.from('email_provider_events').select(EV_COLS)
      .eq('event_type', 'email.delivered').in('user_email', part).gte('occurred_at', since).range(f, t));
    for (const d of delivered) byAddr.get(String(d.user_email).toLowerCase())?.push(d);
  }
  for (const [e, rows] of byAddr) {
    const hist: HistoryEvent[] = rows.map((r) => ({ eventId: r.provider_event_id, eventType: r.event_type, occurredAt: r.occurred_at, bounceType: r.bounce_type }));
    const v = evaluateTransientHistory(hist, now);
    if (!v.suppress) continue;
    const last = rows.filter((r) => r.event_type === 'email.bounced').sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    put({
      email: e, reason: 'repeated_transient_bounce', source: 'p0_reconcile_history',
      provider_event_id: last.provider_event_id, provider_message_id: last.provider_message_id,
      bounce_type: last.bounce_type, bounce_subtype: last.bounce_subtype,
      diagnostic: last.diagnostic ? last.diagnostic.slice(0, 1000) : null,
      event_at: last.occurred_at, metadata: { transient: v },
    });
  }

  // ---- Current local state for every candidate ----------------------------------
  const emails = [...candidates.keys()];
  const alreadySuppressed = new Set<string>();
  const prefs = new Map<string, { alerts_enabled: boolean | null; briefings_enabled: boolean | null }>();
  const sends15 = new Map<string, number>();
  const since15 = new Date(now.getTime() - 15 * 86_400_000).toISOString();
  for (let i = 0; i < emails.length; i += 100) {
    const part = emails.slice(i, i + 100);
    const [s, p, sends] = await Promise.all([
      sb.from('email_suppressions').select('user_email').in('user_email', part),
      sb.from('user_notification_settings').select('user_email, alerts_enabled, briefings_enabled').in('user_email', part),
      pageAll<{ user_email: string }>((f, t) => sb.from('email_provider_sends').select('user_email').in('user_email', part).gte('sent_at', since15).range(f, t)),
    ]);
    if (s.error || p.error) throw new Error(`state lookup failed: ${s.error?.message || p.error?.message}`);
    for (const r of s.data || []) alreadySuppressed.add(String(r.user_email).toLowerCase());
    for (const r of p.data || []) prefs.set(String(r.user_email).toLowerCase(), r);
    for (const r of sends) sends15.set(r.user_email.toLowerCase(), (sends15.get(r.user_email.toLowerCase()) || 0) + 1);
  }

  const notYet = [...candidates.values()].filter((c) => !alreadySuppressed.has(c.email));
  const held = notYet.filter((c) => internalHoldReason(c.email));
  const toWrite = notYet.filter((c) => !internalHoldReason(c.email));
  const count = <K extends string>(xs: Candidate[], k: (c: Candidate) => K) =>
    xs.reduce<Record<string, number>>((m, c) => { const key = k(c); m[key] = (m[key] || 0) + 1; return m; }, {});
  const domainGroup = (e: string) => {
    const d = e.split('@')[1];
    if (['gmail.com', 'googlemail.com'].includes(d)) return 'gmail';
    if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) return 'ms-consumer';
    if (['yahoo.com', 'aol.com', 'ymail.com', 'verizon.net'].includes(d)) return 'yahoo/aol';
    if (d.endsWith('.gov') || d.endsWith('.mil')) return 'gov/mil';
    return 'other/corporate';
  };

  const report = {
    mode: GO ? 'EXECUTE' : 'DRY_RUN',
    resend_suppression_list: {
      total: provider.length,
      by_origin: provider.reduce<Record<string, number>>((m, p) => { m[p.origin] = (m[p.origin] || 0) + 1; return m; }, {}),
      source_event_found_locally: provider.filter((p) => p.source_id && bySourceMsg.has(p.source_id)).length,
    },
    history: { permanent_bounce_events: hard.length, complaint_events: complaints.length, addresses_with_bounces_in_window: byAddr.size },
    healthcheck_addresses_excluded: healthcheckSeen,
    candidates: candidates.size,
    already_suppressed_locally: candidates.size - notYet.length,
    held_internal_mailboxes: held.map((c) => ({ email: c.email, reason: c.reason, event_at: c.event_at, hold: internalHoldReason(c.email) })),
    write_set_rows: toWrite.length,
    write_set_internal_synthetic: toWrite.filter((c) => INTERNAL_DOMAIN.test(c.email)).map((c) => c.email),
    write_set_by_reason: count(toWrite, (c) => c.reason),
    write_set_by_source: count(toWrite, (c) => c.source),
    write_set_by_domain_group: count(toWrite, (c) => domainGroup(c.email)),
    write_set_with_alerts_enabled: toWrite.filter((c) => prefs.get(c.email)?.alerts_enabled === true).length,
    write_set_with_briefings_enabled: toWrite.filter((c) => prefs.get(c.email)?.briefings_enabled === true).length,
    write_set_without_profile: toWrite.filter((c) => !prefs.has(c.email)).length,
    write_set_still_mailed_last_15d: toWrite.filter((c) => (sends15.get(c.email) || 0) > 0).length,
    write_set_sends_last_15d: toWrite.reduce((n, c) => n + (sends15.get(c.email) || 0), 0),
    sample: toWrite.slice(0, 3).map((c) => ({ ...c, email: c.email.replace(/^(.{2}).*(@.*)$/, '$1***$2') })),
    proposed_write: 'INSERT INTO email_suppressions (...) ON CONFLICT (user_email) DO NOTHING — no deletes, no preference changes, no provider changes',
  };
  console.log(JSON.stringify(report, null, 2));

  if (OUT) {
    const header = 'email,reason,source,bounce_type,bounce_subtype,event_at,alerts_enabled,sends_last_15d,diagnostic';
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    writeFileSync(OUT, [header, ...toWrite.map((c) => [c.email, c.reason, c.source, c.bounce_type, c.bounce_subtype, c.event_at,
      prefs.get(c.email)?.alerts_enabled ?? '', sends15.get(c.email) || 0, c.diagnostic].map(esc).join(','))].join('\n'));
    console.log(`\nper-address write set → ${OUT}`);
  }

  if (!GO) {
    console.log('\nDRY RUN — nothing written. Re-run with --go only after explicit approval.');
    return;
  }

  let inserted = 0;
  for (let i = 0; i < toWrite.length; i += 100) {
    // truncation-ok: batches are <= 100 rows, below the 1,000-row RETURNING cap; verified by re-count below.
    const { data, error } = await sb.from('email_suppressions')
      .upsert(toWrite.slice(i, i + 100).map((c) => ({ // truncation-ok: <=100-row batch
        user_email: c.email, reason: c.reason, source: c.source, provider: 'resend',
        provider_event_id: c.provider_event_id, provider_message_id: c.provider_message_id,
        bounce_type: c.bounce_type, bounce_subtype: c.bounce_subtype, diagnostic: c.diagnostic,
        event_at: c.event_at, metadata: c.metadata,
      })), { onConflict: 'user_email', ignoreDuplicates: true })
      .select('user_email'); // unranged-ok: RETURNING of a <=100-row batch
    if (error) throw new Error(`insert failed: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  const { count: present, error: vErr } = await sb.from('email_suppressions').select('*', { count: 'exact', head: true })
    .in('user_email', toWrite.slice(0, 1000).map((c) => c.email));
  if (vErr || present === null) throw new Error(`verify failed: ${vErr?.message ?? 'null count'}`);
  console.log({ inserted, verified_present: present, expected: Math.min(toWrite.length, 1000) });
}

main().catch((e) => { console.error(e); process.exit(1); });
