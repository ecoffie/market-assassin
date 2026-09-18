/**
 * Deterministic first-turn routing for solicitation intents.
 *
 * CURRENT_FIND → find_opportunities (Potato P2).
 * KNOWN_ID / HISTORICAL → lookup_solicitation (short-circuit FIND).
 *
 * Pure. No I/O. Host instructions must obey this classifier.
 */
import { isNoticeUuid, isSolicitationIdentifier } from '@/lib/sam/resolve-solicitation';

export type SolicitationIntent = 'KNOWN_ID' | 'HISTORICAL' | 'CURRENT_FIND';

export type FirstTurnTool = 'lookup_solicitation' | 'find_opportunities';

/** Agency / jargon acronyms that are NOT a named solicitation program. */
const AGENCY_OR_JARGON_ACRONYM = new Set([
  'VA', 'IT', 'SAM', 'RFP', 'RFQ', 'RFI', 'NAICS', 'PSC', 'DOD', 'DOE', 'DHS', 'DOJ',
  'DON', 'GSA', 'NASA', 'NIH', 'NSF', 'EPA', 'USDA', 'DLA', 'DISA', 'SOCOM', 'NAVY',
  'ARMY', 'USAF', 'USMC', 'CNO', 'CEMA', 'ATO', 'FCL', 'IDIQ', 'FFP', 'POC', 'PDF',
  'USA', 'USD', 'OSBP', 'SBIR', 'STTR', 'OT', 'PAE', 'CAI', 'MCP',
]);

const HISTORICAL_RE = [
  /\bsubmitted\b/i,
  /\bbid\b/i,
  /\bproposal\b/i,
  /\bworked on\b/i,
  /\bwhat happened\b/i,
  /\bprevious\b/i,
  /\bold\b/i,
  /\brecently\b/i,
  /\blast month\b/i,
  /\blast week\b/i,
  /\bthe solicitation we\b/i,
  /\bthe bid we\b/i,
  /\bwe bid\b/i,
  /\bi bid\b/i,
  /\bwe submitted\b/i,
  /\bi submitted\b/i,
];

const CURRENT_FIND_RE = [
  /\bsell\b/i,
  /\bopportunities\b/i,
  /\bavailable\b/i,
  /\bwhere'?s the money\b/i,
  /\bwant to work with\b/i,
  /\bhelp me\b/i,
  /\bwhere do i start\b/i,
];

export function extractIdentifierTokens(raw: string): string[] {
  const out: string[] = [];
  for (const tok of String(raw || '').split(/[\s,;:()]+/)) {
    const t = tok.trim().replace(/[.,!?]+$/g, '');
    if (!t) continue;
    if (isNoticeUuid(t) || isSolicitationIdentifier(t)) out.push(t);
  }
  return out;
}

function hasHistoricalSignal(q: string): boolean {
  return HISTORICAL_RE.some((re) => re.test(q));
}

function hasCurrentFindSignal(q: string): boolean {
  return CURRENT_FIND_RE.some((re) => re.test(q));
}

/** ALL-CAPS 3–8 letter token that is not an agency/jargon acronym. */
export function namedProgramTokens(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(raw || '').matchAll(/\b[A-Z]{3,8}\b/g)) {
    const tok = m[0];
    if (AGENCY_OR_JARGON_ACRONYM.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

export function classifySolicitationIntent(raw: string): SolicitationIntent {
  const q = String(raw || '').trim();
  if (!q) return 'CURRENT_FIND';
  if (extractIdentifierTokens(q).length) return 'KNOWN_ID';
  if (hasHistoricalSignal(q)) return 'HISTORICAL';
  // Named program lookup without a market-hunt ("Find MASA opportunities").
  if (namedProgramTokens(q).length && !/\bsell\b/i.test(q) && !/\bwant to work with\b/i.test(q) && !/\bwhere'?s the money\b/i.test(q)) {
    return 'HISTORICAL';
  }
  if (hasCurrentFindSignal(q)) return 'CURRENT_FIND';
  return 'CURRENT_FIND';
}

export function firstTurnToolFor(raw: string): FirstTurnTool {
  return classifySolicitationIntent(raw) === 'CURRENT_FIND'
    ? 'find_opportunities'
    : 'lookup_solicitation';
}
