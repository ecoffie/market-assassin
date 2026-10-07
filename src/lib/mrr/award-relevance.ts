/**
 * Is a buyer-history award the requested kind of work, or another purchase by
 * the same office?
 *
 * Buyer history is retrieved by awarding-office code and, when supplied, the
 * requirement's NAICS/PSC. A code match says how the office CLASSIFIED the
 * purchase; it does not show what was bought. The award description does. So
 * every award states its basis plainly:
 *
 *   description — the description names the requirement ("GROUNDS MAINTENANCE")
 *   code        — matched on NAICS/PSC only; the description does not mention it
 *   none        — neither: another purchase by this office
 *
 * Never inferred beyond the words actually present.
 */

export type RelevanceBasis = 'description' | 'code' | 'none';

export interface AwardRelevance {
  basis: RelevanceBasis;
  /** Requirement words found in the description. */
  matchedTerms: string[];
  /** One sentence for the screen and the report. */
  label: string;
}

/** Words that describe almost any federal purchase — they never establish relevance. */
const GENERIC = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'services', 'service', 'support', 'maintenance',
  'general', 'management', 'operations', 'operation', 'work', 'works', 'various', 'misc',
  'miscellaneous', 'other', 'program', 'project', 'contract', 'requirement', 'requirements',
  'type', 'base', 'installation', 'facility', 'facilities',
]);

/** Distinctive requirement words: 4+ letters, or an upper-case acronym of 2–3 (e.g. "IT"). */
export function requirementTerms(requirement: string): string[] {
  const terms: string[] = [];
  for (const raw of requirement.split(/[^A-Za-z0-9-]+/)) {
    if (!raw) continue;
    const word = raw.replace(/-+$/, '');
    const acronym = /^[A-Z]{2,3}$/.test(word);
    if (!acronym && word.length < 4) continue;
    if (GENERIC.has(word.toLowerCase())) continue;
    const term = acronym ? word : word.toLowerCase();
    if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}

function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('s') && w.length > 4) return w.slice(0, -1);
  return w;
}

function mentions(description: string, term: string): boolean {
  if (/^[A-Z]{2,3}$/.test(term)) return new RegExp(`\\b${term}\\b`).test(description);
  const base = stem(term).replace(/[^a-z0-9-]/g, '');
  return new RegExp(`\\b${base}`, 'i').test(description);
}

export function awardRelevance(args: {
  description: string | null | undefined;
  awardNaics?: string | null;
  awardPsc?: string | null;
  requirement: string;
  requiredNaics?: string | null;
  requiredPsc?: string | null;
}): AwardRelevance {
  const description = (args.description ?? '').trim();
  const terms = requirementTerms(args.requirement);
  const matchedTerms = description ? terms.filter((t) => mentions(description, t)) : [];
  const codeParts: string[] = [];
  if (args.requiredNaics && args.awardNaics && args.awardNaics === args.requiredNaics) {
    codeParts.push(`NAICS ${args.requiredNaics}`);
  }
  if (args.requiredPsc && args.awardPsc && args.awardPsc.toUpperCase() === args.requiredPsc.toUpperCase()) {
    codeParts.push(`PSC ${args.requiredPsc.toUpperCase()}`);
  }
  const codes = codeParts.join(' and ');

  if (matchedTerms.length) {
    const quoted = matchedTerms.map((t) => `“${t}”`).join(', ');
    return {
      basis: 'description',
      matchedTerms,
      label: `Relevant: the award description mentions ${quoted}${codes ? `; coded ${codes}` : ''}.`,
    };
  }
  if (codes) {
    return {
      basis: 'code',
      matchedTerms,
      label: description
        ? `Coded ${codes}, but the award description does not mention the requirement — check that it is the same kind of work.`
        : `Coded ${codes}; the source gave no description to confirm the work.`,
    };
  }
  return {
    basis: 'none',
    matchedTerms,
    label: 'Another purchase by this office: neither the description nor the codes match the requirement.',
  };
}
