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
  const total = await headCount(sb, 'user_engagement');
  if (total.error) return { events: null, users: null, firstDay: null, lastDay: null, error: total.error.message };
  // distinct users + span from a bounded pull (rank/lifetime only, not an exact-count claim)
  const { data, error } = await sb.from('user_engagement').select('user_email, created_at').limit(200000);
  if (error) return { events: total.count, users: null, firstDay: null, lastDay: null, error: error.message };
  const rows = data || [];
  // TRUNCATION GUARD (2026-08-24). PostgREST caps every response at 1,000 rows;
  // .limit(200000) does not raise that ceiling, it just returns 1,000 with no
  // error. Deriving distinct users from those rows reported 23 users against an
  // actual 2,579 (-99.1%), and a lastDay one day stale. Suppress rather than
  // publish a wrong number. Full repair: tasks/OBSERVATORY-TRUNCATION-DEFECT.md
  const truncated = rows.length >= PG_MAX_ROWS;
  if (truncated) {
    return {
      events: total.count, users: null, firstDay: null, lastDay: null,
      error: `distinct users and date span suppressed: the source read hit the ${PG_MAX_ROWS}-row PostgREST cap, so any figure derived from it would understate the corpus. Events is an exact head-count and remains valid.`,
    };
  }
  const users = new Set(rows.map((r) => r.user_email).filter(Boolean)).size;
  const days = rows.map((r) => String(r.created_at).slice(0, 10)).filter(Boolean).sort();
  return { events: total.count, users, firstDay: days[0] || null, lastDay: days[days.length - 1] || null, error: null };
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

// Return behavior — the habit curve. Whole distinct-user population (1,486); a real cohort → beta.
async function returnBehavior(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'return_behavior', title: 'Return behavior (the habit curve)', domain: 'behavior' as const,
    source: 'user_engagement — distinct active days per user', outputs: ['annual', 'white_paper', 'press'] as OutputChannel[] };
  const { data, error } = await sb.from('user_engagement').select('user_email, created_at').limit(200000);
  if (error) return errMetric(base, error);
  const truncatedRead = (data || []).length >= PG_MAX_ROWS;
  const byUser = new Map<string, Set<string>>();
  for (const r of data || []) {
    if (!r.user_email) continue;
    const day = String(r.created_at).slice(0, 10);
    (byUser.get(r.user_email) || byUser.set(r.user_email, new Set()).get(r.user_email)!).add(day);
  }
  const users = [...byUser.values()];
  const nUsers = users.length;
  const daysArr = users.map((s) => s.size).sort((a, b) => a - b);
  const median = nUsers ? daysArr[Math.floor(nUsers / 2)] : null;
  const returners = daysArr.filter((d) => d >= 2).length;
  return {
    // Truncated reads cannot support a cohort claim, however large nUsers looks.
    ...base, maturity: truncatedRead ? 'collecting' : (nUsers >= 500 ? 'beta' : 'collecting'), n: nUsers,
    findings: [
      { label: 'distinct users observed', value: nUsers.toLocaleString() },
      { label: 'returned on ≥2 distinct days', value: `${returners.toLocaleString()} (${nUsers ? Math.round((returners / nUsers) * 1000) / 10 : 'unknown'}%)` },
      { label: 'median active days / user', value: median == null ? 'unknown' : String(median) },
    ],
    note: truncatedRead
      ? `NOT PUBLISHABLE — the source read hit the ${PG_MAX_ROWS}-row PostgREST cap, so this curve is built from a non-random prefix of ${(data || []).length.toLocaleString()} of ~162,000 events. Directional only. See tasks/OBSERVATORY-TRUNCATION-DEFECT.md.`
      : `A real ${nUsers.toLocaleString()}-user cohort. Beta: needs validation (define "active", control for internal accounts) before a public claim.`,
    error: null,
  };
}

// Where attention concentrates (by agency) — beta: agency-tagged views across the user base.
async function attentionByAgency(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'attention_by_agency', title: 'Where contractor attention concentrates', domain: 'behavior' as const,
    source: "user_engagement metadata->>'agency' (source_feed + market_intelligence)", outputs: ['annual', 'white_paper', 'press', 'weekly'] as OutputChannel[] };
  const { data, error } = await sb.from('user_engagement').select('user_email, metadata')
    .in('event_source', ['source_feed', 'market_intelligence']).eq('event_type', 'tool_use').not('metadata->>agency', 'is', null).limit(60000);
  if (error) return errMetric(base, error);
  const rows = data || [];
  const byAgency = new Map<string, { views: number; users: Set<string> }>();
  for (const r of rows) {
    const ag = (r.metadata && (r.metadata as { agency?: string }).agency ? String((r.metadata as { agency?: string }).agency) : '').trim();
    if (!ag) continue;
    const a = byAgency.get(ag) || byAgency.set(ag, { views: 0, users: new Set() }).get(ag)!;
    a.views += 1; if (r.user_email) a.users.add(r.user_email);
  }
  const nUsers = new Set(rows.map((r) => r.user_email).filter(Boolean)).size;
  const ranked = [...byAgency.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 8);
  return {
    ...base, maturity: 'beta', n: nUsers,
    findings: ranked.map(([ag, a]) => ({ label: ag, value: `${a.views.toLocaleString()} views · ${a.users.size} users` })),
    note: `Rank order from a ${rows.length.toLocaleString()}-event sample (PostgREST 1000-row cap) across ${nUsers} users. Directional.`,
    error: null,
  };
}

// Discovery index: browse-without-pursue — collecting: real but concentrated in a handful of users.
async function discoveryIndex(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'discovery_index', title: 'Discovery index (browse-without-pursue)', domain: 'behavior' as const,
    source: "user_engagement source_feed metadata->>'action'", outputs: ['annual', 'white_paper'] as OutputChannel[] };
  const { data, error } = await sb.from('user_engagement').select('user_email, metadata')
    .eq('event_source', 'source_feed').eq('event_type', 'tool_use').limit(60000);
  if (error) return errMetric(base, error);
  let opens = 0, pursues = 0; const openU = new Set<string>(), pursueU = new Set<string>();
  for (const r of data || []) {
    const act = (r.metadata && (r.metadata as { action?: string }).action ? String((r.metadata as { action?: string }).action) : '').trim();
    if (act === 'open_details') { opens += 1; if (r.user_email) openU.add(r.user_email); }
    if (act === 'save_to_pipeline') { pursues += 1; if (r.user_email) pursueU.add(r.user_email); }
  }
  const engaged = opens + pursues;
  const browsePct = engaged > 0 ? Math.round((opens / engaged) * 1000) / 10 : null;
  const nUsers = new Set([...openU, ...pursueU]).size;
  return {
    ...base, maturity: 'collecting', n: nUsers,
    findings: [
      { label: 'opened details (browsed)', value: `${opens.toLocaleString()} · ${openU.size} users` },
      { label: 'saved to pipeline (pursued)', value: `${pursues.toLocaleString()} · ${pursueU.size} users` },
      { label: 'browse share of engaged actions', value: browsePct == null ? 'unknown' : `${browsePct}%` },
    ],
    note: `Collecting — only ${nUsers} distinct users so far. Supports "browsing is the normal state" directionally; NOT a publishable rate yet.`,
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

// Average decision time — NOW COLLECTING (was research): discovered_at stamps forward from 2026-08-07.
async function decisionTime(sb: SupabaseClient): Promise<MetricCore> {
  const base = { key: 'decision_time', title: 'Average decision time (discovery → pursuit)', domain: 'behavior' as const,
    source: 'user_pipeline.discovered_at → created_at (#122, stamped forward from 2026-08-07)', outputs: ['annual', 'white_paper', 'press'] as OutputChannel[] };
  // Rows stamped since the column landed. If the column doesn't exist yet, surface honestly (not 0).
  const { data, error } = await sb.from('user_pipeline').select('discovered_at, created_at').not('discovered_at', 'is', null).limit(50000);
  if (error) {
    // 42703 = column not yet migrated → research (defined, no data path yet), disclosed.
    if ((error as { code?: string }).code === '42703') {
      return { ...base, maturity: 'research', n: 0, findings: [],
        note: 'Research — discovered_at column not yet migrated. The report\'s single un-backfillable metric; capturing begins the moment the migration lands (#122).', error: null };
    }
    return errMetric(base, error);
  }
  const rows = (data || []).filter((r) => r.discovered_at && r.created_at);
  const gapsDays = rows.map((r) => (new Date(r.created_at).getTime() - new Date(r.discovered_at).getTime()) / 86400_000).filter((d) => d >= 0).sort((a, b) => a - b);
  const n = gapsDays.length;
  if (n === 0) {
    return { ...base, maturity: 'collecting', n: 0, findings: [],
      note: 'Collecting — column live, no stamped saves yet. decision_time = created_at − discovered_at accrues forward; the un-backfillable metric has started its clock.', error: null };
  }
  const median = gapsDays[Math.floor(n / 2)];
  const sameVisit = gapsDays.filter((d) => d < 1).length;
  return {
    ...base, maturity: 'collecting', n,
    findings: [
      { label: 'pursuits with a discovered_at stamp', value: n.toLocaleString() },
      { label: 'median days discovery → pursuit', value: `${Math.round(median * 10) / 10}` },
      { label: 'saved same-visit (0 days)', value: `${sameVisit.toLocaleString()} (${Math.round((sameVisit / n) * 1000) / 10}%)` },
    ],
    note: 'Collecting — the crown-jewel un-backfillable metric, accruing since 2026-08-07. Matures to beta as the sample grows.',
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
