/**
 * How the CURRENT award was competed — read from the award's own USASpending record, never inferred
 * (Ask Mindy quality round, 2026-11-16).
 *
 * Why: a Coming back row only tells a customer "this contract ends soon". It does not say whether an
 * outside small business could realistically win the follow-on. The Florida janitorial answer ranked
 * seven AbilityOne nonprofit contracts first and labelled the largest "Full and open" — USASpending
 * records it as NOT COMPETED (only one source) with the holder flagged "AbilityOne Program
 * Participant". Genco's FL contract is an 8(a) SOLE SOURCE, "not available for competition".
 *
 * Rules (each fact traces to a field on the award record):
 *   - The class comes from FPDS `extent_competed` (+ the set-aside description for 8(a) sole source).
 *   - AbilityOne is stated only when the RECIPIENT carries the "AbilityOne Program Participant"
 *     business category on that award.
 *   - Missing record / failed call / unrecognised code → 'unknown'. Never "competed" by default
 *     (absent ≠ unrestricted), and never zero.
 *   - It describes how the CURRENT award was made. The follow-on can be bought differently, so the
 *     wording is "was not competed", never "cannot be won".
 */
import { withCache } from '@/lib/mcp/external-cache';

export type CompetitionClass = 'competed' | 'not_competed' | 'unknown';

export interface CompetitionFacts {
  class: CompetitionClass;
  /** Short plain-English cell for a narrow table, e.g. "Not competed · AbilityOne". */
  label: string;
  /** One sentence, facts only, for prose. */
  detail: string;
  extent_competed: string | null;
  set_aside: string | null;
  offers_received: number | null;
  sole_source_reason: string | null;
  abilityone_holder: boolean | null;
  source: 'usaspending_award' | 'none';
}

/** The award fields this reads, as USASpending returns them (latest_transaction_contract_data + recipient). */
export interface AwardCompetitionFields {
  extent_competed?: string | null;
  extent_competed_description?: string | null;
  type_set_aside_description?: string | null;
  other_than_full_and_open_description?: string | null;
  number_of_offers_received?: string | number | null;
  business_categories?: string[] | null;
}

// FPDS extent_competed codes. CDO/NDO = competitive / non-competitive delivery order.
const COMPETED = new Set(['A', 'D', 'E', 'F', 'CDO']);
const NOT_COMPETED = new Set(['B', 'C', 'G', 'NDO']);

const UNKNOWN: CompetitionFacts = {
  class: 'unknown', label: 'Not established', detail: 'How the current award was competed could not be established.',
  extent_competed: null, set_aside: null, offers_received: null, sole_source_reason: null, abilityone_holder: null, source: 'none',
};

const clean = (s: unknown): string | null => {
  const t = String(s ?? '').trim();
  return t && !/^none$/i.test(t) ? t : null;
};
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Pure. Classifies one award's competition from its own record. */
export function classifyCompetition(f: AwardCompetitionFields | null | undefined): CompetitionFacts {
  if (!f) return UNKNOWN;
  const code = clean(f.extent_competed)?.toUpperCase() ?? null;
  const extent = clean(f.extent_competed_description);
  const setAsideRaw = clean(f.type_set_aside_description);
  const setAside = setAsideRaw && !/^no set aside used\.?$/i.test(setAsideRaw) ? setAsideRaw : null;
  const reason = clean(f.other_than_full_and_open_description);
  const offersN = Number(f.number_of_offers_received);
  const offers = f.number_of_offers_received != null && f.number_of_offers_received !== '' && Number.isFinite(offersN) ? offersN : null;
  const cats = Array.isArray(f.business_categories) ? f.business_categories : null;
  const abilityone = cats ? cats.some((c) => /abilityone/i.test(String(c))) : null;
  const eightASole = !!setAside && /8\s*\(?a\)?\s*sole source/i.test(setAside);

  const base = { extent_competed: extent, set_aside: setAside, offers_received: offers, sole_source_reason: reason, abilityone_holder: abilityone, source: 'usaspending_award' as const };

  if (eightASole || (code && NOT_COMPETED.has(code))) {
    const label = eightASole ? '8(a) sole source' : abilityone ? 'Not competed · AbilityOne' : 'Not competed';
    const parts = [`The current award was not competed${extent ? ` (${sentence(extent)})` : ''}.`];
    if (eightASole) parts.push('It was an 8(a) sole-source award.');
    else if (reason) parts.push(`Stated reason: ${sentence(reason)}.`);
    if (abilityone) parts.push('The holder is an AbilityOne Program participant.');
    return { class: 'not_competed', label, detail: parts.join(' '), ...base };
  }
  if (code && COMPETED.has(code)) {
    const label = setAside ? `Competed · ${shortSetAside(setAside)}` : 'Competed';
    const offerTxt = offers != null ? ` ${offers} offer${offers === 1 ? ' was' : 's were'} received.` : '';
    return { class: 'competed', label, detail: `The current award was competed${setAside ? ` as a ${sentence(setAside)}` : ''}.${offerTxt}`, ...base };
  }
  return { ...UNKNOWN, ...base, source: 'usaspending_award' };
}

function shortSetAside(s: string): string {
  if (/total small business|small business set.?aside\s*-\s*total/i.test(s)) return 'SB set-aside';
  if (/8\s*\(?a\)?/i.test(s)) return '8(a)';
  if (/wom[ae]n/i.test(s)) return 'WOSB';
  if (/service[- ]disabled/i.test(s)) return 'SDVOSB';
  if (/hubzone/i.test(s)) return 'HUBZone';
  if (/partial small business/i.test(s)) return 'partial SB set-aside';
  return sentence(s);
}

/** Reads one award's competition fields from USASpending. null on any failure (→ unknown). */
export async function fetchAwardCompetition(contractId: string, timeoutMs = 4000): Promise<AwardCompetitionFields | null> {
  if (!contractId) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(contractId)}/`, {
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': `Mindy-GovConGiants (${process.env.MCP_CONTACT_EMAIL || 'hello@govcongiants.com'})` },
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d: any = await res.json();
    const c = d?.latest_transaction_contract_data || {};
    return {
      extent_competed: c.extent_competed ?? null,
      extent_competed_description: c.extent_competed_description ?? null,
      type_set_aside_description: c.type_set_aside_description ?? null,
      other_than_full_and_open_description: c.other_than_full_and_open_description ?? null,
      number_of_offers_received: c.number_of_offers_received ?? null,
      business_categories: Array.isArray(d?.recipient?.business_categories) ? d.recipient.business_categories : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CompetitionLookup = (contractId: string) => Promise<AwardCompetitionFields | null>;

/** Default lookup: USASpending, cached 7 days (an award's competition basis does not change). */
export const usaspendingCompetitionLookup: CompetitionLookup = async (contractId) => {
  const { value } = await withCache('usaspending_award_competition', { contract_id: contractId, v: 1 }, 7 * 24 * 3600, async () => {
    const v = await fetchAwardCompetition(contractId);
    if (!v) throw new Error('no award record'); // do not cache a miss as a fact
    return v;
  });
  return value;
};

/**
 * Competition facts for the returned rows only (≤ limit_per_horizon), in parallel under a wall-clock
 * budget. A row the budget or the API could not reach is 'unknown' — the answer still ships.
 */
export async function competitionFactsFor(
  contractIds: string[],
  lookup: CompetitionLookup = usaspendingCompetitionLookup,
  opts: { budgetMs?: number; concurrency?: number } = {},
): Promise<Map<string, CompetitionFacts>> {
  const out = new Map<string, CompetitionFacts>();
  const ids = [...new Set(contractIds.filter(Boolean))];
  const deadline = Date.now() + (opts.budgetMs ?? 5000);
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const remaining = deadline - Date.now();
      if (remaining <= 0) { out.set(id, UNKNOWN); continue; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fields = await Promise.race([
        lookup(id).catch(() => null),
        new Promise<null>((r) => { timer = setTimeout(() => r(null), remaining); }),
      ]);
      clearTimeout(timer);
      out.set(id, classifyCompetition(fields));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return out;
}

/** Counts for the horizon summary. */
export function competitionCounts(facts: Iterable<CompetitionFacts>): Record<CompetitionClass, number> {
  const c: Record<CompetitionClass, number> = { competed: 0, not_competed: 0, unknown: 0 };
  for (const f of facts) c[f.class] += 1;
  return c;
}
