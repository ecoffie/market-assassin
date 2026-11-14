/**
 * READ-ONLY parity audit: legacy saved-search alert evaluator vs the Map's canonical evaluator.
 *
 * For every alerting saved search, runs the Open-horizon query TWO ways against the live DB:
 *   legacy    = savedSearchOpenEvaluation(…, 'legacy')    (what saved-search-alerts runs today)
 *   canonical = savedSearchOpenEvaluation(…, 'canonical') (the Map's adapter, as the cron runs it after the flip)
 * The exact code path the cron executes, incl. the 30-day posted window, and reports per watch: counts, plan status,
 * notice ids gained/lost. Writes nothing. Sends nothing.
 *
 *   npx tsx scripts/audit-saved-search-parity.ts            # summary + per-watch table
 *   npx tsx scripts/audit-saved-search-parity.ts --json     # machine-readable
 *   npx tsx scripts/audit-saved-search-parity.ts --all      # include provably-unaffected watches
 */
import { config } from 'dotenv';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { savedSearchOpenEvaluation } from '@/lib/saved-searches/open-evaluator';

config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env.local') });

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');
const ALL = args.has('--all');
const ID_CAP = 2000; // ids fetched per side for the gained/lost diff

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Row = { id: string; user_email: string; name: string | null; mode: string; filters: Record<string, unknown> };

const planOwned = (f: Record<string, unknown>) =>
  String(f.q ?? f.search ?? '').trim() !== '' || String(f.agency ?? '').trim() !== ''
  || ['fullOpen', 'hideCommodity', 'hasDocs', 'hasContact'].some((k) => typeof f[k] === 'boolean');

async function profileFor(email: string) {
  const { data, error } = await db.from('user_notification_settings').select('naics_codes, location_states').eq('user_email', email).maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  return { profileNaics: (data?.naics_codes as string[] | null) || [], profileStates: (data?.location_states as string[] | null) || [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(build: (q: any) => any): Promise<{ count: number | null; ids: string[] }> {
  const head = await build(db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }));
  if (head.error) throw new Error(head.error.message);
  const ids: string[] = [];
  for (let from = 0; from < ID_CAP; from += 1000) {
    const { data, error } = await build(db.from('sam_opportunities').select('notice_id')).order('notice_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    ids.push(...(data || []).map((r: { notice_id: string }) => r.notice_id));
    if (!data || data.length < 1000) break;
  }
  return { count: head.count ?? null, ids };
}

async function main() {
  const { data, error } = await db.from('saved_searches').select('id, user_email, name, mode, filters').eq('alerts_enabled', true);
  if (error) throw new Error(error.message);
  const rows = (data || []) as Row[];
  const out = [];
  for (const s of rows) {
    const affected = planOwned(s.filters || {});
    if (!affected && !ALL) continue;
    let opts: { profileNaics?: string[]; profileStates?: string[] } | undefined;
    try {
      if (s.filters?.scope === 'profile') {
        opts = await profileFor(s.user_email);
        if (!opts.profileNaics?.length) { out.push({ id: s.id, name: s.name, affected, skipped: 'no_profile_naics' }); continue; }
      }
      const le = savedSearchOpenEvaluation(s.filters, opts, 'legacy');
      const ce = savedSearchOpenEvaluation(s.filters, opts, 'canonical');
      if (!le.ok) throw new Error('legacy never blocks');
      if (!ce.ok) {
        const legacyOnly = await run(le.apply);
        out.push({ id: s.id, owner: s.user_email, name: s.name, affected, q: String(s.filters.q ?? s.filters.search ?? ''), agency: String(s.filters.agency ?? ''), planStatus: ce.status, via: 'blocked', legacy: legacyOnly.count, canonical: null, gained: 0, lost: legacyOnly.ids.length, idsTruncated: legacyOnly.ids.length >= ID_CAP });
        continue;
      }
      const [legacy, canon] = await Promise.all([run(le.apply), run(ce.apply)]);
      const L = new Set(legacy.ids), C = new Set(canon.ids);
      out.push({
        id: s.id, owner: s.user_email, name: s.name, affected,
        q: String(s.filters.q ?? s.filters.search ?? ''), agency: String(s.filters.agency ?? ''),
        planStatus: 'ok', via: ce.via,
        legacy: legacy.count, canonical: canon.count,
        gained: canon.ids.filter((i) => !L.has(i)).length, lost: legacy.ids.filter((i) => !C.has(i)).length,
        idsTruncated: legacy.ids.length >= ID_CAP || canon.ids.length >= ID_CAP,
      });
    } catch (e) {
      out.push({ id: s.id, name: s.name, affected, error: (e as Error).message });
    }
  }
  const ev = out.filter((r: any) => 'legacy' in r) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const summary = {
    alerting: rows.length,
    evaluated: ev.length,
    identical: ev.filter((r) => r.gained === 0 && r.lost === 0).length,
    gainOnly: ev.filter((r) => r.gained > 0 && r.lost === 0).length,
    loseOnly: ev.filter((r) => r.lost > 0 && r.gained === 0).length,
    both: ev.filter((r) => r.gained > 0 && r.lost > 0).length,
    blockedByPlan: ev.filter((r) => r.planStatus !== 'ok').length,
    legacyNonZeroToCanonZero: ev.filter((r) => (r.legacy ?? 0) > 0 && r.canonical === 0).length,
    errors: out.filter((r: any) => r.error).length, // eslint-disable-line @typescript-eslint/no-explicit-any
    skipped: out.filter((r: any) => r.skipped).length, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  if (JSON_OUT) { console.log(JSON.stringify({ summary, watches: out }, null, 2)); return; }
  console.log(summary);
  console.table(ev.map((r) => ({ id: r.id.slice(0, 8), q: r.q.slice(0, 40), agency: r.agency.slice(0, 20), status: r.planStatus, legacy: r.legacy, canon: r.canonical, '+': r.gained, '-': r.lost })));
  for (const r of out.filter((x: any) => x.error || x.skipped)) console.log(r); // eslint-disable-line @typescript-eslint/no-explicit-any
}

main().catch((e) => { console.error(e); process.exit(1); });
