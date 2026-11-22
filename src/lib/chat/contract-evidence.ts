/**
 * Contract evidence guard for Ask Mindy chat (2026-11-22 critical regression, contract 36C24825C0020).
 *
 * What happened: a renewal list showed 36C24825C0020 as Blue Cord Design and Construction, $8.44M obligated,
 * ending 2026-11-23. Asked whether that exact contract was worth pursuing, the planner passed the contract number
 * to get_solicitation_incumbent, which resolved it to a DIFFERENT notice (36C24824R0177) and named a different
 * award (Daniels Building Co, 36C77624C0154, $14M, ending 2026-10-15). The answer adopted those facts and wrote a
 * pursuit plan.
 *
 * The rule here: facts about a contract (holder, value, dates) come ONLY from a record of that EXACT identifier.
 *   1. Before tools: an identifier the customer names that earlier answers showed as a contract award is looked up
 *      with get_award_detail, never passed to a solicitation tool as if it were a solicitation number.
 *   2. After tools: this turn's results are checked per identifier the customer named.
 *        - VERIFIED: records of that exact identifier, with their source tool.
 *        - NOT ABOUT IT: a result that answered for the identifier but describes a different notice or award.
 *        - DISAGREE: exact records whose holder, obligated value or end date differ. Both are shown, none chosen.
 *        - UNRESOLVED: holder, value or end date not established by an exact record. Pursuit advice is blocked.
 * Identifiers are compared exactly (letters and digits, case-insensitive). A partial identifier never matches.
 * Pure: no I/O. Tool data is third-party text, so names are reduced to a safe character set before they reach a
 * system note.
 */
import type { SourceLedger } from './context-sources';

/** Tools whose ledger keys are contract awards (PIIDs). find_opportunities is excluded: its keys mix notices and awards. */
export const AWARD_RECORD_TOOLS: ReadonlySet<string> = new Set([
  'get_expiring_contracts', 'get_award_detail', 'search_past_contracts', 'get_contractor_award_history', 'search_idv_contracts',
]);

/** Tools that take a SOLICITATION identifier and can answer about a different record than the one asked for. */
const SOLICITATION_TOOLS: ReadonlySet<string> = new Set(['get_solicitation_incumbent', 'lookup_solicitation']);

export function normId(s: string): string {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Contract-number-shaped tokens in the customer's words (8 to 25 letters/digits, both present). Never partial. */
export function contractIdsIn(text: string): string[] {
  const out = new Set<string>();
  for (const raw of String(text || '').split(/\s+/)) {
    const t = raw.replace(/^[("'[#]+|[)"'\].,;:!?]+$/g, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{6,30}$/.test(t)) continue;
    const n = normId(t);
    if (n.length < 8 || n.length > 25 || !/\d/.test(n) || !/[A-Z]/.test(n)) continue;
    if (/^[0-9A-F]{32}$/.test(n)) continue; // a notice UUID is not a contract number
    out.add(n);
  }
  return [...out];
}

/** Identifiers that earlier answers' signed ledgers showed as contract awards, with the tool that showed them. */
export function priorAwardIds(ledgers: readonly SourceLedger[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of ledgers) for (const e of l.entries) {
    if (!e.tool || !AWARD_RECORD_TOOLS.has(e.tool)) continue;
    for (const it of e.items ?? []) { const k = normId(it.key); if (k && !out.has(k)) out.set(k, e.tool); }
  }
  return out;
}

const TOOL_WORDS: Record<string, string> = {
  get_expiring_contracts: 'the expiring-contracts results', get_award_detail: 'an award lookup', search_past_contracts: 'the past-contracts search',
  get_contractor_award_history: 'a contractor award history', search_idv_contracts: 'the contract-vehicle search',
};

/** Planner/answer note, before tools: route an award identifier to get_award_detail. Null when nothing applies. */
export function contractIdentityNote(message: string, ledgers: readonly SourceLedger[]): string | null {
  const prior = priorAwardIds(ledgers);
  const hits = contractIdsIn(message).filter((id) => prior.has(id));
  if (!hits.length) return null;
  return [
    'CONTRACT IDENTITY (from this conversation\'s earlier results, checked by Mindy):',
    ...hits.map((id) => `- ${id} is a contract award (shown in ${TOOL_WORDS[prior.get(id)!] ?? 'earlier results'}). To check its holder, value or dates, call get_award_detail with piid "${id}". It is not a solicitation number: do not pass it to get_solicitation_incumbent or lookup_solicitation.`),
    'Facts about a contract come only from a record of that exact identifier. Never replace them with a different contract\'s facts.',
  ].join('\n');
}

export interface ContractRecord {
  id: string;
  tool: string;
  holder?: string;
  obligated?: number;
  end?: string;
}

/** A turn's tool result, as the route holds it (ContextSource has these fields). */
export interface TurnResultLike { tool?: string; status?: string; content: string }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const day = (v: unknown): string | undefined => { const s = str(v); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined; };

function record(tool: string, id: unknown, holder: unknown, obligated: unknown, end: unknown): ContractRecord | null {
  const k = typeof id === 'string' ? normId(id.replace(/^CONT_(AWD_)?/i, '').split('_')[0]) : '';
  if (!k) return null;
  return { id: k, tool, ...(str(holder) ? { holder: str(holder) } : {}), ...(num(obligated) ? { obligated: num(obligated) } : {}), ...(day(end) ? { end: day(end) } : {}) };
}

function parse(content: string): Record<string, unknown> | null {
  try { const j = JSON.parse(content); return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { return null; }
}

/** Contract records each award tool returned, keyed by their own identifier. */
export function contractRecords(results: readonly TurnResultLike[]): ContractRecord[] {
  const out: ContractRecord[] = [];
  for (const r of results) {
    // A failed or refused call has no record; a truncated or degraded list still carries real rows.
    if (!r.tool || r.status === 'failed' || r.status === 'refused') continue;
    const j = parse(r.content);
    if (!j || j.ok === false) continue;
    if (r.tool === 'get_award_detail') {
      const a = j.award as Record<string, unknown> | undefined;
      const rec = a && record(r.tool, a.awardId, a.recipientName, a.obligated, a.popEnd);
      if (rec) out.push(rec);
    } else if (r.tool === 'get_expiring_contracts') {
      const rows = [...(Array.isArray(j.contracts) ? j.contracts : []), ...(Array.isArray(j.expiring_orders_in_window) ? j.expiring_orders_in_window : []), ...(Array.isArray(j.unresolved_orders) ? j.unresolved_orders : [])] as Array<Record<string, unknown>>;
      for (const c of rows) {
        const rec = record(r.tool, c.piid ?? c.award_id ?? c.contract_id, c.incumbent_name ?? c.recipient_name, c.total_obligation ?? c.obligated, c.period_of_performance_current_end ?? c.current_end);
        if (rec) out.push(rec);
      }
    } else if (r.tool === 'find_opportunities') {
      const items = ((j.horizons as Record<string, { items?: unknown[] }> | undefined)?.coming_back?.items ?? []) as Array<Record<string, unknown>>;
      for (const c of items) {
        const rec = record(r.tool, c.piid ?? c.award_id ?? c.contract_id, c.incumbent_name ?? c.incumbent ?? c.recipient_name, c.total_obligation, c.current_end ?? c.period_of_performance_current_end);
        if (rec) out.push(rec);
      }
    } else if (r.tool === 'get_solicitation_incumbent') {
      // Its incumbent is a record of the AWARD's own id (which may differ from the id asked about).
      const inc = j.incumbent as Record<string, unknown> | null | undefined;
      const rec = inc && record(r.tool, inc.awardId, inc.recipientName, inc.obligated, inc.popEnd);
      if (rec) out.push(rec);
    }
  }
  return out;
}

export interface Substitution { asked: string; tool: string; describes: string[] }

/** Identifiers a solicitation tool answered for this turn (its `queried`/`query`), whatever it returned. */
export function answeredFor(results: readonly TurnResultLike[]): Set<string> {
  const out = new Set<string>();
  for (const r of results) {
    if (!r.tool || !SOLICITATION_TOOLS.has(r.tool)) continue;
    const j = parse(r.content);
    const q = j ? normId(String(j.queried ?? j.query ?? '')) : '';
    if (q) out.add(q);
  }
  return out;
}

/** Solicitation-tool results that answered for an identifier but describe different records. */
export function substitutions(results: readonly TurnResultLike[], asked: readonly string[]): Substitution[] {
  const want = new Set(asked);
  const out: Substitution[] = [];
  for (const r of results) {
    if (!r.tool || !SOLICITATION_TOOLS.has(r.tool)) continue;
    const j = parse(r.content);
    if (!j) continue;
    const q = normId(String(j.queried ?? j.query ?? ''));
    if (!q || !want.has(q)) continue;
    const describes = new Set<string>();
    const notice = j.notice as Record<string, unknown> | null | undefined;
    const sol = notice && str(notice.solicitation_number);
    if (sol && normId(sol) !== q) describes.add(`solicitation ${sol}`);
    const inc = j.incumbent as Record<string, unknown> | null | undefined;
    const award = inc && str(inc.awardId);
    if (award && normId(award) !== q) describes.add(`award ${award}${str(inc!.recipientName) ? ` (${safe(String(inc!.recipientName))})` : ''}`);
    const items = Array.isArray(j.items) ? (j.items as Array<Record<string, unknown>>) : [];
    for (const it of items) {
      const ids = (Array.isArray(it.identifiers) ? it.identifiers : []).map((x) => normId(String(x)));
      if (ids.length && !ids.includes(q)) describes.add(`notice ${String((it.identifiers as unknown[])[0])}`);
    }
    if (describes.size) out.push({ asked: q, tool: r.tool, describes: [...describes] });
  }
  return out;
}

/** Third-party names reach a system note only as plain words. */
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9 .,&'()-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
const sameHolder = (a: string, b: string) => normId(a).replace(/(LLC|INC|CORP|CO|LTD|LP|COMPANY|CORPORATION|INCORPORATED)+$/g, '') === normId(b).replace(/(LLC|INC|CORP|CO|LTD|LP|COMPANY|CORPORATION|INCORPORATED)+$/g, '');
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export interface ContractEvidence {
  id: string;
  verified: ContractRecord[];
  substituted: Substitution[];
  disagreements: string[];
  /** Holder, obligated value or end date not established by an exact record this turn. */
  unresolved: Array<'holder' | 'value' | 'end date'>;
}

/**
 * Per identifier the customer named. `message` may include the customer's recent earlier messages, so "is it worth
 * pursuing?" after "tell me about 36C24825C0020" is still checked against that contract.
 */
export function contractEvidence(message: string, results: readonly TurnResultLike[]): ContractEvidence[] {
  const asked = contractIdsIn(message);
  if (!asked.length) return [];
  const recs = contractRecords(results);
  const subs = substitutions(results, asked);
  const answered = answeredFor(results);
  return asked.flatMap((id) => {
    const verified = recs.filter((r) => r.id === id);
    const substituted = subs.filter((s) => s.asked === id);
    // Nothing this turn looked it up: the answer is not about its facts (history and earlier notes still apply).
    if (!verified.length && !substituted.length && !answered.has(id)) return [];
    const disagreements: string[] = [];
    const holders = verified.filter((r) => r.holder);
    for (const r of holders.slice(1)) if (!sameHolder(r.holder!, holders[0].holder!)) disagreements.push(`holder: ${safe(holders[0].holder!)} (${holders[0].tool}) vs ${safe(r.holder!)} (${r.tool})`);
    const vals = verified.filter((r) => r.obligated);
    for (const r of vals.slice(1)) if (Math.abs(r.obligated! - vals[0].obligated!) / vals[0].obligated! > 0.01) disagreements.push(`obligated: ${money(vals[0].obligated!)} (${vals[0].tool}) vs ${money(r.obligated!)} (${r.tool})`);
    const ends = verified.filter((r) => r.end);
    for (const r of ends.slice(1)) if (r.end !== ends[0].end) disagreements.push(`end date: ${ends[0].end} (${ends[0].tool}) vs ${r.end} (${r.tool})`);
    const unresolved: ContractEvidence['unresolved'] = [];
    if (!holders.length) unresolved.push('holder');
    if (!vals.length) unresolved.push('value');
    if (!ends.length) unresolved.push('end date');
    return [{ id, verified, substituted, disagreements, unresolved }];
  });
}

/** The answer-turn system note. Null when no identifier the customer named was touched by this turn's tools. */
export function contractEvidenceNote(evidence: readonly ContractEvidence[]): string | null {
  if (!evidence.length) return null;
  const lines = ['CONTRACT EVIDENCE (checked by Mindy against this turn\'s tool results; facts about a contract come ONLY from a record of that exact identifier):'];
  for (const e of evidence) {
    for (const r of e.verified) {
      const parts = [r.holder ? `holder ${safe(r.holder)}` : null, r.obligated ? `${money(r.obligated)} obligated` : null, r.end ? `ends ${r.end}` : null].filter(Boolean);
      lines.push(`- ${e.id} VERIFIED by ${r.tool}${parts.length ? `: ${parts.join(', ')}` : ''}.`);
    }
    for (const s of e.substituted) {
      lines.push(`- NOT ABOUT ${e.id}: ${s.tool} returned ${s.describes.join(' and ')}. Those are different records. Never present them as ${e.id}'s holder, value or dates, and do not build advice on them.`);
    }
    if (e.disagreements.length) {
      lines.push(`- SOURCES DISAGREE on ${e.id}: ${e.disagreements.join('; ')}. Show each value with its source; do not pick one.`);
    }
    const blocked = e.unresolved.length || e.disagreements.length;
    if (blocked) {
      const why = [e.unresolved.length ? `its ${e.unresolved.join(', ')} ${e.unresolved.length === 1 ? 'is' : 'are'} not established by a record of ${e.id}` : null, e.disagreements.length ? 'its sources disagree' : null].filter(Boolean).join(' and ');
      lines.push(`- PURSUIT BLOCKED for ${e.id}: ${why}. Do not recommend pursuing it and do not write a pursuit plan. Say exactly which facts are missing or in conflict, and offer to look them up (get_award_detail with piid "${e.id}").`);
    }
  }
  return lines.join('\n');
}
