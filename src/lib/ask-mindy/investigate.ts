/**
 * Investigate This Opportunity: a sourced recommendation for ONE opportunity and ONE company.
 * Pure: no I/O, no model call, not wired into the chat route.
 *
 * Input: the deep-dive facts (composeDeepDive: notice, incumbent, steps not checked), the company's fit profile
 * (null when the company is unknown) and, optionally, opportunity fields the notice lookup does not carry
 * (set-aside, value, place of performance) when the opportunity came from a find_opportunities row.
 *
 * Output: PURSUE, WATCH, TEAM or PASS, each with reasons, risks, missing evidence and one next action. Every reason
 * and risk names the tool its fact came from.
 *
 * The rules are deterministic, so the answer model states the recommendation and never makes it:
 *   - The notice was not found, is ambiguous or the lookup failed → UNDETERMINED. Nothing is investigated from a guess.
 *   - Responses are closed → PASS on this notice, or WATCH (for the follow-on) when the work fits the company.
 *   - The company or its work is unknown (fit unscored) → UNDETERMINED. Value first: the facts are still given, and
 *     completing the profile is offered as the next action, never required before the answer.
 *   - The company lacks the required certification (fit route subcontract) → TEAM when the work matches, otherwise PASS.
 *   - Fit band show → PURSUE. With fewer than MIN_DAYS_TO_PURSUE days left, or with low confidence, it is WATCH.
 *   - Fit band related → WATCH. Fit band hidden → PASS. Work known NOT to match (capability 0) → PASS, whatever
 *     the timing and set-aside points add up to: they can lift a non-match into the related band on their own.
 *   - A closed notice's fit is judged on the work alone, since the scorer hides a passed deadline.
 * UNDETERMINED is not one of the four: it is the honest answer when the evidence cannot support any of them.
 */
import { scoreFit, WEIGHTS, type FitProfile, type FitResult, type FitScore, type FactorId } from '@/lib/fit/fit-scorer';
import type { DeepDiveContext } from './compose';

export type Verdict = 'PURSUE' | 'WATCH' | 'TEAM' | 'PASS' | 'UNDETERMINED';
export type Confidence = 'high' | 'medium' | 'low';

/** The tool (or Mindy computation) a statement rests on. */
export type EvidenceSource = 'lookup_solicitation' | 'get_solicitation_incumbent' | 'fit_scorer' | 'company_profile';

export interface Sourced { text: string; source: EvidenceSource }

export interface Investigation {
  verdict: Verdict;
  confidence: Confidence;
  reasons: Sourced[];
  risks: Sourced[];
  /** Things that could not be checked. Each one is unknown, never zero or "none". */
  missing_evidence: string[];
  next_action: string;
  /** The shared fit score the recommendation rests on (null when the fit could not be scored). Never printed. */
  fit: FitScore | null;
}

/** A show-band opportunity with fewer days than this to respond is WATCH: too little time to start a bid from zero. */
export const MIN_DAYS_TO_PURSUE = 3;
/** Days left at or below which the deadline is listed as a risk. */
export const TIGHT_DEADLINE_DAYS = 10;
/** A gated (subcontract-route) opportunity is TEAM only when at least this share of the work-match points is earned. */
export const TEAM_MIN_CAPABILITY_SHARE = 0.5;

const FACTOR_WORDS: Readonly<Record<FactorId, string>> = {
  capability: 'work match', past_performance: 'past performance', timing: 'timing', competition: 'competition',
  size: 'size', location: 'location', pathway: 'contract vehicle',
};

/** Opportunity fields the notice lookup does not return (from a find_opportunities row, when there is one). */
export type OpportunityExtras = Pick<FitResult, 'setAside' | 'fullAndOpen' | 'value' | 'state' | 'nationwide' | 'vehicle' | 'description'>;

function money(n: number): string {
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
}

/** The notice (plus any extras) as the fit scorer's input. Unknown fields stay absent. */
export function noticeToFitResult(n: DeepDiveContext['notice'], extras: Partial<OpportunityExtras> = {}): FitResult {
  return {
    kind: 'open',
    ...(n.title ? { title: n.title } : {}),
    ...(n.naics ? { naics: n.naics } : {}),
    ...(n.psc ? { psc: n.psc } : {}),
    ...(n.response_deadline ? { date: n.response_deadline, dateKind: 'response_deadline' as const } : {}),
    ...(n.buyer ? { buyerAgency: n.buyer } : {}),
    ...extras,
  };
}

function isClosed(n: DeepDiveContext['notice']): boolean {
  return n.status === 'closed' || n.status === 'archived' || (n.days_to_deadline !== undefined && n.days_to_deadline < 0)
    || (n.not_biddable === true && n.status !== 'unknown' && n.status !== undefined);
}

export function investigateOpportunity(input: {
  deepDive: DeepDiveContext;
  profile: FitProfile | null;
  extras?: Partial<OpportunityExtras>;
  nowMs?: number;
}): Investigation {
  const { deepDive, profile } = input;
  const n = deepDive.notice;
  const risks: Sourced[] = [];
  const missing: string[] = [];

  for (const s of deepDive.not_checked) {
    if (s.step === 'bid_decision') continue; // left to the answer turn by design; not missing evidence
    missing.push(`${s.step.replace(/_/g, ' ')} not checked (${s.state}: ${s.reason})`);
  }

  if (n.state !== 'found') {
    const why = n.state === 'not_found'
      ? 'Mindy could not find this solicitation, so there is nothing to investigate yet.'
      : n.state === 'ambiguous'
        ? `The identifier matches more than one notice${n.identifiers?.length ? ` (${n.identifiers.slice(0, 4).join(', ')})` : ''}.`
        : 'The solicitation lookup failed, so the notice could not be checked. This is not a "no".';
    return {
      verdict: 'UNDETERMINED', confidence: 'low', reasons: [{ text: why, source: 'lookup_solicitation' }], risks, missing_evidence: missing,
      next_action: n.state === 'ambiguous' ? 'Say which of the matching notices you mean.' : n.state === 'not_found' ? 'Check the solicitation number or paste the SAM.gov link.' : 'Ask again in a moment; the lookup did not complete.',
      fit: null,
    };
  }

  // Facts about the notice itself.
  const closed = isClosed(n);
  if (n.status === 'unknown' || n.status === undefined) risks.push({ text: 'Whether responses are still open could not be confirmed.', source: 'lookup_solicitation' });
  if (!closed && n.days_to_deadline === undefined) missing.push('response deadline not published in the notice data');
  if (!closed && n.days_to_deadline !== undefined && n.days_to_deadline <= TIGHT_DEADLINE_DAYS) {
    risks.push({ text: `${n.days_to_deadline} day${n.days_to_deadline === 1 ? '' : 's'} left to respond (deadline ${n.response_deadline}).`, source: 'lookup_solicitation' });
  }
  if (n.deadline_conflict) risks.push({ text: 'The published deadlines disagree; confirm the date in the latest amendment.', source: 'lookup_solicitation' });

  // Incumbent: named only when identified; otherwise the tool's own sentence is the missing evidence.
  const inc = deepDive.incumbent;
  if (inc.finding === 'identified' && inc.name) {
    const amt = inc.obligated ? `, ${money(inc.obligated)} obligated` : '';
    risks.push({ text: `Incumbent: ${inc.name}${inc.award_id ? ` (award ${inc.award_id}${amt})` : amt ? ` (${amt.slice(2)})` : ''}.`, source: 'get_solicitation_incumbent' });
  } else if (inc.absence_note) {
    missing.push(`incumbent: ${inc.absence_note}`);
  }

  // Fit for this company.
  // A closed notice is judged on the WORK (for the follow-on), not on its passed deadline, which the scorer hides.
  const fitNotice = closed ? { ...n, response_deadline: null } : n;
  const fit = profile ? scoreFit(noticeToFitResult(fitNotice, input.extras), profile, input.nowMs) : null;
  if (!profile) missing.push('company profile: who the company is and what it does is unknown');
  if (fit) {
    const unknownFactors = fit.factors.filter((f) => f.points === null).map((f) => FACTOR_WORDS[f.id]);
    if (unknownFactors.length) missing.push(`fit not checked for: ${unknownFactors.join(', ')}`);
    if (fit.evidenceNote) missing.push(fit.evidenceNote);
    if (input.extras?.setAside === undefined && !input.extras?.fullAndOpen) missing.push('set-aside not known, so eligibility was not checked');
  }

  let confidence = 'high' as Confidence; // widened: lowered inside the closure below
  const lower = (c: Confidence) => { if (c === 'low' || (c === 'medium' && confidence === 'high')) confidence = c; };
  if (n.status === 'unknown' || n.status === undefined || n.deadline_conflict) lower('low');
  if (!closed && n.days_to_deadline === undefined) lower('low');
  if (fit?.evidenceNote) lower('low');
  if (fit && fit.known_weight < 70) lower('medium');
  if (inc.finding !== 'identified' && inc.finding !== 'not_found') lower('medium');
  if (deepDive.not_checked.some((s) => s.step === 'documents')) lower('medium');

  const fitReasons = (fit?.reasons ?? []).map((t) => ({ text: t, source: 'fit_scorer' as const }));
  // Work that is known NOT to match is never WATCH or TEAM, however good the timing or set-aside points look.
  const noWorkMatch = fit?.factors.find((f) => f.id === 'capability')?.points === 0;
  const contact = n.contact?.email || n.contact?.name ? n.contact : null;
  const coLine = contact ? `the contracting contact${contact.name ? ` ${contact.name}` : ''}${contact.email ? ` (${contact.email})` : ''}` : 'the contracting office';
  const amendment = n.latest_amendment ? ` Read ${n.latest_amendment} first.` : '';
  const done = (verdict: Verdict, why: Sourced[], next: string): Investigation => ({
    verdict, confidence, reasons: why, risks, missing_evidence: missing, next_action: next, fit,
  });

  if (closed) {
    const why = { text: `Responses are closed (${n.status === 'archived' ? 'archived' : n.days_to_deadline !== undefined && n.days_to_deadline < 0 ? `deadline passed ${-n.days_to_deadline} days ago` : 'status closed'}).`, source: 'lookup_solicitation' as const };
    if (fit && !noWorkMatch && (fit.band === 'show' || fit.band === 'related')) {
      return done('WATCH', [why, ...fitReasons], 'Track the follow-on: ask Mindy to watch this buyer for the recompete.');
    }
    return done('PASS', [why], 'Skip this notice; ask Mindy for open work closer to what you do.');
  }

  if (!fit || fit.band === 'unscored') {
    confidence = 'low';
    return done('UNDETERMINED', [{ text: profile ? 'Not enough is known about your company to judge fit for this notice.' : 'Mindy does not know your company yet, so it cannot judge fit.', source: 'company_profile' }],
      'Add your work codes (NAICS) and what you do to your company profile so Mindy can judge fit. The notice facts above stand on their own.');
  }

  if (fit.route === 'subcontract') {
    const cap = fit.factors.find((f) => f.id === 'capability');
    const share = cap && cap.points !== null ? cap.points / WEIGHTS.capability : null;
    if (share !== null && share >= TEAM_MIN_CAPABILITY_SHARE) {
      return done('TEAM', [{ text: (fit.gate ?? 'subcontract route').replace(/^subcontract route: /, 'You cannot prime it: '), source: 'fit_scorer' }, ...fitReasons.filter((r) => !r.text.startsWith('subcontract route'))],
        `Find an eligible prime to team with before the deadline: ask Mindy for teaming partners on this notice.${amendment}`);
    }
    if (share === null) lower('low');
    return done('PASS', [{ text: (fit.gate ?? 'subcontract route').replace(/^subcontract route: /, 'You cannot prime it: '), source: 'fit_scorer' }, { text: share === null ? 'and how well the work matches yours could not be checked.' : 'and the work is not a close match to yours.', source: 'fit_scorer' }],
      'Skip this one; ask Mindy for work you can prime.');
  }

  if (noWorkMatch) {
    return done('PASS', [{ text: 'The work does not match what you do.', source: 'fit_scorer' }],
      'Skip this one; ask Mindy for opportunities closer to what you do.');
  }

  if (fit.band === 'show') {
    if (n.days_to_deadline !== undefined && n.days_to_deadline < MIN_DAYS_TO_PURSUE) {
      return done('WATCH', [...fitReasons, { text: `Only ${n.days_to_deadline} day${n.days_to_deadline === 1 ? '' : 's'} left to respond.`, source: 'lookup_solicitation' }],
        'Bid only if a response is already drafted; otherwise watch this buyer for the next one.');
    }
    if (confidence === 'low') {
      return done('WATCH', [...fitReasons, { text: 'It looks like a fit, but the evidence is too thin to recommend pursuing yet.', source: 'fit_scorer' }],
        `Confirm the scope and deadline in the solicitation documents, then decide.${amendment}`);
    }
    return done('PURSUE', fitReasons, `Read the solicitation documents and send ${coLine} any question before the deadline${n.response_deadline ? ` (${n.response_deadline})` : ''}.${amendment}`);
  }

  if (fit.band === 'related') {
    return done('WATCH', [...fitReasons, { text: 'It is a partial match to your work.', source: 'fit_scorer' }],
      `Check the scope in the solicitation documents before spending time on a bid.${amendment}`);
  }

  return done('PASS', [{ text: fit.hiddenBecause ?? 'It is not a close match to your work.', source: 'fit_scorer' }],
    'Skip this one; ask Mindy for opportunities closer to what you do.');
}

/** The system note an answer is written from. The model states the recommendation; it never changes it. */
export function investigationNote(inv: Investigation): string {
  const lines = [
    "INVESTIGATION (computed for this company by Mindy from the tool evidence in this turn; state the recommendation exactly as given, never upgrade or soften it, never print a score):",
    `Recommendation: ${inv.verdict === 'UNDETERMINED' ? 'NOT ENOUGH EVIDENCE TO RECOMMEND (say so plainly; do not pick PURSUE, WATCH, TEAM or PASS)' : inv.verdict} · confidence ${inv.confidence}`,
    ...(inv.reasons.length ? ['Why:', ...inv.reasons.map((r) => `- ${r.text} [${r.source}]`)] : []),
    ...(inv.risks.length ? ['Risks:', ...inv.risks.map((r) => `- ${r.text} [${r.source}]`)] : []),
    ...(inv.missing_evidence.length ? ['Missing evidence (unknown, not zero or "none"; say what is missing):', ...inv.missing_evidence.map((m) => `- ${m}`)] : []),
    `Next action: ${inv.next_action}`,
    'Name an incumbent only if it is listed under Risks. Do not add facts that are not above or in the tool results.',
  ];
  return lines.join('\n');
}
