/**
 * Intelligence gate, analyst step: turn checked evidence into decisions BEFORE anything is published.
 * Plan: docs/ask-mindy/INTELLIGENCE-GATE-PLAN-2026-11-24.md.
 *
 * The model sees only the records the software checks passed (with their barriers and actions) plus a
 * one-line reason for each excluded record. It returns structured decisions. Software then enforces that
 * every pursuit cites a record that passed (evaluator check 2 cannot be talked around).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CandidateRecord, RecordCheck } from './evidence-checks';

export const ANALYST_MODEL_DEFAULT = 'claude-opus-5-5';

export interface AnalystInput {
  question: string;
  /** Plain-text company profile, or null when unknown. */
  profile: string | null;
  market: {
    subject: string;
    /** e.g. "$426M nationally, FY2026, awards whose text says 'janitorial services' (not state-scoped)". */
    sizeLine: string | null;
    topAgencies: string[];
    topCompetitors: string[];
    /** e.g. "0 agency forecasts matched; forecast coverage for this market is not established". */
    forecastsLine: string;
    /** What is known about OPEN solicitations. Default: not searched (never imply none exist). */
    openNowLine?: string;
  };
  records: CandidateRecord[];
  checks: RecordCheck[];
  /** Customer UEI from the profile, for the 'YOUR COMPANY (UEI match)' marker. */
  customerUei?: string | null;
}

export interface Pursuit {
  contract_id: string;
  title: string;
  why: string[];
  barrier: string | null;
  next_move: string;
}

export interface AnalystDecision {
  headline: string;
  pursuits: Pursuit[];
  /** Up to 4 one-line leads worth a look beyond the top pursuits (each from a passing record). */
  also_consider: string[];
  ruled_out: string;
  gaps: string[];
  next_question: string;
}

export const ANALYST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'pursuits', 'also_consider', 'ruled_out', 'gaps', 'next_question'],
  properties: {
    headline: { type: 'string' },
    pursuits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['contract_id', 'title', 'why', 'barrier', 'next_move'],
        properties: {
          contract_id: { type: 'string' },
          title: { type: 'string' },
          why: { type: 'array', items: { type: 'string' } },
          barrier: { type: ['string', 'null'] },
          next_move: { type: 'string' },
        },
      },
    },
    also_consider: { type: 'array', items: { type: 'string' } },
    ruled_out: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    next_question: { type: 'string' },
  },
} as const;

const ANALYST_SYSTEM = `You are Mindy's federal market analyst. A customer asked a question; software has already gathered the evidence and checked every candidate record for relevance and pursuability. Your job is the decision: which of the PASSING records this customer should pursue first, why, what stands in the way, and the next move.

Rules:
- Use only facts in the evidence. Never add an agency, contract, date, dollar amount, person or requirement that is not there. Never say something does not exist (no open bids, no forecasts, no competitors) unless the evidence establishes it; if a source was not searched, say so.
- A pursuit must be one of the PASSING records, cited by its exact contract_id. Rank them: strongest first. Recommend at most 3.
- "why" is 1 to 3 short reasons drawn from the record (location, value, set-aside, how it was competed, timing).
- Rank by fit to the work the customer described first. A contract the customer holds (YOUR COMPANY) and core work come before loosely related work. A live OPEN NOW bid outranks a contract coming back only when it is core work for this customer; loosely related open bids go in "also_consider". A market-research notice (sources sought, presolicitation) is a chance to shape the bid, so say so.
- The headline must match the pursuits you list (same items, same count).
- "barrier" is the biggest obstacle from that record's barriers, in plain words, or null if none.
- "next_move" is one concrete action the customer can take this week. If the record says the capture window has passed, the move is to check SAM.gov for the follow-on solicitation now.
- "ruled_out" says in one or two plain sentences what was excluded and why (wrong state, different work, mandatory nonprofit source), with counts.
- "also_consider": up to 4 leads from OTHER passing records, each under 20 words: what it is, where, and why, with at most one date or dollar figure. Never put leads in "gaps".
- "gaps": at most 5 short phrases (under 15 words each) naming what the evidence could not establish that would change the decision (for example forecast coverage, the customer's size status). No dates, values or codes in gaps.
- Identity: say the customer holds or is the incumbent on a contract ONLY when its record says "YOUR COMPANY (UEI match)". If an incumbent's name merely resembles the customer's company, write "held by <exact incumbent name>" and add "confirm whether this is your company" to gaps.
- Use the GROUP COUNTS exactly as given; never recount.
- "headline" is one sentence a busy owner can act on.
- "next_question" is one plain-English question that would most improve the recommendation.
- Never describe the process: no "review", "passed", "checks", "records", "evidence" or "excluded". Talk about bids and contracts ("none of the 5 open bids is cleaning work: they are base support, cylinder rental and fuel storage").
- "ruled_out": open bids and contracts coming back are separate groups; give each group's count and the plain reason, and name what the open ones actually were.
- Explain federal terms in plain words the first time: say "reserved for small businesses" (not "set-aside"), "the next contract for this work" (not "follow-on" or "recompete"), "awarded so far" (not "obligated"; obligated money is committed, not spent). No codes (NAICS, PSC, UEI) in the answer.
- Write for a small-business owner, not a contracting officer. No acronyms without saying what they mean. No em dashes.
- If no record passed, say so plainly in the headline, return an empty pursuits list, and explain in gaps what would be needed.`;

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'value not stated';
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;
}

export function buildAnalystPrompt(input: AnalystInput): string {
  const uei = input.customerUei ? String(input.customerUei).toUpperCase() : null;
  const byId = new Map(input.records.map((r) => [r.contract_id, { ...r, __yours: !!uei && String(r.incumbent_uei || '').toUpperCase() === uei } as CandidateRecord & { __yours?: boolean }]));
  const passing = input.checks.filter((c) => c.verdict === 'pursue');
  const excluded = input.checks.filter((c) => c.verdict !== 'pursue');
  const line = (r: CandidateRecord & Record<string, unknown>) =>
    r.kind === 'forecast'
      ? [
          'COMING SOON (agency forecast, not yet a bid)',
          String(r.awarding_sub_agency || 'agency not stated'),
          String(r.title || '').slice(0, 140),
          `location ${r.location_label || r.place_of_performance_state || 'not stated'}`,
          `estimated value ${r.value_label || 'not stated'}`,
          `timing ${[r.anticipated_quarter, r.fiscal_year ? `FY${r.fiscal_year}` : '', r.solicitation_date ? `solicitation ${String(r.solicitation_date).slice(0, 10)}` : ''].filter(Boolean).join(' ') || 'not stated'}`,
          `set-aside ${r.set_aside_type || 'not stated'}`,
          r.incumbent_name ? `incumbent ${r.incumbent_name}` : '',
          r.source_url ? `link ${r.source_url}` : '',
        ].filter(Boolean).join(' · ')
      : r.kind === 'open'
      ? [
          'OPEN NOW',
          String(r.awarding_sub_agency || r.incumbent_name || 'buyer not stated'),
          String(r.title || r.description || '').slice(0, 140),
          `location ${r.location_label || 'not stated'}`,
          `notice type ${r.notice_type || 'not stated'}`,
          `responses due ${r.response_deadline ? String(r.response_deadline).slice(0, 10) : 'not stated'}`,
          `set-aside ${r.set_aside_type || 'not stated'}`,
          r.sam_url ? `link ${r.sam_url}` : '',
        ].filter(Boolean).join(' · ')
      : [
          'COMING BACK',
      r.awarding_sub_agency || 'office not stated',
      String(r.description || '').slice(0, 140),
      `place of performance ${r.place_of_performance_state || 'not stated'}`,
      `obligated ${money(r.total_obligation)}`,
      `current period ends ${r.period_of_performance_current_end || 'not stated'}`,
      `set-aside ${r.set_aside_type || 'not stated'}`,
      r.__yours ? 'incumbent YOUR COMPANY (UEI match)' : `incumbent ${r.incumbent_name || 'not stated'}`,
        ].join(' · ');
  const passingText = passing.length
    ? passing
        .map((c) => {
          const r = byId.get(c.contract_id) as CandidateRecord & Record<string, unknown>;
          return [
            `- contract_id ${c.contract_id}: ${line(r)}`,
            ...c.barriers.map((b) => `    barrier: ${b.detail}`),
            ...c.actions.map((a) => `    action: ${a.detail}`),
          ].join('\n');
        })
        .join('\n')
    : '(none)';
  const kindOf = (id: string) => byId.get(id)?.kind ?? 'recompete';
  const groupName: Record<string, string> = { open: 'Open now', recompete: 'Coming back', forecast: 'Coming soon' };
  const counts = (['open', 'recompete', 'forecast'] as const).map((k) => {
    const all = input.checks.filter((c) => kindOf(c.contract_id) === k);
    return all.length ? `${groupName[k]}: ${all.length} checked, ${all.filter((c) => c.verdict === 'pursue').length} passing, ${all.filter((c) => c.verdict !== 'pursue').length} excluded` : '';
  }).filter(Boolean);
  // Excluded items grouped by kind and reason, with up to 4 named examples each (keeps the prompt small).
  const excludedText = excluded.length
    ? (['open', 'recompete', 'forecast'] as const).map((k) => {
        const inKind = excluded.filter((c) => kindOf(c.contract_id) === k);
        if (!inKind.length) return '';
        const byReason = new Map<string, RecordCheck[]>();
        for (const c of inKind) {
          const code = c.exclusions[0]?.code || 'other';
          byReason.set(code, [...(byReason.get(code) || []), c]);
        }
        const lines = [...byReason.entries()].map(([code, cs]) => {
          const ex = cs.slice(0, 4).map((c) => {
            const r = byId.get(c.contract_id) as (CandidateRecord & Record<string, unknown>) | undefined;
            return `"${String(r?.title || r?.description || 'untitled').slice(0, 70)}" (${c.exclusions[0]?.detail.slice(0, 110) || ''})`;
          });
          return `  ${cs.length} ${code.replace(/_/g, ' ')}: ${ex.join('; ')}${cs.length > 4 ? '; ...' : ''}`;
        });
        return `${groupName[k]}, ${inKind.length} excluded:\n${lines.join('\n')}`;
      }).filter(Boolean).join('\n')
    : '(none)';
  return [
    `CUSTOMER QUESTION: ${input.question}`,
    `COMPANY PROFILE: ${input.profile || 'not provided'}`,
    `MARKET: ${input.market.subject}${input.market.sizeLine ? `; ${input.market.sizeLine}` : ''}`,
    `TOP BUYING AGENCIES: ${input.market.topAgencies.join('; ') || 'none returned'}`,
    `TOP COMPETITORS: ${input.market.topCompetitors.join('; ') || 'none returned'}`,
    `FORECASTS: ${input.market.forecastsLine}`,
    `OPEN SOLICITATIONS: ${input.market.openNowLine || 'NOT searched for this answer. Do not say whether any are open; list checking SAM.gov for open bids as a gap.'}`,
    '',
    `GROUP COUNTS (use exactly): ${counts.join('; ') || 'none'}`,
    '',
    `PASSING RECORDS (OPEN NOW = live bids or notices on SAM.gov; COMING BACK = current contracts ending soon; COMING SOON = agency forecasts of planned purchases):`,
    passingText,
    '',
    `EXCLUDED RECORDS (do not recommend):`,
    excludedText,
  ].join('\n');
}

/** Software enforcement after the model: a pursuit must cite a record that passed the checks. */
export function enforceDecision(decision: AnalystDecision, checks: RecordCheck[]): { decision: AnalystDecision; dropped: string[] } {
  const passing = new Set(checks.filter((c) => c.verdict === 'pursue').map((c) => c.contract_id));
  const dropped: string[] = [];
  const pursuits = decision.pursuits.filter((p) => {
    if (passing.has(p.contract_id)) return true;
    dropped.push(p.contract_id);
    return false;
  });
  return { decision: { ...decision, pursuits: pursuits.slice(0, 3), also_consider: (decision.also_consider || []).slice(0, 4), gaps: (decision.gaps || []).slice(0, 5) }, dropped };
}

export async function runAnalyst(
  input: AnalystInput,
  opts: { client?: Anthropic; model?: string } = {},
): Promise<{ decision: AnalystDecision; dropped: string[]; usage: { input: number; output: number }; model: string }> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? process.env.ASK_MINDY_ANALYST_MODEL ?? ANALYST_MODEL_DEFAULT;
  const msg = await client.messages.create({
    model,
    max_tokens: 8000,
    system: ANALYST_SYSTEM,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ANALYST_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content: buildAnalystPrompt(input) }],
  });
  if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') throw new Error(`analyst stopped: ${msg.stop_reason}`);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('');
  const parsed = JSON.parse(text) as AnalystDecision;
  const { decision, dropped } = enforceDecision(parsed, input.checks);
  return { decision, dropped, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens }, model };
}
