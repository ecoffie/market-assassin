/**
 * Buyer (agency) predicate — WHOLE-TERM identity matching, never substrings.
 *
 * Measured 2026-09-22: MCP `find_opportunities(agency:"USDA")` returned 4,901 Open notices against
 * 222 real USDA notices. resolveBuyerIdentity('USDA') emits the sibling alias `AG`, and the shared
 * agencyOrExpr matches every needle as `%needle%` ILIKE — so `AG` matched "Defense Logistics
 * AGency", DISA, DHA, FEMA. 140 of 457 alias keys carry a ≤3-letter sibling (VETERANS→VA matches
 * NAVAL / NEVADA; EDUCATION→ED). The alias table is fine; the MATCH was wrong.
 *
 * Rule: each needle is reduced to its identity words (dropping "department", "of", "the", …) and a
 * column matches the needle only if EVERY identity word appears as a whole word. Word order is free
 * because SAM writes "AGRICULTURE, DEPARTMENT OF" where USASpending writes "Department of
 * Agriculture". A needle with no identity words left is dropped (it could only match everything).
 */
import { resolveBuyerIdentity } from '@/lib/opportunities/market-interpretation';
import { imatchClause } from './matcher';

const NON_IDENTITY = new Set(['department', 'dept', 'of', 'the', 'and', 'u', 's', 'us', 'for', 'office']);

export interface ResolvedBuyer {
  requested: string;
  canonical: string | null;
  kind: string;
  /** Needles after resolution (MCP's alias normalization). */
  needles: string[];
  /** Identity word-sets actually matched (one set per needle, ANDed within, ORed across). */
  identity: string[][];
}

function identityWords(needle: string): string[] {
  return String(needle || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NON_IDENTITY.has(w));
}

export function resolveBuyer(requested: string): ResolvedBuyer {
  const b = resolveBuyerIdentity(requested);
  const needles = b.needles.length ? b.needles : [requested];
  const seen = new Set<string>();
  const identity: string[][] = [];
  for (const n of needles) {
    const w = identityWords(n);
    const k = [...w].sort().join(' ');
    if (!w.length || seen.has(k)) continue;
    seen.add(k);
    identity.push(w);
  }
  return { requested, canonical: b.canonical, kind: b.kind, needles, identity };
}

/** One PostgREST `.or()` body over the buyer columns. Null when there is nothing to match on. */
export function buyerPredicate(buyers: ResolvedBuyer[], cols: readonly string[]): string | null {
  const parts: string[] = [];
  for (const b of buyers) {
    for (const words of b.identity) {
      for (const c of cols) {
        const clauses = words.map((w) => imatchClause(c, `\\m${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\M`));
        parts.push(clauses.length === 1 ? clauses[0] : `and(${clauses.join(',')})`);
      }
    }
  }
  return parts.length ? parts.join(',') : null;
}

/** JS mirror (tests + inspection): does an agency string belong to any of these buyers? */
export function buyerMatches(buyers: ResolvedBuyer[], texts: Array<string | null | undefined>): boolean {
  return buyers.some((b) => b.identity.some((words) =>
    texts.some((t) => words.every((w) => new RegExp(`\\b${w}\\b`, 'i').test(String(t || '')))),
  ));
}
