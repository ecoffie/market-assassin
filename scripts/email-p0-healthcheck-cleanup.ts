/**
 * Deliverability P0 — retire the obsolete health-check alert population.
 *
 *   npx tsx scripts/email-p0-healthcheck-cleanup.ts            # DRY RUN (default, read-only)
 *   npx tsx scripts/email-p0-healthcheck-cleanup.ts --json     # dry run, machine-readable
 *   npx tsx scripts/email-p0-healthcheck-cleanup.ts --go       # WRITE (requires explicit approval)
 *
 * WHO: every user_notification_settings row whose user_email matches
 * HEALTHCHECK_ADDRESS_RE (`healthcheck-<digits>@test.govcongiants.com|org`). An old
 * version of cron/health-check signed these up and never cleaned them up; the domain has
 * no DNS, so each daily alert to them is a transient bounce (~300/day, 90% of all bounces
 * Sep 8–23). The health check itself was repointed to a real mailbox and stopped creating
 * them on 2026-07-23.
 *
 * WHAT --go WRITES (nothing is deleted — the audit trail is preserved):
 *   1. user_notification_settings: alerts_enabled=false for the matched rows only
 *      (alert_frequency, NAICS, history are left untouched).
 *   2. email_suppressions: one insert-if-absent row per address,
 *      reason='synthetic_address', source='p0_healthcheck_cleanup'.
 * Both are idempotent: a re-run changes nothing.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { HEALTHCHECK_ADDRESS_RE } from '../src/lib/email/suppression';

const GO = process.argv.includes('--go');
const JSON_OUT = process.argv.includes('--json');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Tables that can hold data keyed by the address — measured from information_schema
// (2026-09-23), used only to REPORT what else is attached. Nothing here is written.
const ATTACHED: Array<[string, string]> = [
  ['saved_searches', 'user_email'], ['user_pipeline', 'user_email'], ['user_profiles', 'email'],
  ['purchases', 'user_email'], ['purchases_canonical', 'user_email'], ['stripe_customers', 'email'],
  ['access_grants', 'email'], ['mcp_credit_balance', 'user_email'], ['mcp_api_keys', 'user_email'],
  ['user_identity_profile', 'user_email'], ['user_business_profiles', 'user_email'],
  ['user_past_performance', 'user_email'], ['user_target_list', 'user_email'],
  ['user_saved_opportunities', 'user_email'], ['user_recompete_watchlist', 'user_email'],
  ['contacts', 'user_email'], ['conversations', 'user_email'], ['org_members', 'user_email'],
  ['user_engagement', 'user_email'], ['signup_attribution', 'email'],
  ['alert_log', 'user_email'], ['briefing_log', 'user_email'],
  ['email_provider_sends', 'user_email'], ['email_tracking_tokens', 'user_email'],
  ['email_suppressions', 'user_email'],
];

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function countIn(table: string, col: string, emails: string[]): Promise<number | 'unknown'> {
  let total = 0;
  for (const part of chunk(emails, 100)) {
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true }).in(col, part);
    if (error || count === null) return 'unknown'; // never turn "could not read" into 0
    total += count;
  }
  return total;
}

async function main() {
  // Candidates by pattern, then the exact regex as the authority.
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('user_email, alerts_enabled, alert_frequency, briefings_enabled, is_active, invitation_source, created_at')
      .ilike('user_email', 'healthcheck-%@test.govcongiants.%')
      .range(from, from + 999);
    if (error) throw new Error(`profile read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const matched = rows.filter((r) => HEALTHCHECK_ADDRESS_RE.test(String(r.user_email)));
  const rejectedByRegex = rows.length - matched.length;
  const emails = matched.map((r) => String(r.user_email));

  const tally = (key: string) =>
    matched.reduce<Record<string, number>>((m, r) => {
      const k = String(r[key]);
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});

  const attached: Record<string, number | 'unknown'> = {};
  for (const [t, c] of ATTACHED) attached[`${t}.${c}`] = await countIn(t, c, emails);

  // Saved-search schedules are a separate alert stream (per-search preference).
  const { data: ss, error: ssErr } = emails.length
    ? await sb.from('saved_searches').select('user_email, alerts_enabled').in('user_email', emails.slice(0, 1000))
    : { data: [], error: null };
  if (ssErr) throw new Error(`saved_searches read failed: ${ssErr.message}`);

  // Sends in the last 15 days (the Sep 8–23 baseline window size).
  const since = new Date(Date.now() - 15 * 86_400_000).toISOString();
  let sends15d = 0;
  for (const part of chunk(emails, 100)) {
    const { count, error } = await sb.from('email_provider_sends').select('*', { count: 'exact', head: true })
      .in('user_email', part).gte('sent_at', since);
    if (error || count === null) throw new Error(`send count failed: ${error?.message ?? 'null count'}`);
    sends15d += count;
  }

  const alreadySuppressed = attached['email_suppressions.user_email'];
  const writeSet = {
    user_notification_settings: {
      filter: `user_email ~ ${HEALTHCHECK_ADDRESS_RE} AND alerts_enabled = true`,
      update: { alerts_enabled: false },
      rows: matched.filter((r) => r.alerts_enabled === true).length,
    },
    email_suppressions: {
      insert_if_absent: { reason: 'synthetic_address', source: 'p0_healthcheck_cleanup' },
      rows: emails.length,
      already_present: alreadySuppressed,
    },
    deletes: 0,
  };

  const report = {
    mode: GO ? 'EXECUTE' : 'DRY_RUN',
    pattern: String(HEALTHCHECK_ADDRESS_RE),
    candidates_by_ilike: rows.length,
    rejected_by_exact_regex: rejectedByRegex,
    matched: matched.length,
    by_domain: matched.reduce<Record<string, number>>((m, r) => {
      const d = String(r.user_email).split('@')[1];
      m[d] = (m[d] || 0) + 1;
      return m;
    }, {}),
    alerts_enabled: tally('alerts_enabled'),
    alert_frequency: tally('alert_frequency'),
    briefings_enabled: tally('briefings_enabled'),
    is_active: tally('is_active'),
    invitation_source: tally('invitation_source'),
    created_range: matched.length
      ? [matched.map((r) => String(r.created_at)).sort()[0], matched.map((r) => String(r.created_at)).sort().at(-1)]
      : null,
    saved_searches: { total: ss?.length ?? 0, with_alerts_enabled: (ss || []).filter((s) => s.alerts_enabled).length },
    provider_sends_last_15d: sends15d,
    attached_data_rows: attached,
    sample: matched.slice(0, 3),
    write_set: writeSet,
  };

  if (!GO) {
    console.log(JSON_OUT ? JSON.stringify(report, null, 2) : report);
    console.log('\nDRY RUN — nothing written. Re-run with --go only after explicit approval.');
    return;
  }

  // ---- EXECUTE ----------------------------------------------------------------
  let disabled = 0;
  for (const part of chunk(emails, 100)) {
    const { count, error } = await sb
      .from('user_notification_settings')
      .update({ alerts_enabled: false }, { count: 'exact' })
      .in('user_email', part)
      .eq('alerts_enabled', true);
    if (error || count === null) throw new Error(`disable failed: ${error?.message ?? 'null count'}`);
    disabled += count;
  }
  let inserted = 0;
  for (const part of chunk(emails, 100)) {
    const { data, error } = await sb
      .from('email_suppressions')
      .upsert(
        part.map((e) => ({
          user_email: e, reason: 'synthetic_address', source: 'p0_healthcheck_cleanup',
          metadata: { rule: String(HEALTHCHECK_ADDRESS_RE), run_at: new Date().toISOString() },
        })),
        { onConflict: 'user_email', ignoreDuplicates: true },
      )
      .select('user_email');
    if (error) throw new Error(`suppression insert failed: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  // Prove it landed: re-read, never trust the write receipt alone.
  const { count: stillEnabled, error: vErr } = await sb.from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .ilike('user_email', 'healthcheck-%@test.govcongiants.%').eq('alerts_enabled', true);
  if (vErr || stillEnabled === null) throw new Error(`verify failed: ${vErr?.message ?? 'null count'}`);
  console.log({ disabled, suppressions_inserted: inserted, still_enabled_after: stillEnabled });
  if (stillEnabled !== 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
