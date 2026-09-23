/**
 * READ-ONLY blast-radius gate for migrating saved searches onto Canonical Discovery.
 *
 *   npx tsx --env-file=.env.local scripts/discovery-saved-search-blast.ts [--json out.json] [--all]
 *
 * Replays EVERY alerting saved search under today's semantics and the canonical plan. Nothing is
 * written; no email is sent.
 *
 *   open      — old: exactly cron/saved-search-alerts (parseMapFilters(saved) + postedDays 30 +
 *               profile scope). canonical: the saved NON-query filters (minus agency, which now goes
 *               through the canonical whole-word buyer path) + the plan built from q/agency.
 *   forecast  — only when the search alerts on forecasts (same rule as the cron). Canonical applies
 *               the shared default (current + future fiscal years) — a DECIDED policy change.
 *   recompete — not alerted; reported for searches whose map view shows it (Maps adopts 18 months).
 *
 * ⚠️ Profile scope: today a typed query DISABLES profile NAICS/state scope (`!isActiveSearch`).
 * The canonical replay keeps that: profile scope only when the plan carries no query.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseMapFilters, applyMapFilters, naicsMatchConds } from '@/lib/opportunities/map-filters';
import { applyForecastFilters } from '@/lib/opportunities/map-data';
import { resolveQueryIntent, setAsideOrExpr, pscToNaicsCodes } from '@/lib/search/query-intent';
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';
import { multiAgency } from '@/lib/opportunities/agency-match';
import {
  buildDiscoveryPlan, contextFor, applyOps, applyOpenPlan, applyForecastPlan,
  SAVED_SEARCH_POLICY, MAPS_POLICY, type DiscoveryPlan,
} from '@/lib/discovery';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
const includeAll = args.includes('--all');
const ctx = contextFor();

/** Stable, one-way label — never an email or domain in output that may be committed. */
const mask = (e: string) => `user-${createHash('sha256').update(String(e || '').toLowerCase()).digest('hex').slice(0, 8)}`;
/** Saved filters that already define a market on their own (so an exclusion-only q is anchored). */
const SCOPE_KEYS = ['naics', 'psc', 'agency', 'state', 'strategy', 'setAside', 'setAsideMulti', 'noticeMulti', 'noticeType', 'subAgency', 'fullOpen', 'sapBuyer', 'fsc'];

async function ids(table: string, idCol: string, build: (q: any) => any, cap = 20000): Promise<Set<string> | null> {
  const out = new Set<string>();
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await build(db.from(table).select(idCol)).order(idCol).range(from, from + 999);
    if (error) { console.error(`[${table}] ${error.message}`); return null; }
    for (const r of data || []) out.add(String((r as any)[idCol]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function count(table: string, build: (q: any) => any): Promise<number | null> {
  const { count: c, error } = await build(db.from(table).select('*', { count: 'exact', head: true }));
  if (error) { console.error(`[${table}] ${error.message}`); return null; }
  return c ?? null;
}
async function titles(list: string[]): Promise<string[]> {
  if (!list.length) return [];
  const { data } = await db.from('sam_opportunities').select('title').in('notice_id', list.slice(0, 3)).limit(3);
  return (data || []).map((r: any) => String(r.title).slice(0, 60));
}

/** Recompete as /api/app/recompete-map interprets q today (@2574fe8d) — measurement copy. */
function mapsOldRecompete(q: string, naics: string, state: string) {
  let n = naics; let kw = ''; let sa = '';
  if (q && !n) {
    const it = resolveQueryIntent(q);
    if (it.kind === 'setAside' && it.setAside) sa = setAsideOrExpr(it.setAside, { textCols: ['set_aside_type'] });
    else if (it.kind === 'naics' && it.naics?.length) n = it.naics.join(',');
    else if (it.kind === 'psc' && it.psc) { const xw = pscToNaicsCodes(it.psc); if (xw.length) n = xw.join(','); else kw = it.psc; }
    else { const t = termOfArtNaicsCodes(q); if (t?.length) n = t.join(','); else kw = q; }
  }
  return (x: any) => {
    let r = x.is('quality_flag', null).gte('period_of_performance_current_end', ctx.today);
    if (n) r = r.or(naicsMatchConds(n.split(',')).join(','));
    if (sa) r = r.or(sa);
    if (kw) { const e = kw.replace(/[%,()]/g, ' '); r = r.or(`incumbent_name.ilike.%${e}%,naics_description.ilike.%${e}%,awarding_agency.ilike.%${e}%`); }
    if (state) r = r.or(state.split(',').map((s) => `place_of_performance_state.eq.${s.trim()}`).join(','));
    return r;
  };
}

function material(o: number | null, n: number | null): boolean {
  if (o == null || n == null) return true; // unknown is never "fine"
  if (o === n) return false;
  if (o === 0 || n === 0) return true;
  return Math.abs(n - o) >= 5 && Math.abs(n - o) / Math.max(o, 1) >= 0.5;
}

(async () => {
  // Paged: PostgREST caps an unranged select at 1,000 rows silently — a blast radius must be the
  // WHOLE population of alerting searches, never its first page.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('saved_searches').select('id,user_email,name,mode,filters,alert_frequency')
      .in('alert_frequency', ['daily', 'weekly']).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const out: any[] = [];
  for (const s of rows || []) {
    const f = (s.filters || {}) as Record<string, any>;
    const q = String(f.q || '').trim();
    if (!q && !includeAll) continue;
    const get = (k: string) => (f[k] == null ? null : Array.isArray(f[k]) ? f[k].join(',') : String(f[k]));

    let profileOpts: { profileNaics?: string[]; profileStates?: string[] } | undefined;
    if (f.scope === 'profile') {
      const { data: prof, error: pe } = await db.from('user_notification_settings').select('naics_codes, location_states').eq('user_email', s.user_email).limit(1).maybeSingle();
      if (pe) { out.push({ id: s.id, user: mask(s.user_email), q, error: `profile read failed: ${pe.message}` }); continue; }
      profileOpts = { profileNaics: (prof?.naics_codes as string[]) || [], profileStates: (prof?.location_states as string[]) || [] };
    }
    const hasSurfaceScope = SCOPE_KEYS.some((k) => { const v = f[k]; return Array.isArray(v) ? v.length > 0 : !!v; }) || f.scope === 'profile';
    // Canonical agency input exactly as the Maps adapters build it (Phase C): a saved multi-select ("A|B") is a
    // list of DISTINCT buyers, ORed — never one combined buyer that must match every word at once.
    const agencies = multiAgency(get('agency') ?? '');
    const canonAgency = agencies.length > 1 ? agencies : agencies[0] ?? null;
    const plan: DiscoveryPlan = buildDiscoveryPlan({ query: q, agency: canonAgency, hasSurfaceScope }, SAVED_SEARCH_POLICY, ctx);

    // OPEN — old = the cron exactly; canonical = saved non-query/non-agency filters + plan.
    const fOld = parseMapFilters(get, profileOpts); fOld.postedDays = fOld.postedDays || 30;
    const fSurface = parseMapFilters((k) => (k === 'q' || k === 'search' || k === 'agency' ? null : get(k)), q ? undefined : profileOpts); fSurface.postedDays = fSurface.postedDays || 30;
    const [oo, no] = await Promise.all([
      ids('sam_opportunities', 'notice_id', (x) => applyMapFilters(x, fOld)),
      ids('sam_opportunities', 'notice_id', (x) => applyOpenPlan(applyMapFilters(x, fSurface), plan)),
    ]);
    const onlyOld = oo && no ? [...oo].filter((i) => !no.has(i)) : [];
    const onlyNew = oo && no ? [...no].filter((i) => !oo.has(i)) : [];

    // FORECAST
    const h = f.horizons && typeof f.horizons === 'object' ? f.horizons : null;
    const wantsForecast = h ? h.forecast === true : s.mode === 'forecast';
    let fc: any = null;
    if (wantsForecast) {
      const fo = await count('agency_forecasts', (x) => applyForecastFilters(x, { q: q || null, naics: get('naics'), agency: get('agency'), state: get('state') }));
      const fn = await count('agency_forecasts', (x) => applyForecastPlan(applyForecastFilters(x, { q: null, naics: get('naics'), agency: null, state: get('state') }), plan));
      // Separate the decided FY policy from meaning: old semantics + the canonical FY clause alone.
      const fyOp = buildDiscoveryPlan({ query: '' }, SAVED_SEARCH_POLICY, ctx).horizons.forecast.ops
        .find((o: any) => o.op === 'or' && String(o.expr).startsWith('fiscal_year.is.null,')) as any;
      const foFy = fyOp ? await count('agency_forecasts', (x) => applyForecastFilters(x, { q: q || null, naics: get('naics'), agency: get('agency'), state: get('state') }).or(fyOp.expr)) : null;
      const coverage = plan.horizons.forecast.coverage;
      fc = {
        old: fo, old_fy: foFy, canonical: fn, coverage,
        // coverage 'unestablished' = we hold no forecasts from this publisher: the canonical answer is
        // UNAVAILABLE, never a count (MCP reports that horizon unavailable).
        canonical_reading: coverage === 'unestablished' ? 'unavailable' : fn,
        fy_policy_delta: fo != null && foFy != null ? foFy - fo : null,
        semantic_delta: foFy != null && fn != null ? fn - foFy : null,
        delta: fo != null && fn != null ? fn - fo : null, material: material(fo, fn),
      };
    }

    // RECOMPETE (map view)
    let rc: any = null;
    if (h?.recompete === true && q) {
      const st = get('state') || '';
      const ro = await count('recompete_opportunities', mapsOldRecompete(q, get('naics') || '', st));
      const rp = buildDiscoveryPlan({ query: q, naics: get('naics'), state: st || null, agency: canonAgency, hasSurfaceScope }, MAPS_POLICY, ctx);
      const rn = await count('recompete_opportunities', (x) => applyOps(x, rp.horizons.recompete.ops));
      rc = { old: ro, canonical: rn, via: rp.horizons.recompete.via, material: material(ro, rn) };
    }

    const bits: string[] = [];
    if (plan.status !== 'ok') bits.push(plan.status);
    if (plan.buyers.length) bits.push(`agency→${plan.buyers.map((b) => b.requested).join('/')}`);
    if (plan.states.length) bits.push(`state→${plan.states.join('/')}`);
    if (plan.setAsides.length) bits.push(`set-aside→${plan.setAsides.join('/')}`);
    if (plan.naics.length) bits.push(`naics→${plan.naics.join('/')}`);
    for (const a of plan.matcher.alternatives) bits.push(`${a.eligibility}(${a.eligible.map((c) => c.label).join('|')})${a.rankOnly.length ? ` rank(${a.rankOnly.map((c) => c.label).join('|')})` : ''}`);
    if (plan.matcher.excluded.length) bits.push(`exclude ${plan.matcher.excluded.map((c) => c.label).join('|')}`);
    if (plan.intent.stripped.length) bits.push(`stripped ${plan.intent.stripped.join('/')}`);

    out.push({
      id: s.id, user: mask(s.user_email), name: s.name, q, scope: f.scope || null,
      open: { old: oo?.size ?? null, canonical: no?.size ?? null, delta: oo && no ? no.size - oo.size : null, material: material(oo?.size ?? null, no?.size ?? null),
        old_only_sample: await titles(onlyOld), new_only_sample: await titles(onlyNew) },
      forecast: fc, recompete_map: rc, reason: q ? bits.join(' · ') : 'no query — non-query filters unchanged',
    });
    console.error(`done ${s.id}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  const n = (x: any) => (x == null ? 'unknown' : String(x));
  console.log('| search | user | q | Open old → canonical (Δ) | Forecast old → canonical (FY-policy Δ, meaning Δ) | Recompete map old → canonical | material | canonical reading |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of out) {
    if (r.error) { console.log(`| ${String(r.id).slice(0, 8)} | ${r.user} | ${r.q} | — | — | — | ⚠️ | ${r.error} |`); continue; }
    const mat = [r.open.material && 'open', r.forecast?.material && 'forecast', r.recompete_map?.material && 'recompete-map'].filter(Boolean).join(', ');
    console.log(`| ${String(r.id).slice(0, 8)} | ${r.user} | ${r.q || '—'} | ${n(r.open.old)} → ${n(r.open.canonical)} (${n(r.open.delta)}) | ${r.forecast ? `${n(r.forecast.old)} → ${r.forecast.coverage === 'unestablished' ? `UNAVAILABLE (${n(r.forecast.canonical)} held)` : n(r.forecast.canonical)} (FY ${n(r.forecast.fy_policy_delta)}, meaning ${n(r.forecast.semantic_delta)})` : 'n/a'} | ${r.recompete_map ? `${n(r.recompete_map.old)} → ${n(r.recompete_map.canonical)} [${r.recompete_map.via}]` : 'n/a'} | ${mat ? '⚠️ ' + mat : 'no'} | ${r.reason} |`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
