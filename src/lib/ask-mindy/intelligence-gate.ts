/**
 * Ask Mindy intelligence gate: gather → record checks → analyst → independent evaluator → (one bounded
 * retry) → publish. The chat answer and the report brief come from the same decision.
 * Plan: docs/ask-mindy/INTELLIGENCE-GATE-PLAN-2026-11-24.md. Off unless ASK_MINDY_INTELLIGENCE_GATE=true and
 * the user is on ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST (comma-separated emails, or `*`).
 */
import { gatherMarketEvidence, publishMarketReport, type MarketReportInput, type MarketReportResult } from '@/mcp/tools/market-report';
import { competitionFactsFor, type CompetitionLookup } from '@/lib/opportunities/competition-facts';
import { checkRecords, type CandidateRecord, type CustomerEligibility, type RecordCheck } from './evidence-checks';
import { runAnalyst, buildAnalystPrompt, type AnalystDecision, type AnalystInput } from './analyst';
import { evaluateDecision, type Evaluation } from './evaluator';

type Env = Record<string, string | undefined>;

export function intelligenceGateEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  if (env.ASK_MINDY_INTELLIGENCE_GATE !== 'true' || !email) return false;
  const list = (env.ASK_MINDY_INTELLIGENCE_GATE_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}

export type GateStatus = 'complete' | 'disclosed' | 'measurement_failure';

export interface GateResult {
  status: GateStatus;
  decision: AnalystDecision | null;
  evaluation: Evaluation | null;
  attempts: number;
  checks: RecordCheck[];
  report: MarketReportResult;
  /** Chat answer rendered from the decision (same facts as the report brief). */
  answer: string;
  cost: { analystIn: number; analystOut: number; evalIn: number; evalOut: number };
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

/** The chat answer: a deterministic rendering of the decision (no second model, no new facts). */
export function renderDecisionAnswer(d: AnalystDecision, opts: { reportUrl?: string | null; disclosed?: string[] } = {}): string {
  const parts: string[] = [d.headline, ''];
  d.pursuits.forEach((p, i) => {
    parts.push(`**${i + 1}. ${p.title}**`);
    for (const w of p.why) parts.push(`- ${w}`);
    if (p.barrier) parts.push(`- What stands in the way: ${p.barrier}`);
    parts.push(`- Next move: ${p.next_move}`, '');
  });
  if (d.ruled_out) parts.push(`**Ruled out:** ${d.ruled_out}`, '');
  if (d.gaps.length) parts.push('**Not yet established:**', ...d.gaps.map((g) => `- ${g}`), '');
  if (opts.disclosed?.length) parts.push('**I could not fully verify this answer:**', ...opts.disclosed.map((x) => `- ${x}`), '');
  if (opts.reportUrl) parts.push(`Full report: ${opts.reportUrl}`, '');
  parts.push(d.next_question);
  return parts.join('\n').trim();
}

export async function runIntelligenceGate(args: {
  question: string;
  reportInput: MarketReportInput;
  profile: string | null;
  eligibility?: CustomerEligibility;
  competitionLookup?: CompetitionLookup;
  /** Injectable for tests. */
  deps?: {
    gather?: typeof gatherMarketEvidence;
    publish?: typeof publishMarketReport;
    analyst?: typeof runAnalyst;
    evaluate?: typeof evaluateDecision;
  };
}): Promise<GateResult> {
  const gather = args.deps?.gather ?? gatherMarketEvidence;
  const publish = args.deps?.publish ?? publishMarketReport;
  const analyst = args.deps?.analyst ?? runAnalyst;
  const evaluate = args.deps?.evaluate ?? evaluateDecision;
  const cost = { analystIn: 0, analystOut: 0, evalIn: 0, evalOut: 0 };

  const ev = await gather(args.reportInput);
  if (ev._meta.publication_state === 'measurement_failure') {
    return {
      status: 'measurement_failure', decision: null, evaluation: null, attempts: 0, checks: [], report: ev, cost,
      answer: `I could not measure this market right now (the data source did not respond), so I can't recommend anything yet. This is not a sign the market is small. Please try again in a few minutes.`,
    };
  }

  const recs = ((ev.sections.recompetes?.contracts as unknown[]) || []) as CandidateRecord[];
  const ms = ev.sections.market_size as { topPscList?: Array<{ code: string; pct: number }> } | null;
  const scope = { state: args.reportInput.state || null, pscShares: (ms?.topPscList || []).map((p) => ({ code: p.code, pct: p.pct })) };
  const comp = await competitionFactsFor(recs.map((r) => r.contract_id), args.competitionLookup, { budgetMs: 8000 });
  const checks = checkRecords(recs, scope, args.eligibility, comp);

  const input: AnalystInput = { question: args.question, profile: args.profile, market: marketContext(ev, scope.state), records: recs, checks };
  const evidence = buildAnalystPrompt(input);

  let decision: AnalystDecision | null = null;
  let evaluation: Evaluation | null = null;
  let attempts = 0;
  let feedback: string[] = [];
  while (attempts < 2) {
    attempts++;
    const asked = feedback.length
      ? { ...input, question: `${input.question}\n\nA reviewer rejected the previous answer. Fix these and answer again from the same evidence:\n${feedback.map((f) => `- ${f}`).join('\n')}` }
      : input;
    const a = await analyst(asked);
    cost.analystIn += a.usage.input; cost.analystOut += a.usage.output;
    decision = a.decision;
    const e = await evaluate({ question: args.question, evidence, decision, checks });
    cost.evalIn += e.usage.input; cost.evalOut += e.usage.output;
    evaluation = { pass: e.pass, results: e.results, fix: e.fix };
    if (e.pass) break;
    feedback = e.fix;
  }

  const status: GateStatus = evaluation?.pass ? 'complete' : 'disclosed';
  ev.decision = decision ? { headline: decision.headline, pursuits: decision.pursuits, ruled_out: decision.ruled_out, gaps: decision.gaps } : null;
  // Only a decision that passed the gate leads a published, shareable report.
  const report = status === 'complete' ? await publish(ev, args.reportInput) : ev;
  const disclosed = status === 'disclosed' ? (evaluation?.results || []).filter((r) => !r.pass).map((r) => r.reason) : undefined;
  return {
    status, decision, evaluation, attempts, checks, report, cost,
    answer: decision ? renderDecisionAnswer(decision, { reportUrl: report.deliverable?.url, disclosed }) : 'I could not produce a recommendation from this evidence.',
  };
}
