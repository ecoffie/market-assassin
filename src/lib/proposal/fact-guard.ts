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
  kind: 'percent' | 'money' | 'count' | 'email' | 'phone' | 'ref';
  index: number;
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
  for (const m of draft.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:[KMB]|million|billion)?/gi)) push(m[0], 'money', m.index ?? 0);
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
  const facts = extractFacts(draft);
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
