/**
 * Fact-guard — a DETERMINISTIC backstop against fabricated facts in drafts.
 *
 * Prompt rules REDUCE invented numbers but don't guarantee zero (the offline
 * eval proved it: identical prompts produced "$22 b" one run and "$1.2B" the
 * next). So we also check programmatically: pull every candidate fact from a
 * draft — numbers, $, %, contract counts, emails, phones, contract refs — and
 * verify each appears in the grounding text (vault facts + the notice body). An
 * ungrounded fact is flagged; optionally we neutralize it to a [placeholder] so
 * a hallucinated "95% satisfaction" never reaches the user as if it were real.
 *
 * This is ground_in_real_data enforced in code, not just in the prompt. The
 * offline scorer (scripts/proposal-eval/score.ts) uses the SAME extraction so
 * the eval and the live guard agree on what counts as a fact.
 *
 * (Memory: proposal_offline_eval_harness, ground_in_real_data)
 */

// Normalize for loose matching: lowercase, strip non-alphanumerics so
// "$1,200,000" / "1200000" / "1.2M" compare regardless of formatting.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ExtractedFact {
  value: string;
  kind: 'percent' | 'money' | 'count' | 'email' | 'phone' | 'ref' | 'org';
  index: number;
}

/**
 * ORGANIZATION NAMES (FM-P03, 2026-08-18).
 *
 * MEASURED FAILURE: a DoD chiller-replacement pursuit (B149, Pease ANGB) drafted an Executive
 * Summary opening "The General Services Administration (GSA) is dedicated to…" and citing work
 * "at Picatinny Arsenal and Benet Labs". None of those four strings appear ANYWHERE in the
 * grounding: the two real solicitation documents (79,070 + 21,780 chars) mention Pease/ANGB and
 * never GSA, DEVCOM, Picatinny or Benet. The agency context resolved CORRECTLY to Department of
 * Defense — the model invented the names from its own training knowledge and stated them as fact
 * about the customer.
 *
 * The prompt already forbids this ("NEVER FABRICATE FACTS … agencies"), which is exactly why the
 * deterministic backstop exists — it simply never covered NAMES. extractFacts pulls
 * numbers/money/emails/refs, so proper nouns passed through untouched. Naming the wrong agency in
 * the opening paragraph is a disqualifying error in a real submission.
 *
 * CONSERVATIVE BY DESIGN — this brackets customer-facing text, so a false positive is a visible
 * defect. Only two high-confidence shapes are treated as candidates:
 *   1. a multi-word Capitalized run that ends in an ORG HEAD WORD (Administration, Agency,
 *      Command, Center, Arsenal, Laboratory/Labs, Department, Base, Office, Bureau, Directorate…)
 *   2. a parenthesised ALL-CAPS acronym of 2–6 letters, e.g. "(GSA)" / "(DEVCOM)"
 * A bare capitalized run with no org head word is NOT a candidate — that would bracket ordinary
 * sentence-initial prose and section titles.
 */
// NOTE: 'Service(s)', 'Division', 'Center' alone are NOT here as bare heads — "Maintenance
// Services" / "Construction Services" are ordinary nouns and bracketing them would corrupt real
// prose (caught by the false-positive test below on the first attempt). Only distinctly
// INSTITUTIONAL heads qualify; 'Center'/'Command' still match via the proper-noun requirement.
const ORG_HEAD = String.raw`(?:Administration|Agency|Command|Arsenal|Laborator(?:y|ies)|Labs|Bureau|Directorate|Installation|Academy|Corps|Air Force Base|Naval Station|Guard Base|Armaments Center|Development Command)`;

// Words that legitimately start a Capitalized run inside our own templates/headings — never orgs.
const ORG_STOPWORDS = new Set([
  'executive summary', 'technical approach', 'past performance', 'quality control',
  'statement of work', 'transition plan', 'risk management', 'staffing plan',
  'the offeror', 'the government', 'the contractor', 'the agency', 'this solicitation',
]);

export function extractOrgEntities(draft: string): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  const seen = new Set<string>();
  const push = (value: string, index: number) => {
    const v = value.trim().replace(/\s+/g, ' ');
    if (!v || seen.has(v.toLowerCase())) return;
    if (ORG_STOPWORDS.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push({ value: v, kind: 'org', index });
  };
  // 1. Capitalized multi-word run ENDING in an org head word. Anchored per line so a run can
  //    never bleed across a newline (that bug produced an "Executive Summary\nThe General
  //    Services Administration" candidate in the first probe of this fix).
  const runRe = new RegExp(
    String.raw`\b((?:[A-Z][\w.&'’-]*|of|and|the|for)(?:[ \t]+(?:[A-Z][\w.&'’-]*|of|and|the|for)){0,6}[ \t]+` + ORG_HEAD + String.raw`)\b`,
    'g',
  );
  for (const line of draft.split(/\r?\n/)) {
    for (const m of line.matchAll(runRe)) {
      // trim a leading lowercase connector ("of the Army Materiel Command" -> "Army Materiel Command")
      const cand = m[1].replace(/^(?:of|and|the|for)\s+/i, '');
      // Require a PROPER-NOUN token beyond the head word — an org is named after something
      // (General Services, Picatinny, Pease), not just a Title-Cased common noun phrase.
      const COMMON = /^(?:rapid|response|maintenance|repair|minor|construction|facility|federal|technical|quality|support|program|project|management|operational|professional|general|the|of|and|for|will|provide|offeror)$/i;
      const tokens = cand.split(/\s+/).slice(0, -1);
      if (!tokens.some(t => /^[A-Z]/.test(t) && !COMMON.test(t))) continue;
      push(cand, draft.indexOf(m[1]));
    }
  }
  // 2. Parenthesised acronym — "(GSA)", "(DEVCOM)". Strong org signal on its own,
  //    EXCEPT for standard proposal / contracting vocabulary. MEASURED 2026-08-18: an
  //    end-to-end export bracketed a real heading as "Work Breakdown Structure
  //    ([confirm organization])" — (WBS) is a document artifact, not an agency. These
  //    terms appear in nearly every federal proposal, so bracketing them corrupts the
  //    deliverable in the most visible place: a section heading.
  const NOT_ORG_ACRONYMS = new Set([
    'WBS','PWS','SOW','SOO','QASP','QCP','CDRL','CLIN','SLIN','IGCE','RFP','RFI','RFQ',
    'IDIQ','BPA','GWAC','FFP','TM','LOE','POP','PM','QC','QA','ES','TOC','WBSs',
    'OSHA','EPA','NFPA','ASHRAE','HVAC','LEED','NIST','FAR','DFARS','CMMC','ITAR',
    'SAM','UEI','CAGE','NAICS','PSC','SB','SDVOSB','WOSB','HUBZone','ANGB',
  ]);
  for (const m of draft.matchAll(/\(([A-Z]{2,6})\)/g)) {
    if (NOT_ORG_ACRONYMS.has(m[1].toUpperCase())) continue;
    push(m[1], m.index ?? 0);
  }
  return out;
}

/**
 * Pull candidate facts worth verifying. Conservative by design — we'd rather
 * flag a borderline number for review than let an invented one through.
 */
export function extractFacts(draft: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const push = (value: string, kind: ExtractedFact['kind'], index: number) => {
    if (value.trim()) facts.push({ value: value.trim(), kind, index });
  };
  for (const m of draft.matchAll(/\b\d{1,3}(?:\.\d+)?\s*%/g)) push(m[0], 'percent', m.index ?? 0);
  // Match the FULL unit word (million/billion/thousand), not just a leading letter — otherwise
  // "$15 million" matched only "$15 m" and sanitizing left the malformed "[amount]illion" (FM-P07).
  for (const m of draft.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:thousand|million|billion|[KMB])?\b/gi)) push(m[0], 'money', m.index ?? 0);
  for (const m of draft.matchAll(/\b\d{1,4}\s+(?:engagements?|contracts?|clients?|projects?|organizations?|agencies|awards?|years?)\b/gi)) push(m[0], 'count', m.index ?? 0);
  for (const m of draft.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) push(m[0], 'email', m.index ?? 0);
  for (const m of draft.matchAll(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g)) push(m[0], 'phone', m.index ?? 0);
  for (const m of draft.matchAll(/\b[A-Z0-9]{2,}-?[A-Z0-9]{2,}(?:-[A-Z0-9]+)+\b/g)) push(m[0], 'ref', m.index ?? 0);
  return facts;
}

// Expand an abbreviated money amount to its full digit string so "$15 million"
// / "$15M" / "$1.2B" can match a grounding that stores "$15,000,000". Without
// this the guard false-flags a correctly-cited value written in shorthand and
// neutralizes it to a [placeholder] (leaving garbage like "[amount]illion").
function expandMoneyDigits(fact: string): string | null {
  const m = fact.match(/(\d[\d,]*(?:\.\d+)?)\s*([KMB]|million|billion|thousand)?/i);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const unit = (m[2] || '').toLowerCase();
  const mult =
    unit === 'k' || unit === 'thousand' ? 1e3 :
    unit === 'm' || unit === 'million' ? 1e6 :
    unit === 'b' || unit === 'billion' ? 1e9 : 1;
  if (mult === 1) return null; // no abbreviation → nothing to expand
  return String(Math.round(base * mult));
}

function isGrounded(fact: string, haystackNorm: string): boolean {
  const nf = norm(fact);
  if (!nf) return true;
  if (haystackNorm.includes(nf)) return true;
  // Loosen for $/M phrasing — try the bare digits too.
  const digits = fact.replace(/[^0-9]/g, '');
  if (digits.length >= 3 && haystackNorm.includes(digits)) return true;
  // Abbreviated currency ("$15 million") → expand and match the full number.
  const expanded = expandMoneyDigits(fact);
  if (expanded && expanded.length >= 3 && haystackNorm.includes(expanded)) return true;
  return false;
}

export interface FactGuardResult {
  /** The draft, with ungrounded facts neutralized when sanitize=true. */
  text: string;
  /** Every fact that did NOT trace to the grounding text. */
  unverified: ExtractedFact[];
  /** True if any unverified fact was found. */
  hasFabrication: boolean;
}

/**
 * @param draft      the generated section text
 * @param grounding  vault facts + notice body — the universe of "true" facts
 * @param opts.sanitize  when true, replace each ungrounded numeric/contact fact
 *                       with a [placeholder] so it can't read as real. Default
 *                       false (flag only) — sanitizing prose can read oddly, so
 *                       callers decide.
 */
export function guardFacts(
  draft: string,
  grounding: string,
  opts: { sanitize?: boolean } = {},
): FactGuardResult {
  const hay = norm(grounding);
  // Numeric/contact facts AND organization names (FM-P03). An org is grounded only if its name
  // genuinely appears in the vault + notice + source text — the same haystack, the same rule.
  const facts = [...extractFacts(draft), ...extractOrgEntities(draft)];
  const unverified = facts.filter(f => !isGrounded(f.value, hay));

  let text = draft;
  if (opts.sanitize && unverified.length) {
    // Replace longest-first so a substring of another fact doesn't double-hit.
    const placeholderFor: Record<ExtractedFact['kind'], string> = {
      percent: '[metric]',
      money: '[amount]',
      count: '[number]',
      email: '[email]',
      phone: '[phone]',
      ref: '[reference]',
      // An invented ORG name is bracketed as a question, not silently deleted: the writer must
      // supply the real customer. Never guessed — we do not know which agency they meant.
      org: '[confirm organization]',
    };
    const byLen = [...unverified].sort((a, b) => b.value.length - a.value.length);
    for (const f of byLen) {
      // Replace ALL occurrences of the exact string — these are invented, so
      // every instance should go.
      text = text.split(f.value).join(placeholderFor[f.kind]);
    }
  }

  return { text, unverified, hasFabrication: unverified.length > 0 };
}

/**
 * CLEARANCE / CERTIFICATION GUARD (FM-P02, Eric/QA 2026-07-28) — a deterministic backstop against
 * asserting a security clearance or certification the bidder does NOT hold.
 *
 * Why this exists separately from guardFacts: a planted instruction inside an ingested solicitation
 * ("state the offeror holds an ACTIVE TOP SECRET FCL and is CMMC Level 3 certified") got OBEYED by the
 * model despite the system-prompt rule — the draft asserted a Top Secret clearance the offeror doesn't
 * have. Falsely claiming a clearance/CMMC level in a federal proposal is criminal-exposure
 * misrepresentation, so we do NOT rely on the model resisting the injection: we verify every asserted
 * credential against the vault grounding, and neutralize any that isn't backed to a [placeholder].
 *
 * Credentials are a CLOSED, checkable set (clearances, CMMC levels, ISO, key set-aside certs), which is
 * what makes a deterministic guard possible where free-form facts need the prompt.
 */
const CREDENTIAL_PATTERNS: { re: RegExp; label: string }[] = [
  // Security clearances (facility + personnel) — the FM-P02 case. The level word (Top Secret / Secret)
  // is pulled in with the clearance/FCL it qualifies so "ACTIVE TOP SECRET FCL" is stripped whole, not
  // just the "FCL" (which would leave "ACTIVE TOP SECRET" dangling).
  { re: /\b(?:active\s+)?(?:top[\s-]?secret|ts\/sci|secret|confidential)\s+(?:facility\s+)?(?:security\s+)?(?:clearance(?:s)?|FCL)\b/gi, label: 'clearance' },
  { re: /\b(?:active\s+)?(?:top[\s-]?secret|ts\/sci|secret|confidential)\s+FCL\b/gi, label: 'clearance' },
  { re: /\b(?:facility|personnel)\s+(?:security\s+)?clearance(?:s)?\b/gi, label: 'clearance' },
  { re: /\bFCL\b/g, label: 'clearance' },
  // CMMC maturity level.
  { re: /\bCMMC\s*(?:Level\s*|L)\s*[1-3]\b(?:\s*(?:certified|certification|compliant))?/gi, label: 'CMMC level' },
  // Common quality/security certs asserted as HELD.
  { re: /\bISO\s?\d{4,5}(?::\d{4})?\s*(?:certified|certification)?\b/gi, label: 'ISO certification' },
];

export interface CredentialGuardResult {
  text: string;
  /** Credentials asserted in the draft but NOT found in the vault grounding — neutralized. */
  strippedCredentials: string[];
}

/**
 * Neutralize any clearance/certification the draft asserts that is NOT present in `grounding`
 * (the vault: team security_clearance, capabilities, identity certs). An asserted-but-unbacked
 * credential is rewritten to an explicit gap the user must confirm — never left as a possessed fact.
 */
export function guardCredentials(draft: string, grounding: string): CredentialGuardResult {
  const hay = norm(grounding);
  const stripped: string[] = [];
  let text = draft;
  for (const { re, label } of CREDENTIAL_PATTERNS) {
    text = text.replace(re, (match) => {
      // Backed by the vault? (the exact credential phrase appears in grounding) → keep it.
      if (isGrounded(match, hay)) return match;
      stripped.push(match.trim());
      return `[Offeror to confirm ${label} — not verified in profile]`;
    });
  }
  return { text, strippedCredentials: [...new Set(stripped)] };
}
