/**
 * Pre-submission compliance SCANNER — "will this proposal get thrown out?"
 *
 * Takes the RFP's extracted compliance requirements + the user's draft/response
 * and flags the DQ mistakes BEFORE submission. Works on ANY proposal (Mindy-
 * drafted, user-written, about-to-submit) across LOI / RFP / IDIQ.
 *
 * Grounded in the #9 empirical analysis (docs/RFP-FORMAT-ANALYSIS.md): the real
 * DQ risks, by frequency, are submission deadline, submission method/portal,
 * set-aside eligibility, past performance, reps & certs / SAM — NOT page limits
 * (rare) or separate-price-volume (rare). So the checks are weighted to what
 * actually loses proposals.
 *
 * Per the #9 caveat, this does NOT use the rough analysis regexes for the real
 * check — it consumes the COMPLIANCE-EXTRACTION engine's structured requirements
 * (which already pull deadlines / page limits / required plans as discrete items)
 * and verifies the DRAFT against each. Deterministic where measurable; the caller
 * can layer an LLM pass for fuzzy "is this addressed" judgments.
 *
 * (Memory: proposal_assist_v1; builds on section-alignment + the compliance route.)
 */

import { alignMatrix, priorityOf, normalizeCategory, type ComplianceReq } from './section-alignment';

export type FindingSeverity = 'dq' | 'warning' | 'info';

export interface ScanFinding {
  /** Stable key for the rule that fired. */
  rule: string;
  severity: FindingSeverity;
  title: string;
  /** What's wrong + what to do about it. */
  detail: string;
  /** The requirement / source this traces to, when applicable. */
  requirement?: string;
  section?: string;
}

export interface ScanInput {
  /** Requirements extracted from the RFP (compliance route output). */
  requirements: ComplianceReq[];
  /** The user's full proposal/response text (all sections concatenated). */
  draftText: string;
  /** Optional per-section drafts (label → text) for finer coverage checks. */
  sections?: Array<{ label: string; text: string }>;
  /** Bidder facts for eligibility checks (set-asides they actually hold). */
  bidderSetAsides?: string[];
}

export interface ScanResult {
  findings: ScanFinding[];
  counts: { dq: number; warning: number; info: number };
  /** True if any DQ-severity finding fired — "this could get thrown out." */
  atRisk: boolean;
}

const norm = (s: string) => (s || '').toLowerCase();

/** Rough page estimate from word count (~500 words/page, federal single-spaced ~450-550). */
function estPages(text: string): number {
  const words = (text.trim().match(/\S+/g) || []).length;
  return Math.max(1, Math.round(words / 500));
}

/** Pull an integer page limit from a requirement's text, if it states one. */
function extractPageLimit(text: string): number | null {
  const m = norm(text).match(/(?:not\s+to\s+exceed|maximum\s+of|up\s+to|limit(?:ed)?\s+(?:to|of))\s+(\d{1,3})\s*pages?|(\d{1,3})[- ]page\s+(?:limit|maximum)/);
  if (!m) return null;
  const n = parseInt(m[1] || m[2], 10);
  return Number.isFinite(n) ? n : null;
}

export function scanCompliance(input: ScanInput): ScanResult {
  const reqs = input.requirements.map((r) => ({ ...r, category: normalizeCategory(r.category, r.requirement) }));
  const draft = norm(input.draftText);
  const findings: ScanFinding[] = [];

  // --- 1. Submission deadline (#1 real DQ, 44%) ---
  const deadlineReq = reqs.find((r) => /due\s+(date|by)|response\s+date|no\s+later\s+than|closing\s+date|deadline|offers?\s+due/i.test(r.requirement));
  if (deadlineReq) {
    findings.push({
      rule: 'deadline_awareness', severity: 'warning',
      title: 'Confirm the submission deadline',
      detail: 'This RFP states a hard submission deadline. A late proposal is rejected unread — verify the exact date/time/timezone and your submission buffer.',
      requirement: deadlineReq.requirement, section: deadlineReq.section,
    });
  }

  // --- 2. Submission method / portal (36%) ---
  const methodReq = reqs.find((r) => /submit\s+(via|to|through)|email\s+(to|your)|via\s+(the\s+)?(portal|sam\.gov|piee|email)|electronic\s+submission|upload/i.test(r.requirement));
  if (methodReq) {
    findings.push({
      rule: 'submission_method', severity: 'warning',
      title: 'Submit through the exact method specified',
      detail: 'A proposal sent to the wrong portal/email is non-responsive. Confirm the method and any registration (PIEE/SAM) needed to submit.',
      requirement: methodReq.requirement, section: methodReq.section,
    });
  }

  // --- 3. Set-aside eligibility (26%) — a real DQ if you don't hold it ---
  const setAsideReq = reqs.find((r) => /set[- ]aside|8\(a\)|sdvosb|hubzone|wosb|edwosb|small\s+business\s+set/i.test(r.requirement));
  if (setAsideReq) {
    const held = (input.bidderSetAsides || []).map(norm);
    const needed = (norm(setAsideReq.requirement).match(/8\(a\)|sdvosb|hubzone|edwosb|wosb/g) || []);
    const eligible = needed.length === 0 || needed.some((n) => held.some((h) => h.includes(n.replace(/[()]/g, '')) || n.includes(h)));
    findings.push({
      rule: 'set_aside_eligibility', severity: eligible ? 'info' : 'dq',
      title: eligible ? 'Set-aside: confirm your certification is active' : 'Set-aside eligibility gap',
      detail: eligible
        ? 'This is a set-aside. Confirm your certification is active in SAM before bidding.'
        : `This is set aside for ${needed.join(', ')}. Your profile does not show that certification — bidding without it gets the offer thrown out.`,
      requirement: setAsideReq.requirement, section: setAsideReq.section,
    });
  }

  // --- 4. Required plans named in the RFP but MISSING from the draft (DQ) ---
  const planChecks: Array<{ key: string; re: RegExp; name: string }> = [
    { key: 'qcp', re: /quality\s+control\s+plan|\bqcp\b/i, name: 'Quality Control Plan' },
    { key: 'safety', re: /safety\s+plan|accident\s+prevention\s+plan|\bapp\b|em\s?385/i, name: 'Safety / Accident Prevention Plan' },
  ];
  for (const p of planChecks) {
    const required = reqs.some((r) => p.re.test(r.requirement));
    if (required && !p.re.test(draft)) {
      findings.push({
        rule: `missing_plan_${p.key}`, severity: 'dq',
        title: `Required ${p.name} not found in your response`,
        detail: `The RFP requires a ${p.name}, but your draft doesn't appear to include one. Add it (or attach it) — a missing mandatory plan is a common disqualifier.`,
      });
    }
  }

  // --- 5. Reps & certs / SAM registration (20%) ---
  const repsReq = reqs.find((r) => /representations?\s+and\s+certifications?|reps\s+and\s+certs|52\.204-8|52\.212-3|sam\.gov/i.test(r.requirement));
  if (repsReq && !/sam\.gov|reps?\s+and\s+certs?|representations?\s+and\s+certifications?|52\.212-3/i.test(draft)) {
    findings.push({
      rule: 'reps_certs', severity: 'warning',
      title: 'Confirm reps & certs / active SAM registration',
      detail: 'This RFP requires representations & certifications (or active SAM registration). Confirm yours are current — an expired SAM registration makes you ineligible for award.',
      requirement: repsReq.requirement, section: repsReq.section,
    });
  }

  // --- 6. Page limit exceeded (real but RARER — measured, not assumed) ---
  for (const r of reqs) {
    const limit = extractPageLimit(r.requirement);
    if (limit) {
      const pages = estPages(input.draftText);
      if (pages > limit) {
        findings.push({
          rule: 'page_limit_exceeded', severity: 'dq',
          title: `Over the ${limit}-page limit (~${pages} pages)`,
          detail: `The RFP imposes a ${limit}-page limit; your draft is roughly ${pages} pages. Evaluators stop reading at the limit — trim before submitting.`,
          requirement: r.requirement, section: r.section,
        });
      }
    }
  }

  // --- 7. Evaluation-factor coverage: a Section M factor with NO response section ---
  // alignMatrix buckets each requirement to a target draft section; an evaluation
  // requirement whose target content isn't present in the draft is an unaddressed
  // factor — you can't win on a factor you didn't write to.
  if (input.sections?.length) {
    const align = alignMatrix(reqs);
    const evalReqs = reqs.filter((r) => r.category === 'evaluation' || /evaluat|\bsection\s+m\b|award\s+(will\s+be\s+)?based/i.test(r.requirement));
    const draftAll = input.sections.map((s) => norm(s.text)).join(' ');
    for (const er of evalReqs.slice(0, 8)) {
      // crude keyword presence: are the requirement's significant words in the draft?
      const words = norm(er.requirement).match(/[a-z]{5,}/g) || [];
      const sig = words.filter((w) => !['shall', 'offeror', 'proposal', 'evaluation', 'factor', 'submit'].includes(w));
      const hit = sig.filter((w) => draftAll.includes(w)).length;
      if (sig.length >= 3 && hit / sig.length < 0.3) {
        findings.push({
          rule: 'unaddressed_eval_factor', severity: 'warning',
          title: 'Possible unaddressed evaluation factor',
          detail: `Your response doesn't clearly address: "${er.requirement.slice(0, 90)}". You're scored on this — make sure a section speaks to it.`,
          requirement: er.requirement, section: er.section,
        });
      }
    }
    void align; // reserved for future per-section coverage display
  }

  // --- 8. Amendment acknowledgment (rare but absolute) ---
  const amendReq = reqs.find((r) => /acknowledge\s+(receipt\s+of\s+)?(all\s+)?amendments?|amendment\s+acknowledg|sf\s?30/i.test(r.requirement));
  if (amendReq && !/amendment|sf\s?30|acknowledg/i.test(draft)) {
    findings.push({
      rule: 'amendment_ack', severity: 'warning',
      title: 'Acknowledge all amendments',
      detail: 'The RFP requires acknowledging every amendment (SF30). Failing to acknowledge an amendment can make your offer non-responsive.',
      requirement: amendReq.requirement, section: amendReq.section,
    });
  }

  // Rank: DQ first, then warning, then info; stable within tier.
  const order: Record<FindingSeverity, number> = { dq: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const counts = {
    dq: findings.filter((f) => f.severity === 'dq').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  return { findings, counts, atRisk: counts.dq > 0 };
}
