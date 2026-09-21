/**
 * The Procurement Observatory — the Mindy Institute's continuous research engine.
 *
 * THE REFRAME (Eric): this is NOT an annual report. It's a LIVING OBSERVATORY (the Gartner / Bloomberg
 * model): a research engine that measures the public procurement market continuously, and every
 * publication — daily brief, weekly update, monthly benchmark, white paper, the annual Procurement
 * Intelligence Report, press — is a DOWNSTREAM SNAPSHOT of what this engine already knows. One engine,
 * many outputs. The annual report becomes, conceptually, `SELECT * FROM observatory WHERE year=2026`.
 *
 * So the unit of the system is the METRIC, not the report. Each metric carries:
 *   • value + provenance (the real query it came from — every figure traceable, zero fabrication)
 *   • MATURITY — where the science actually is, so the team knows what's publishable:
 *       🟢 production  — enough real data to publish now (thousands of rows, public/structured)
 *       🟡 beta        — real signal, needs validation before a public claim (behavioral, hundreds)
 *       🟡 collecting  — accruing but not yet enough to report (tens of users, or just-instrumented)
 *       🔴 research    — defined, no data yet (needs instrumentation we don't have)
 *   • outputs — which publications this metric is eligible to flow into once mature
 *       (annual | white_paper | press | daily | weekly | monthly)
 *
 * HONESTY (Bug Prevention Rule #11): every query binds { data/count, error } and surfaces it. A failed
 * metric is `maturity:'error'` with the message, never a silent 0. A metric can only ever report a
 * figure it measured; a gap is disclosed (maturity + note), never filled.
 *
 * ⚠️ READ-ONLY. Only SELECTs. Does NOT write any table.
 */
import { PG_MAX_ROWS } from '@/lib/paged-read';
import type { SupabaseClient } from '@supabase/supabase-js';
import { methodologyFor, type Methodology } from './observatory-methodology';
import { computeCompetitionDepth } from './competition-depth';

export type Maturity = 'production' | 'beta' | 'collecting' | 'research' | 'error';
export type OutputChannel = 'annual' | 'white_paper' | 'press' | 'daily' | 'weekly' | 'monthly';

export interface ObservatoryMetric {
  key: string;
  title: string;
  domain: 'supply' | 'behavior' | 'competition';   // which lens of the market this observes
  maturity: Maturity;
  source: string;                                    // the real query / table it came from
  n: number;                                         // sample size / population behind the number
  findings: { label: string; value: string }[];     // the raw figures
  outputs: OutputChannel[];                          // publications this metric is eligible for
  note: string;
  error: string | null;
  // ── citable-object layer (the Constitution) — attached from the methodology registry ──
  id: string | null;                                 // OBS-### permanent citation key (null if not yet registered)
  standard: Methodology | null;                      // the full "View Standard" record
}

// The builders return the metric WITHOUT its citable-object fields; attachStandard() stamps them
// centrally from the registry so every metric is completed one way (no per-builder drift).
type MetricCore = Omit<ObservatoryMetric, 'id' | 'standard'>;

export interface Observatory {
  generatedAtNote: string;   // the caller stamps the real time (Date.now() is unavailable in some ctx)
  corpus: { events: number | null; users: number | null; firstDay: string | null; lastDay: string | null; error: string | null };
  metrics: ObservatoryMetric[];
}

// ── helpers ─────────────────────────────────────────────────────────────────
const errMetric = (m: Pick<ObservatoryMetric, 'key' | 'title' | 'domain' | 'source' | 'outputs'>, error: unknown): MetricCore => ({
  ...m, maturity: 'error', n: 0, findings: [], note: 'query failed — surfaced, not hidden', error: String((error as { message?: string })?.message || error),
});

// Attach the permanent OBS-### id + full "View Standard" record from the methodology registry.
// The id maps FROM the metric key (the concept) so a rename/re-domain never breaks a citation.
function attachStandard(m: MetricCore): ObservatoryMetric {
  const std = methodologyFor(m.key);
  return { ...m, id: std?.id ?? null, standard: std };
}

// Exact head-count (count≠null contract): returns { count, error }, never coalesced to 0.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function headCount(sb: SupabaseClient, table: string, build?: (q: any) => any) {
  let q = sb.from(table).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  return { count: (count ?? null) as number | null, error };
}

// ── corpus overview ──────────────────────────────────────────────────────────
async function corpus(sb: SupabaseClient): Promise<Observatory['corpus']> {
  // Aggregated in the DATABASE. Previously this pulled rows and counted distinct
  // users with a JS Set — but PostgREST caps every response at 1,000 rows and
  // reports success, so it published 23 users against an actual 2,787 (-99.2%)
  // and a lastDay that was a day stale. A distinct count must never be derived
  // from a row pull; there is nothing to truncate in a one-row aggregate.
  const { data, error } = await sb.rpc('observatory_corpus');
  if (error) return { events: null, users: null, firstDay: null, lastDay: null, error: error.message };
  const r = (Array.isArray(data) ? data[0] : data) as
    { events: number; users: number; first_day: string | null; last_day: string | null } | undefined;
  if (!r) return { events: null, users: null, firstDay: null, lastDay: null, error: 'corpus aggregate returned no row' };
  return {
    events: Number(r.events),
    users: Number(r.users),
    firstDay: r.first_day,
    lastDay: r.last_day,
    error: null,
  };
}

// ── SUPPLY domain (public/structured data — production-grade) ─────────────────

// Small-business participation — the OSDBU headline. Exact head-counts, never a sampled ratio.
async function participation(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'sb_participation', title: 'Small-business participation', domain: 'supply' as const,
    source: 'sam_opportunities.set_aside_code (exact head-counts)', outputs: ['annual', 'white_paper', 'press', 'monthly'] as OutputChannel[] };
  const active = await headCount(sb, 'sam_opportunities', (q) => q.eq('active', true));
  if (active.error) return errMetric(base, active.error);
  const withSA = await headCount(sb, 'sam_opportunities', (q) => q.eq('active', true).not('set_aside_code', 'is', null).neq('set_aside_code', '').neq('set_aside_code', 'NONE'));
  if (withSA.error) return errMetric(base, withSA.error);
  const total = active.count, sa = withSA.count;
  const pct = total && total > 0 ? Math.round(((sa ?? 0) / total) * 1000) / 10 : null;
  return {
    ...base, maturity: 'production', n: total ?? 0,
    findings: [
      { label: 'active solicitations', value: (total ?? 0).toLocaleString() },
      { label: 'carrying a small-biz set-aside', value: `${(sa ?? 0).toLocaleString()} (${pct == null ? 'unknown' : pct + '%'})` },
    ],
    note: 'Full & open (NONE/blank) excluded. YoY delta unlocks once the observatory snapshot table lands (Phase 2b).',
    error: null,
  };
}

// Awarded set-aside mix — the award record (51k+ rows). Exact per-category head-counts.
async function awardedMix(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'awarded_setaside_mix', title: 'Awarded set-aside mix', domain: 'supply' as const,
    source: 'recompete_opportunities.set_aside_enriched (exact per-category head-counts)', outputs: ['annual', 'white_paper', 'monthly'] as OutputChannel[] };
  const LABELS = ['Full & Open', 'SB-Total', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'Indian-SB', 'SB-Partial', 'VOSB', 'EDWOSB'];
  const total = await headCount(sb, 'recompete_opportunities', (q) => q.not('set_aside_enriched', 'is', null));
  if (total.error) return errMetric(base, total.error);
  const N = total.count;
  const counts = await Promise.all(LABELS.map(async (lbl) => {
    const c = await headCount(sb, 'recompete_opportunities', (q) => q.eq('set_aside_enriched', lbl));
    return { lbl, count: c.error ? null : c.count, error: c.error };
  }));
  const anyErr = counts.find((c) => c.error);
  if (anyErr) return errMetric(base, anyErr.error);
  const ranked = counts.filter((c) => (c.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 8);
  return {
    ...base, maturity: 'production', n: N ?? 0,
    findings: ranked.map((c) => ({ label: c.lbl, value: `${(c.count ?? 0).toLocaleString()} (${N && N > 0 ? Math.round(((c.count ?? 0) / N) * 1000) / 10 : 'unknown'}%)` })),
    note: `Share of the ${(N ?? 0).toLocaleString()}-row enriched award record — exact head-counts, not a sample.`,
    error: null,
  };
}

// ── BEHAVIOR domain (the proprietary moat — behavioral, real but early) ───────

// Return behavior — the habit curve, over the WHOLE population (server-side).
async function returnBehavior(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'return_behavior', title: 'Return behavior (the habit curve)', domain: 'behavior' as const,
    source: 'user_engagement — distinct active days per user (aggregated in-database)', outputs: ['annual', 'white_paper', 'press'] as OutputChannel[] };
  const { data, error } = await sb.rpc('observatory_return_behavior');
  if (error) return errMetric(base, error);
  const r = (Array.isArray(data) ? data[0] : data) as
    { users: number; returners: number; median_days: number | null; mean_days: number | null } | undefined;
  if (!r) return errMetric(base, { message: 'return-behavior aggregate returned no row' });

  const nUsers = Number(r.users);
  const returners = Number(r.returners);
  return {
    ...base, maturity: nUsers >= 500 ? 'beta' : 'collecting', n: nUsers,
    findings: [
      { label: 'distinct users observed', value: nUsers.toLocaleString() },
      { label: 'returned on ≥2 distinct days', value: `${returners.toLocaleString()} (${nUsers ? Math.round((returners / nUsers) * 1000) / 10 : 'unknown'}%)` },
      { label: 'median active days / user', value: r.median_days == null ? 'unknown' : String(r.median_days) },
      { label: 'mean active days / user', value: r.mean_days == null ? 'unknown' : String(r.mean_days) },
    ],
    note: `The complete ${nUsers.toLocaleString()}-user population, not a sample. Beta: needs validation (define "active", control for internal accounts) before a public claim.`,
    error: null,
  };
}

// Where attention concentrates (by agency) — full population, ranked in-database.
async function attentionByAgency(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'attention_by_agency', title: 'Where contractor attention concentrates', domain: 'behavior' as const,
    source: "user_engagement metadata->>'agency' (source_feed + market_intelligence, aggregated in-database)", outputs: ['annual', 'white_paper', 'press', 'weekly'] as OutputChannel[] };
  const { data, error } = await sb.rpc('observatory_attention_by_agency', { p_limit: 8 });
  if (error) return errMetric(base, error);
  const rows = (data ?? []) as { agency: string; views: number; users: number; total_users: number; total_views: number }[];
  if (rows.length === 0) {
    return { ...base, maturity: 'collecting', n: 0, findings: [],
      note: 'No agency-tagged engagement yet.', error: null };
  }
  const nUsers = Number(rows[0].total_users);
  const nViews = Number(rows[0].total_views);
  return {
    ...base, maturity: 'beta', n: nUsers,
    findings: rows.map((r) => ({ label: r.agency, value: `${Number(r.views).toLocaleString()} views · ${Number(r.users)} users` })),
    // No longer "a N-event sample (PostgREST 1000-row cap)" — this is every
    // tagged event. The caveat that remains is a real one about the population.
    note: `Every one of the ${nViews.toLocaleString()} agency-tagged events, across ${nUsers} users. Beta because that user base is small and self-selected, not because the data is sampled.`,
    error: null,
  };
}

// Discovery index: browse-without-pursue — every source_feed event, in-database.
async function discoveryIndex(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'discovery_index', title: 'Discovery index (browse-without-pursue)', domain: 'behavior' as const,
    source: "user_engagement source_feed metadata->>'action' (aggregated in-database)", outputs: ['annual', 'white_paper'] as OutputChannel[] };
  const { data, error } = await sb.rpc('observatory_discovery_index');
  if (error) return errMetric(base, error);
  const r = (Array.isArray(data) ? data[0] : data) as
    { opens: number; pursues: number; open_users: number; pursue_users: number; engaged_users: number } | undefined;
  if (!r) return errMetric(base, { message: 'discovery-index aggregate returned no row' });

  const opens = Number(r.opens), pursues = Number(r.pursues);
  const engaged = opens + pursues;
  const nUsers = Number(r.engaged_users);
  return {
    ...base, maturity: 'collecting', n: nUsers,
    findings: [
      { label: 'opened details', value: opens.toLocaleString() },
      { label: 'saved to pipeline', value: pursues.toLocaleString() },
      { label: 'browse-without-pursue', value: engaged ? `${Math.round((opens / engaged) * 1000) / 10}%` : 'unknown' },
      { label: 'users who did either', value: nUsers.toLocaleString() },
    ],
    note: `Complete count across every source_feed interaction. Collecting: ${nUsers} engaged users is too few to generalise from — a population limit, not a sampling one.`,
    error: null,
  };
}

// Average decision time — INSTRUMENTATION DEFECT, disclosed rather than published.
async function decisionTime(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'decision_time', title: 'Average decision time (discovery → pursuit)', domain: 'behavior' as const,
    source: 'user_pipeline.discovered_at → created_at (#122)', outputs: ['annual', 'white_paper', 'press'] as OutputChannel[] };
  const { data, error } = await sb.rpc('observatory_decision_time');
  if (error) {
    if ((error as { code?: string }).code === '42703') {
      return { ...base, maturity: 'research', n: 0, findings: [],
        note: 'Research — discovered_at column not yet migrated.', error: null };
    }
    return errMetric(base, error);
  }
  const r = (Array.isArray(data) ? data[0] : data) as
    { n: number; median_hours: number | null; mean_hours: number | null; same_day: number } | undefined;
  if (!r || Number(r.n) === 0) {
    return { ...base, maturity: 'collecting', n: 0, findings: [],
      note: 'Collecting — column live, no stamped saves yet.', error: null };
  }

  const n = Number(r.n);
  const medianHours = r.median_hours == null ? null : Number(r.median_hours);

  // THE REAL PROBLEM, and it is not truncation.
  //
  // Fixing the 1,000-row cap made this metric readable for the first time — and
  // what it reveals is that the instrument is broken. 98.7% of stamped rows have
  // created_at - discovered_at under ONE SECOND. `discovered_at` is being written
  // at save time, not at the moment of discovery, so the column measures the
  // round-trip of a single click rather than a decision.
  //
  // A near-zero median here is NOT the finding "contractors decide instantly".
  // It is the finding "we are not capturing discovery". Publishing the former
  // would be worse than publishing nothing, so this refuses to report a figure
  // and says what is actually wrong.
  const degenerate = medianHours !== null && medianHours < 0.017; // < ~1 minute
  if (degenerate) {
    return {
      ...base, maturity: 'research', n,
      findings: [
        { label: 'rows carrying a discovered_at stamp', value: n.toLocaleString() },
        { label: 'stamped under one second apart', value: `${Number(r.same_day).toLocaleString()} of ${n.toLocaleString()}` },
      ],
      note:
        'NOT PUBLISHABLE — instrumentation defect. Nearly every stamped row shows a ' +
        'sub-second gap, so discovered_at is being written at save time rather than at ' +
        'discovery. The column currently measures one click, not a decision. Any ' +
        '"average decision time" derived from it would be an artifact. Needs a real ' +
        'discovery event (first impression of the opportunity) before this can report.',
      error: null,
    };
  }

  return {
    ...base, maturity: 'collecting', n,
    findings: [
      { label: 'pursuits with a discovered_at stamp', value: n.toLocaleString() },
      { label: 'median hours discovery → pursuit', value: medianHours == null ? 'unknown' : String(medianHours) },
      { label: 'mean hours', value: r.mean_hours == null ? 'unknown' : String(r.mean_hours) },
      { label: 'saved within 24h', value: `${Number(r.same_day).toLocaleString()} (${Math.round((Number(r.same_day) / n) * 1000) / 10}%)` },
    ],
    note: `Complete count over all ${n.toLocaleString()} stamped rows (aggregated in-database, not a sample).`,
    error: null,
  };
}

// ── COMPETITION domain ────────────────────────────────────────────────────────
// OBS-009 Competition depth (BETA). Grounded via USASpending per-award detail (NOT FPDS — retired
// Feb 24 2026). The Observatory board is a fleet view, but this metric is computed per-BUYER, so the
// tile shows a live REFERENCE-BUYER sample (the largest buyer, DoD), labeled as illustrative — the
// honest way to show "the standard is real and grounded" without implying a single national number.
async function competitionDepth(): Promise<MetricCore> {
  const base = {
    key: 'competition_depth', title: 'Competition depth (avg bidders + single-bid rate)', domain: 'competition' as const,
    source: 'USASpending.gov per-award competition detail (number of offers received) — sampled per buyer',
    outputs: ['white_paper', 'annual', 'press'] as MetricCore['outputs'],
  };
  try {
    // Reference buyer = the largest, so the illustrative sample is meaningful. Beta by design.
    const d = await computeCompetitionDepth('DEPT OF DEFENSE');
    // Label the buyer from resolvedAgency, falling back to the known reference name — never render
    // "undefined" (a pre-`resolvedAgency` cache entry can lack the field until the 24h TTL rolls).
    const buyer = d.resolvedAgency ?? 'Department of Defense';
    if (!d.grounded || d.avgBidders == null || d.singleBidPct == null) {
      return {
        ...base, maturity: 'beta', n: d.sampledWithData, findings: [],
        note: `Beta — standard defined + grounded (USASpending), but the reference sample for ${buyer} returned too few awards with an offer count to show an illustrative figure right now. Computed per-buyer on demand.`,
        error: null,
      };
    }
    return {
      ...base, maturity: 'beta', n: d.sampledWithData,
      findings: [
        { label: `Avg bidders (${buyer}, sample)`, value: d.avgBidders.toFixed(1) },
        { label: 'Single-bid rate (illustrative)', value: `${d.singleBidPct.toFixed(0)}%` },
      ],
      note: `Beta — a real, grounded standard (USASpending per-award offers). Shown here as an illustrative ${d.sampledWithData}-award sample for ${buyer}; the published metric is computed per-market on demand. Graduates to Production on a larger, validated sample with a stated confidence interval. Feeds OBS-008.`,
      error: null,
    };
  } catch (e) {
    return errMetric(base, e);
  }
}

// ── COMPETITION domain (research — a composite index we haven't built yet) ────
function procurementHealthScore(): MetricCore {
  return {
    key: 'procurement_health_score', title: 'Procurement Health Score (composite index)', domain: 'competition',
    maturity: 'research', source: 'a composite of participation + competition depth + supplier churn — not yet defined',
    n: 0, findings: [], outputs: ['annual', 'white_paper', 'press'],
    note: 'Research — the flagship index. A single defensible score per market once the component metrics reach production. Defined here so the team can see where the science is headed.',
    error: null,
  };
}

// Sharing / flywheel — collecting: grows with the PayPal-flywheel feature.
async function sharing(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'sharing_flywheel', title: 'Sharing / referral (the flywheel)', domain: 'behavior' as const,
    source: 'opportunity_shares', outputs: ['annual', 'white_paper'] as OutputChannel[] };
  const total = await headCount(sb, 'opportunity_shares');
  if (total.error) return errMetric(base, total.error);
  return {
    ...base, maturity: 'collecting', n: total.count ?? 0,
    findings: [{ label: 'opportunities shared contractor-to-contractor', value: (total.count ?? 0).toLocaleString() }],
    note: 'Collecting — small today; grows with the flywheel. Proves opportunities spread peer-to-peer.',
    error: null,
  };
}

// ── the engine ────────────────────────────────────────────────────────────────
/**
 * Run the whole Observatory. `nowIso` is passed by the caller (Date.now() is unavailable in some
 * execution contexts). Best-effort per metric: one failure yields a maturity:'error' metric, never
 * aborts the board.
 */
export async function computeObservatory(sb: SupabaseClient, nowIso: string): Promise<Observatory> {
  const [corpusRes, ...metrics] = await Promise.all([
    corpus(sb),
    participation(sb),
    awardedMix(sb),
    returnBehavior(sb),
    attentionByAgency(sb),
    discoveryIndex(sb),
    sharing(sb),
    decisionTime(sb),
    competitionDepth(),
    Promise.resolve(procurementHealthScore()),
  ]);
  // Stamp every metric with its permanent OBS-### id + full standard from the registry.
  const stamped = (metrics as MetricCore[]).map(attachStandard);
  return { generatedAtNote: nowIso, corpus: corpusRes, metrics: stamped };
}

/** Maturity display order + labels — the "where's the science" legend. */
export const MATURITY_META: Record<Maturity, { dot: string; label: string; blurb: string; order: number }> = {
  production: { dot: '🟢', label: 'Production', blurb: 'publishable now', order: 0 },
  beta:       { dot: '🟡', label: 'Beta', blurb: 'real signal, needs validation', order: 1 },
  collecting: { dot: '🟡', label: 'Collecting', blurb: 'accruing, not yet enough', order: 2 },
  research:   { dot: '🔴', label: 'Research', blurb: 'defined, no data yet', order: 3 },
  error:      { dot: '⚠️', label: 'Error', blurb: 'query failed — surfaced', order: 4 },
};
