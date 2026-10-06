/**
 * READ-ONLY recovery preview — keyword-only daily-alert profiles (match-health audit 2026-10-06).
 *
 * For every alert-enabled profile whose Open search is keyword-only (no valid NAICS, no PSC,
 * ≥1 keyword — the only shape whose SQL carries keyword clauses, per Contract D), this:
 *   1. re-runs the REAL fetchSamOpportunitiesFromCache with the daily cron's parameters, on
 *      BOTH keyword paths (ILIKE = SAM_FTS_KEYWORDS unset, FTS = 'on'), timing each and
 *      recording queryStatus — production's flag value cannot be read locally (Sensitive
 *      vars pull empty), so both are measured rather than one assumed;
 *   2. reads the user's last 30 days of daily alert_log outcomes;
 *   3. proposes an action per user. Nothing is written, sent, or changed.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/preview-keyword-only-open-search.ts --out <private dir>
 * Per-user rows (with emails) go ONLY to --out/<file>.csv. stdout carries aggregates only.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null;
if (!OUT) { console.error('--out <private dir> is required (per-user rows contain emails)'); process.exit(2); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('missing Supabase env'); process.exit(2); }
const sb = createClient(url, key);

type U = {
  user_email: string; naics_codes: string[] | null; keywords: string[] | null; psc_codes: string[] | null;
  business_type: string | null; location_state: string | null; location_states: string[] | null;
  aggregated_profile: unknown; alert_frequency: string | null;
};

async function main() {
  const { fetchSamOpportunitiesFromCache } = await import('@/lib/briefings/pipelines/sam-gov');
  const { knownNaicsForMatch } = await import('@/lib/codes/validate-market-codes');
  const { eligibleSetAsidesCombined } = await import('@/lib/market/set-aside-eligibility');
  const { loadVaultEligibility } = await import('@/lib/market/vault-eligibility');

  const users: U[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('user_notification_settings')
      .select('user_email, naics_codes, keywords, psc_codes, business_type, location_state, location_states, aggregated_profile, alert_frequency')
      .eq('is_active', true).eq('alerts_enabled', true)
      .in('alert_frequency', ['daily', 'weekdays', 'weekends', 'mwf', 'tth'])
      .order('user_email').range(from, from + 999);
    if (error) throw new Error(`users: ${error.message}`);
    users.push(...(data as U[]));
    if (!data || data.length < 1000) break;
  }
  const kwOnly = users.filter((u) => knownNaicsForMatch(u.naics_codes || []).length === 0
    && !(u.psc_codes || []).some(Boolean) && (u.keywords || []).length > 0);
  const vault = await loadVaultEligibility(sb, kwOnly.map((u) => u.user_email));

  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const rows: string[] = [];
  const agg = { profiles: kwOnly.length, ilikeError: 0, ftsError: 0, ilikeOk: 0, ftsOk: 0, falseZero30d: 0, zeroSent30d: 0, actions: {} as Record<string, number> };
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  rows.push(['email', 'keywords', 'ilike_status', 'ilike_ms', 'ilike_count', 'ilike_error', 'fts_status', 'fts_ms', 'fts_count', 'fts_error',
    'log30_sent', 'log30_sent_zero', 'log30_no_opps', 'log30_failed', 'proposed_action'].join(','));

  for (const u of kwOnly) {
    const states = u.location_states?.length ? u.location_states : u.location_state ? [u.location_state] : undefined;
    const params = {
      naicsCodes: [] as string[], keywords: u.keywords || [], limit: 200, savedNaics: [] as string[], states,
      setAsides: eligibleSetAsidesCombined(u.business_type, vault.get(u.user_email.toLowerCase())),
    };
    const measure = async (fts: boolean) => {
      if (fts) process.env.SAM_FTS_KEYWORDS = 'on'; else delete process.env.SAM_FTS_KEYWORDS;
      const t = Date.now();
      const r = await fetchSamOpportunitiesFromCache(params);
      return { ms: Date.now() - t, status: r.queryStatus, count: r.opportunities.length, err: r.queryError ? `${r.queryError.code} ${r.queryError.message}` : '' };
    };
    const ilike = await measure(false);
    const fts = await measure(true);
    delete process.env.SAM_FTS_KEYWORDS;
    if (ilike.status === 'error') agg.ilikeError++; else agg.ilikeOk++;
    if (fts.status === 'error') agg.ftsError++; else agg.ftsOk++;

    const { data: log, error: logErr } = await sb.from('alert_log')
      .select('alert_date, delivery_status, opportunities_count, error_message')
      .eq('user_email', u.user_email).eq('alert_type', 'daily').gte('alert_date', since);
    if (logErr) throw new Error(`alert_log: ${logErr.message}`);
    const l = log || [];
    const sent = l.filter((r) => r.delivery_status === 'sent').length;
    const sentZero = l.filter((r) => r.delivery_status === 'sent' && !r.opportunities_count).length;
    const noOpps = l.filter((r) => r.error_message === 'no_new_or_active_opportunities').length;
    const failed = l.filter((r) => r.delivery_status === 'failed').length;
    // A "no opportunities" day is SUSPECT when today's search (either path) finds work.
    const findsWorkNow = (ilike.status === 'ok' && ilike.count > 0) || (fts.status === 'ok' && fts.count > 0);
    if (noOpps > 0 && findsWorkNow) agg.falseZero30d++;
    if (sentZero > 0) agg.zeroSent30d++;

    let action: string;
    if (ilike.status === 'error' && fts.status === 'error') action = 'search fails on both paths — after fix: recorded failed + retried; needs query-cost decision';
    else if (ilike.status === 'error') action = 'ILIKE path times out, FTS works — outcome depends on prod SAM_FTS_KEYWORDS; after fix failures are recorded, not zeroed';
    else if (noOpps > 0 && findsWorkNow) action = 'had "no opportunities" days while work exists now — review; no catch-up send (not authorized)';
    else action = 'no action';
    agg.actions[action] = (agg.actions[action] || 0) + 1;

    rows.push([u.user_email, (u.keywords || []).join('; '), ilike.status, ilike.ms, ilike.count, ilike.err, fts.status, fts.ms, fts.count, fts.err,
      sent, sentZero, noOpps, failed, action].map(esc).join(','));
  }

  fs.mkdirSync(OUT!, { recursive: true });
  const file = path.join(OUT!, `keyword-only-preview-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, rows.join('\n') + '\n');
  console.log(JSON.stringify({ ...agg, writtenTo: file }, null, 2));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
