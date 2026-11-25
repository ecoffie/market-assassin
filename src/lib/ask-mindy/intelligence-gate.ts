/**
 * Ask Mindy intelligence gate: gather → record checks → analyst → independent evaluator → (one bounded
 * retry) → publish. The chat answer and the report brief come from the same decision.
 * Plan: docs/ask-mindy/INTELLIGENCE-GATE-PLAN-2026-11-24.md. Off unless ASK_MINDY_INTELLIGENCE_GATE=true and
 * the user is on ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST (comma-separated emails, or `*`).
 */
import { gatherMarketEvidence, publishMarketReport, type MarketReportInput, type MarketReportResult } from '@/mcp/tools/market-report';
import { competitionFactsFor, type CompetitionLookup } from '@/lib/opportunities/competition-facts';
import { findOpportunities, type FindOpportunitiesResult } from '@/lib/opportunities/find-opportunities';
import { checkRecords, resolveWorkCodes, type CandidateRecord, type CustomerEligibility, type RecordCheck } from './evidence-checks';
import { runAnalyst, buildAnalystPrompt, type AnalystDecision, type AnalystInput } from './analyst';
import { evaluateDecision, type Evaluation } from './evaluator';
import { cleanReportForPublish, reportIntegrity, type IntegrityFinding } from './report-integrity';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';
import { mergeStateEvidence } from './evidence-merge';
import { resolveCompanyAnchor, type EntityLookup } from '@/lib/opportunities/company-anchor';

type Env = Record<string, string | undefined>;

export function intelligenceGateEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  if (env.ASK_MINDY_INTELLIGENCE_GATE !== 'true' || !email) return false;
  const list = (env.ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}

export type GateStatus = 'complete' | 'disclosed' | 'measurement_failure' | 'out_of_time';

/**
 * The gate's own deadline, well inside the route's 300 s limit (maxDuration). Past it the gate stops: it skips the
 * retry and discloses what it has. It never hands the turn back to the old path, which would also run out of time.
 */
export const GATE_DEADLINE_MS = 170_000;
/** A model call is not started with less than this left: it could not finish usefully. */
const MIN_CALL_MS = 15_000;
const ANALYST_CALL_MAX_MS = 120_000;
const EVALUATOR_CALL_MAX_MS = 60_000;

/** What the customer reads when the gate could not finish any recommendation in time (never "the market is small"). */
export const GATE_OUT_OF_TIME_ANSWER = 'This one is taking longer than I can wait, so I stopped before recommending anything. That says nothing about the market. Please ask again, or narrow it to one state or one kind of work.';

/** Plain progress lines for the customer while the gate works (shown by the chat as notices). */
export const GATE_PROGRESS = {
  gather: 'Looking at open bids, contracts coming back and agency plans for this work.',
  check: 'Checking which of these fit your company.',
  analyst: 'Weighing the best options for you.',
  review: 'Double-checking the recommendation.',
  retry: 'Tightening the recommendation.',
} as const;

class GateDeadline extends Error {}
/** Resolves with the promise, or rejects with GateDeadline after ms (the call itself also carries its own timeout). */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new GateDeadline(`deadline after ${ms}ms`)), ms); })]).finally(() => clearTimeout(t));
}

export interface GateResult {
  status: GateStatus;
  decision: AnalystDecision | null;
  evaluation: Evaluation | null;
  attempts: number;
  checks: RecordCheck[];
  report: MarketReportResult;
  /** Chat answer rendered from the decision (same facts as the report brief). */
  answer: string;
  /** Hard checks on the report itself; any failure blocks publication. */
  integrity: IntegrityFinding[];
  removed: { recompetes: number; contacts: number };
  cost: { analystIn: number; analystOut: number; evalIn: number; evalOut: number };
  /** Per-step wall time in ms, plus whether the deadline cut the run short (counts and ms only; for the trace). */
  timings: Record<string, number>;
  deadlineHit: boolean;
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 'not established';
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
}

export function marketContext(ev: MarketReportResult, state?: string | null): AnalystInput['market'] {
  const s = ev.sections as unknown as {
    top_agencies?: Array<{ name: string; amount: number }>;
    competition?: { contractors?: Array<{ recipient_name: string; total_obligated: number }> };
  };
  const b = ev.summary?.total_market_basis as { window?: string; state_scoped?: boolean } | undefined;
  const sizeLine = ev.summary?.total_market
    ? `${money(ev.summary.total_market)} per year${b?.state_scoped ? '' : ' nationally'}${b?.window ? ` (${b.window})` : ''}${state && !b?.state_scoped ? `; this figure is NOT limited to ${state}` : ''}`
    : null;
  const forecastStatus = ev._meta.section_status?.find((x) => x.name === 'forecasts')?.status;
  const forecastCount = (ev.sections.forecasts?.count as number) ?? 0;
  return {
    subject: ev.subject,
    sizeLine,
    topAgencies: (s.top_agencies || []).slice(0, 5).map((a) => `${a.name} ${money(a.amount)}`),
    topCompetitors: (s.competition?.contractors || []).slice(0, 5).map((c) => `${c.recipient_name} ${money(c.total_obligated)}`),
    forecastsLine: forecastStatus === 'failed'
      ? 'the forecast search failed; forecasts are UNKNOWN, not zero'
      : forecastCount > 0
        ? `${forecastCount} agency forecast(s) matched`
        : '0 agency forecasts matched; whether forecast coverage exists for this market was not established',
  };
}

/**
 * Which open notices are the same solicitation. The solicitation number when there is one; without it, every
 * descriptive field must agree (title alone is not identity: "Janitorial Services" is posted by many bases);
 * with fewer than two of those fields, the notice is its own solicitation.
 */
export function openNoticeKey(it: Record<string, unknown>): string {
  const sol = String(it.solicitation_number ?? '').trim().toUpperCase();
  if (sol) return `sol:${sol}`;
  const norm = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const fields = [it.title, it.sub_agency ?? it.buyer, it.response_deadline ?? it.relevant_date, it.location_label, it.notice_type].map(norm);
  if (fields.filter(Boolean).length >= 2) return `fields:${fields.join('|')}`;
  return `id:${String(it.notice_id || (it.identity as { id?: string } | undefined)?.id)}`;
}

/** Open-now items from find_opportunities as checkable records (id prefixed so it never collides with an award id). */
export function openNoticesAsRecords(items: Array<Record<string, unknown>>): CandidateRecord[] {
  // One solicitation is often posted several times (amendments, reposts): keep the first of each.
  const seen = new Set<string>();
  return items
    .filter((it) => it && (it.notice_id || (it.identity as { id?: string } | undefined)?.id))
    .filter((it) => {
      const key = openNoticeKey(it);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((it) => ({
      kind: 'open' as const,
      contract_id: `notice:${String(it.notice_id || (it.identity as { id?: string }).id)}`,
      title: (it.title as string) ?? null,
      description: (it.title as string) ?? null,
      awarding_sub_agency: (it.sub_agency as string) ?? (it.buyer as string) ?? null,
      location_label: (it.location_label as string) ?? null,
      response_deadline: (it.response_deadline as string) ?? (it.relevant_date as string) ?? null,
      notice_type: (it.notice_type as string) ?? null,
      set_aside_type: (it.set_aside as string) ?? null,
      psc_code: (it.psc_code as string) ?? null,
      naics_code: (it.naics_code as string) ?? null,
      evidence_class: (it.evidence_class as string) ?? null,
      sam_url: (it.sam_url as string) ?? null,
    } as CandidateRecord));
}

/** A find_opportunities coming-back item as a report recompete row (same field names the report and checks read). */
export function findRecompeteRow(it: Record<string, unknown>): Record<string, unknown> & CandidateRecord {
  const capture = it.capture_start_date ? Date.parse(String(it.capture_start_date)) : NaN;
  return {
    contract_id: String(it.contract_id || ''),
    piid: (it.piid as string) ?? null,
    description: (it.description as string) ?? (it.title as string) ?? null,
    incumbent_name: (it.incumbent_name as string) ?? null,
    incumbent_uei: (it.incumbent_uei as string) ?? null,
    awarding_agency: (it.buyer as string) ?? null,
    awarding_sub_agency: (it.awarding_sub_agency as string) ?? null,
    psc_code: (it.psc_code as string) ?? null,
    naics_code: (it.naics_code as string) ?? null,
    set_aside_type: (it.set_aside_type as string) ?? null,
    place_of_performance_state: (it.place_of_performance_state as string) ?? null,
    period_of_performance_current_end: (it.current_end as string) ?? null,
    total_obligation: it.total_obligation ?? null,
    potential_total_value: it.potential_total_value ?? null,
    capture_start_date: (it.capture_start_date as string) ?? null,
    capture_start_passed: Number.isFinite(capture) ? capture < Date.now() : null,
    recompete_likelihood: it.recompete_likelihood ?? null,
    provenance: { source_label: 'USASpending award record', source_url: it.source_url ?? null },
  };
}

/** Agency forecasts (coming soon) as checkable records. */
export function forecastsAsRecords(items: Array<Record<string, unknown>>): CandidateRecord[] {
  const seen = new Set<string>();
  return items
    .filter((it) => it && (it.forecast_id || (it.identity as { id?: string } | undefined)?.id))
    .filter((it) => {
      const key = String(it.forecast_id || (it.identity as { id?: string }).id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((it) => ({
      kind: 'forecast' as const,
      contract_id: `forecast:${String(it.forecast_id || (it.identity as { id?: string }).id)}`,
      title: (it.title as string) ?? null,
      description: (it.title as string) ?? null,
      awarding_sub_agency: (it.contracting_office as string) ?? (it.buyer as string) ?? null,
      incumbent_name: (it.incumbent_name as string) ?? null,
      place_of_performance_state: (it.place_of_performance_state as string) ?? null,
      location_label: (it.location_label as string) ?? null,
      set_aside_type: (it.set_aside_type as string) ?? null,
      naics_code: (it.naics_code as string) ?? null,
      value_label: (it.value_label as string) ?? null,
      fiscal_year: it.fiscal_year ?? null,
      anticipated_quarter: it.anticipated_quarter ?? null,
      solicitation_date: (it.solicitation_date as string) ?? null,
      source_url: (it.source_url as string) ?? null,
    } as CandidateRecord));
}

/**
 * What is known about agency forecasts, stated so "none" is never confused with "not covered".
 * Empty in the requested state gets ONE bounded widening: the same search nationwide, count only.
 */
export async function forecastsLine(a: {
  horizon: { status?: string; matched_count?: number | null } | undefined;
  shown: number;
  state: string | null;
  query: string;
  national: (q: { query: string }) => Promise<FindOpportunitiesResult | null>;
}): Promise<string> {
  const h = a.horizon;
  if (!h || h.status === 'unavailable') return 'forecast coverage for this buyer or market is not available; forecasts are UNKNOWN, not zero';
  if (h.status === 'grounded' || h.status === 'partial') {
    const matched = h.matched_count ?? a.shown;
    return `${matched} agency forecast(s) matched${a.state ? ` in ${a.state}` : ''}; the ${a.shown} shown here were checked`;
  }
  if (!a.state) return 'agency forecasts were searched nationwide (current and future fiscal years); none matched';
  const nat = await a.national({ query: a.query }).catch(() => null);
  const n = nat?.horizons?.coming_soon;
  if (n?.status === 'grounded' || n?.status === 'partial') {
    return `agency forecasts were searched: none in ${a.state}; the same search nationwide finds ${n.matched_count ?? 'some'} (current and future fiscal years), so forecast coverage exists for this work, just not in ${a.state}`;
  }
  return `agency forecasts were searched: none in ${a.state}, and none nationwide either`;
}

/** The lead line of a disclosed answer: before the headline, so an unchecked recommendation never reads as a final one. */
export const DISCLOSED_LEAD = 'I could not fully verify this answer, so treat it as a starting point, not a final recommendation:';
/** Said when the review found the next moves too vague (an actionability failure is not a factual one). */
export const NOT_ACTIONABLE_NOTE = 'The next steps below are not specific enough yet.';

/**
 * The chat answer: a deterministic rendering of the decision (no second model, no new facts).
 * `disclosed` (a disclosed answer, even with no listed points) puts the lead line and the unverified points FIRST.
 */
export function renderDecisionAnswer(d: AnalystDecision, opts: { reportUrl?: string | null; disclosed?: string[] } = {}): string {
  const parts: string[] = [];
  if (opts.disclosed) parts.push(DISCLOSED_LEAD, ...opts.disclosed.map((x) => `- ${x}`), '');
  parts.push(d.headline, '');
  d.pursuits.forEach((p, i) => {
    parts.push(`**${i + 1}. ${p.title}**`);
    for (const w of p.why) parts.push(`- ${w}`);
    if (p.barrier) parts.push(`- What stands in the way: ${p.barrier}`);
    parts.push(`- Next move: ${p.next_move}`, '');
  });
  if (d.also_consider?.length) parts.push('**Also worth a look:**', ...d.also_consider.map((x) => `- ${x}`), '');
  if (d.ruled_out) parts.push(`**Ruled out:** ${d.ruled_out}`, '');
  if (d.gaps.length) parts.push('**Not yet established:**', ...d.gaps.map((g) => `- ${g}`), '');
  if (opts.reportUrl) parts.push(`Full report: ${opts.reportUrl}`, '');
  parts.push(d.next_question);
  return parts.join('\n').trim();
}

export async function runIntelligenceGate(args: {
  question: string;
  reportInput: MarketReportInput;
  /** Several requested states: evidence is gathered per state and merged. */
  states?: string[];
  profile: string | null;
  eligibility?: CustomerEligibility;
  competitionLookup?: CompetitionLookup;
  /** Plain progress lines for the customer (the route sends them as `progress` events). */
  onProgress?: (message: string) => void;
  /** Overall budget in ms (default GATE_DEADLINE_MS). */
  deadlineMs?: number;
  /** Injectable for tests. */
  deps?: {
    now?: () => number;
    gather?: typeof gatherMarketEvidence;
    publish?: typeof publishMarketReport;
    analyst?: typeof runAnalyst;
    evaluate?: typeof evaluateDecision;
    findOpen?: (q: { query: string; state: string | null; states?: string[] }) => Promise<FindOpportunitiesResult | null>;
    findNationalForecasts?: (q: { query: string }) => Promise<FindOpportunitiesResult | null>;
    findTargeted?: (q: { query: string; naics: string; state: string | null; states: string[] }) => Promise<FindOpportunitiesResult | null>;
    entityLookup?: EntityLookup;
  };
}): Promise<GateResult> {
  const gather = args.deps?.gather ?? gatherMarketEvidence;
  const publish = args.deps?.publish ?? publishMarketReport;
  const analyst = args.deps?.analyst ?? runAnalyst;
  const evaluate = args.deps?.evaluate ?? evaluateDecision;
  const cost = { analystIn: 0, analystOut: 0, evalIn: 0, evalOut: 0 };
  const now = args.deps?.now ?? Date.now;
  const t0 = now();
  const deadline = t0 + (args.deadlineMs ?? GATE_DEADLINE_MS);
  const left = () => deadline - now();
  const timings: Record<string, number> = {};
  let deadlineHit = false;
  const timed = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
    const s0 = now();
    try { return await f(); } finally { timings[name] = now() - s0; }
  };
  const progress = (m: string) => { try { args.onProgress?.(m); } catch { /* progress is best effort */ } };
  const outOfTime = (report: MarketReportResult, checks: RecordCheck[] = []): GateResult => {
    timings.total = now() - t0;
    return { status: 'out_of_time', decision: null, evaluation: null, attempts: 0, checks, report, cost, integrity: [], removed: { recompetes: 0, contacts: 0 }, answer: GATE_OUT_OF_TIME_ANSWER, timings, deadlineHit: true };
  };

  const query = String(args.reportInput.keyword || args.reportInput.naics || '').trim();
  const states = (args.states?.length ? args.states : args.reportInput.state ? [args.reportInput.state] : []).map((x) => x.toUpperCase());
  const findOpen = args.deps?.findOpen ?? (async (q: { query: string; state: string | null; states?: string[] }) =>
    findOpportunities({
      query: q.query,
      ...(q.states && q.states.length > 1 ? { states: q.states } : { location: q.state }),
      horizons: { open_now: true, coming_back: false, coming_soon: true },
      limit_per_horizon: 25,
    }, { competitionLookup: null }));
  const findTargeted = args.deps?.findTargeted ?? (async (q: { query: string; naics: string; state: string | null; states: string[] }) =>
    findOpportunities({
      query: q.query,
      ...(q.states.length > 1 ? { states: q.states } : { location: q.state }),
      horizons: { open_now: true, coming_back: true, coming_soon: false },
      limit_per_horizon: 25,
      advanced: { naics: q.naics },
    }, { competitionLookup: null }));
  const findNationalForecasts = args.deps?.findNationalForecasts ?? (async (q: { query: string }) =>
    findOpportunities({ query: q.query, horizons: { open_now: false, coming_back: false, coming_soon: true }, limit_per_horizon: 1 }, { competitionLookup: null }));
  progress(GATE_PROGRESS.gather);
  const [ev, open] = await timed('gather', () => Promise.all([
    states.length > 1
      ? Promise.all(states.map((st) => gather({ ...args.reportInput, state: st }))).then((rs) => mergeStateEvidence(rs, states))
      : gather(args.reportInput),
    query ? findOpen({ query, state: states.length === 1 ? states[0] : null, states }).catch(() => null) : Promise.resolve(null),
  ]));
  if (ev._meta.publication_state === 'measurement_failure') {
    return {
      status: 'measurement_failure', decision: null, evaluation: null, attempts: 0, checks: [], report: ev, cost, integrity: [], removed: { recompetes: 0, contacts: 0 },
      answer: `I could not measure this market right now (the data source did not respond), so I can't recommend anything yet. This is not a sign the market is small. Please try again in a few minutes.`,
      timings: { ...timings, total: now() - t0 }, deadlineHit: false,
    };
  }

  // The customer's work as codes, from their own words (share only as fallback).
  const msAll = ev.sections.market_size as { topPscList?: Array<{ code: string; name?: string; pct: number }>; allNaics?: Array<{ code: string; name?: string; pct: number }> } | null;
  const work = resolveWorkCodes(query, msAll?.topPscList || [], msAll?.allNaics || []);
  // One targeted search on the customer's own industry code: a long phrase's keyword search sprawls (RBA: the top
  // 25 of 206 open notices, a coming-back list of building repairs) while the real work sits under its NAICS.
  const targetNaics = work.basis === 'name' ? work.naics[0] : undefined;
  const targeted = targetNaics && query
    ? await timed('targeted', () => findTargeted({ query, naics: targetNaics, state: states.length === 1 ? states[0] : null, states }).catch(() => null))
    : null;
  const targetedBack = ((targeted?.horizons?.coming_back?.items as Array<Record<string, unknown>>) || []).map(findRecompeteRow);
  if (targetedBack.length) {
    const have = new Set((((ev.sections.recompetes?.contracts as Array<{ contract_id?: string }>) || [])).map((r) => String(r.contract_id)));
    const add = targetedBack.filter((r) => r.contract_id && !have.has(String(r.contract_id)));
    ev.sections.recompetes = { ...ev.sections.recompetes, contracts: [...(((ev.sections.recompetes?.contracts as unknown[]) || [])), ...add], count: (((ev.sections.recompetes?.contracts as unknown[]) || []).length) + add.length };
  }
  const recompetes = ((ev.sections.recompetes?.contracts as unknown[]) || []) as CandidateRecord[];
  const openH = open?.horizons?.open_now;
  const targetedOpen = (targeted?.horizons?.open_now?.items as Array<Record<string, unknown>>) || [];
  const openRecs = openNoticesAsRecords([...targetedOpen, ...(openH?.items || [])]);
  const soonH = open?.horizons?.coming_soon;
  const soonRecs = forecastsAsRecords(soonH?.items || []);
  const recs = [...openRecs, ...soonRecs, ...recompetes];
  const ms = ev.sections.market_size as { topPscList?: Array<{ code: string; pct: number }> } | null;
  const msN = ev.sections.market_size as { allNaics?: Array<{ code: string; pct: number }> } | null;
  const scope = {
    state: states.length ? states.join(', ') : null,
    states,
    pscShares: (ms?.topPscList || []).map((p) => ({ code: p.code, pct: p.pct })),
    naicsShares: (msN?.allNaics || []).map((n) => ({ code: n.code, pct: n.pct })),
    workPsc: work.psc,
    workNaics: work.naics,
  };
  // The customer's SAM size per NAICS, when the profile carries a UEI (self-represented in SAM; unknown stays unknown).
  const eligibility: CustomerEligibility = { ...(args.eligibility || {}) };
  if (eligibility.uei) {
    const res = await timed('entity', () => resolveCompanyAnchor(eligibility.uei!, args.deps?.entityLookup).catch(() => null));
    if (res?.status === 'resolved' && res.anchor && res.anchor.size_source !== 'unavailable') {
      eligibility.sizeByNaics = res.anchor.size_by_naics as Record<string, 'Y' | 'N' | 'E'>;
    }
  }
  progress(GATE_PROGRESS.check);
  const comp = await timed('competition', () => competitionFactsFor(recompetes.map((r) => r.contract_id), args.competitionLookup, { budgetMs: 8000 }));
  const checks = checkRecords(recs, scope, eligibility, comp);
  timings.records = recs.length;

  const market = marketContext(ev, scope.state);
  market.openNowLine = !openH || openH.status === 'unavailable'
    ? 'the open-bid search was unavailable; open bids are UNKNOWN, not zero'
    : (() => {
        const items = (openH.items || []).length;
        const matched = openH.matched_count ?? items;
        // Repeats are counted within THIS search's results; the targeted industry-code search is reported apart.
        const distinct = openNoticesAsRecords(openH.items || []).length;
        const dupes = items - distinct;
        const added = openRecs.length - distinct;
        return `${matched} open SAM.gov notice(s) matched the search${dupes > 0 ? `; ${dupes} were repeat postings of the same solicitation, leaving ${distinct} distinct bid(s)` : ''}${matched > items ? `; the top ${items} were returned and ${matched - items} were not` : `; all were checked`}${added > 0 ? `; a second search on the customer's industry code added ${added} more distinct bid(s), also checked` : ''}`;
      })();
  market.forecastsLine = await timed('forecasts', () => forecastsLine({ horizon: soonH, shown: soonRecs.length, state: scope.state, query, national: findNationalForecasts }));
  const input: AnalystInput = { question: args.question, profile: args.profile, market, records: recs, checks, customerUei: eligibility.uei ?? null };
  const evidence = buildAnalystPrompt(input);

  let decision: AnalystDecision | null = null;
  let evaluation: Evaluation | null = null;
  let attempts = 0;
  let feedback: string[] = [];
  while (attempts < 2) {
    // Not enough time for another analyst + review: stop here (the retry is skipped; a first decision is disclosed).
    if (left() < MIN_CALL_MS * 2) { deadlineHit = true; break; }
    attempts++;
    progress(attempts === 1 ? GATE_PROGRESS.analyst : GATE_PROGRESS.retry);
    const asked = feedback.length
      ? { ...input, question: `${input.question}\n\nA reviewer rejected the previous answer. Fix these and answer again from the same evidence:\n${feedback.map((f) => `- ${f}`).join('\n')}` }
      : input;
    const aMs = Math.min(ANALYST_CALL_MAX_MS, left() - MIN_CALL_MS);
    let a: Awaited<ReturnType<typeof runAnalyst>>;
    try {
      a = await timed(`analyst_${attempts}`, () => within(analyst(asked, { timeoutMs: aMs }), aMs));
    } catch (err) {
      // Out of time (or a timed-out call): keep the earlier decision, if any. A real error with time left still throws.
      if (err instanceof GateDeadline || left() < MIN_CALL_MS * 2 || /timed? ?out/i.test(String((err as Error)?.message))) { deadlineHit = true; attempts--; break; }
      throw err;
    }
    cost.analystIn += a.usage.input; cost.analystOut += a.usage.output;
    decision = a.decision;
    evaluation = null;
    progress(GATE_PROGRESS.review);
    const eMs = Math.min(EVALUATOR_CALL_MAX_MS, left());
    let e: Awaited<ReturnType<typeof evaluateDecision>>;
    try {
      if (eMs < MIN_CALL_MS) throw new GateDeadline('no time to review');
      e = await timed(`evaluator_${attempts}`, () => within(evaluate({ question: args.question, evidence, decision: decision!, checks, dropped: a.dropped }, { timeoutMs: eMs }), eMs));
    } catch (err) {
      if (err instanceof GateDeadline || left() < MIN_CALL_MS || /timed? ?out/i.test(String((err as Error)?.message))) { deadlineHit = true; break; }
      throw err;
    }
    cost.evalIn += e.usage.input; cost.evalOut += e.usage.output;
    evaluation = { pass: e.pass, results: e.results, fix: e.fix };
    if (e.pass) break;
    feedback = e.fix;
  }
  if (!decision) return outOfTime(ev, checks);

  ev.decision = decision ? { headline: decision.headline, pursuits: decision.pursuits, also_consider: decision.also_consider || [], ruled_out: decision.ruled_out, gaps: decision.gaps } : null;
  // The report must agree with the checks: ruled-out records and contacts tied only to them come out, then the
  // report itself is verified BEFORE anything is saved or shared.
  const { report: cleaned, removed } = cleanReportForPublish(ev, checks);
  const integrity = evaluation?.pass
    ? reportIntegrity(cleaned, checks, { requestedState: scope.state, html: renderMarketReportHtml(cleaned) })
    : [];
  const status: GateStatus = evaluation?.pass && integrity.every((f) => f.pass) ? 'complete' : 'disclosed';
  // A decision the review never finished (out of time) is disclosed as unchecked, never shown as verified.
  const unreviewed = deadlineHit && !evaluation;
  // Only a decision that passed review AND a report that passed integrity is published as a shareable report.
  const report = status === 'complete' ? await timed('publish', () => publish(cleaned, args.reportInput)) : cleaned;
  // The customer is told what could not be VERIFIED (facts, relevance, report data). An actionability failure blocks
  // the shareable report but is not a verification claim; clarity is advisory and only recorded in the trace.
  const FACTUAL = new Set(['relevant', 'pursuable', 'reasoned']);
  const disclosed = status === 'disclosed'
    ? [
        ...(unreviewed ? ['I ran out of time before double-checking this recommendation.'] : []),
        ...(evaluation?.results || []).filter((r) => !r.pass && FACTUAL.has(r.criterion)).map((r) => r.reason),
        ...integrity.filter((f) => !f.pass).map((f) => f.reason),
        ...((evaluation?.results || []).some((r) => !r.pass && r.criterion === 'actionable') ? [NOT_ACTIONABLE_NOTE] : []),
      ]
    : undefined;
  timings.total = now() - t0;
  return {
    status, decision, evaluation, attempts, checks, report, cost, integrity, removed, timings, deadlineHit,
    answer: decision ? renderDecisionAnswer(decision, { reportUrl: report.deliverable?.url, disclosed }) : 'I could not produce a recommendation from this evidence.',
  };
}
