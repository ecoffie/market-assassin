/**
 * Parent-contract / vehicle SCOPE for task-order search — pure (no I/O).
 *
 * One definition consumed by every reader of the Awarded market: the Maps PostgREST path, its SQL
 * twin, and the MCP task-order search (src/lib/vehicles/task-order-search.ts). Each reader applies
 * the ops below INSIDE its fetch, before ranking, counting and pagination — never as a post-filter.
 *
 * Parent identity is read from the row itself: `contract_id` is USASpending's generated id
 * `CONT_AWD_<piid>_<agency>_<parent piid>_<parent agency>` (see recompete/award-lineage.ts). A row
 * whose contract_id is not in that shape has NO recorded parent and can never match a parent scope;
 * it is counted separately (`unattributedOrdersOr`) so missing parent data is never read as zero.
 */
import { matchClause, imatchClause, wordRegex } from '@/lib/discovery/matcher';
import { NAICS_SIX_DIGIT, naicsTitle } from '@/lib/naics-catalog';
import { resolveVehicle, type VehicleResolution, type VehicleMember } from './registry';

export interface ParentRef { piid: string; agency: string; }

export type ParentScope =
  | { status: 'none' }
  | {
      status: 'resolved';
      kind: 'vehicle' | 'parent';
      label: string;
      requested: { vehicle?: string; parent?: string };
      parents: ParentRef[];
      /** Vehicle only: the verified membership evidence. */
      vehicle?: Extract<VehicleResolution, { status: 'resolved' }>;
    }
  | {
      status: 'unresolved';
      kind: 'vehicle' | 'parent';
      requested: { vehicle?: string; parent?: string };
      reason_code: 'unknown_vehicle' | 'ambiguous_vehicle' | 'vehicle_unavailable' | 'invalid_parent_id';
      reason: string;
      candidates?: string[];
    };

const PARENT_ID = /^CONT_IDV_([0-9A-Z-]{4,40})_([0-9A-Z]{4})$/;

/** `CONT_IDV_<PIID>_<AGENCY>` → ref; anything else → null. Upper-cased; no guessing of the agency. */
export function parseParentId(raw: string): ParentRef | null {
  const m = PARENT_ID.exec(String(raw || '').trim().toUpperCase());
  return m ? { piid: m[1], agency: m[2] } : null;
}

export function parentIdOf(r: ParentRef): string {
  return `CONT_IDV_${r.piid}_${r.agency}`;
}

/**
 * Resolve the request's scope. `vehicle` and `parent` are mutually exclusive; `parent` is a comma list
 * of FULL parent ids (the agency slot is part of the identity — the same PIID can exist at two agencies).
 */
export function resolveParentScope(input: { vehicle?: string | null; parent?: string | null }): ParentScope {
  const vehicle = String(input.vehicle ?? '').trim();
  const parent = String(input.parent ?? '').trim();
  if (!vehicle && !parent) return { status: 'none' };
  if (vehicle && parent) {
    return {
      status: 'unresolved', kind: 'parent', requested: { vehicle, parent }, reason_code: 'invalid_parent_id',
      reason: 'Pass either a vehicle name or exact parent contract id(s), not both.',
    };
  }
  if (parent) {
    const raws = parent.split(',').map((s) => s.trim()).filter(Boolean);
    const refs = raws.map(parseParentId);
    const bad = raws.filter((_, i) => !refs[i]);
    if (bad.length || !refs.length) {
      return {
        status: 'unresolved', kind: 'parent', requested: { parent }, reason_code: 'invalid_parent_id',
        reason: `Not an exact parent contract id: ${bad.join(', ') || parent}. Use USASpending's parent IDV id, CONT_IDV_<PIID>_<AGENCY> (e.g. CONT_IDV_47QRCA25DA002_4732).`,
      };
    }
    const uniq = new Map((refs as ParentRef[]).map((r) => [parentIdOf(r), r]));
    return { status: 'resolved', kind: 'parent', label: [...uniq.keys()].join(', '), requested: { parent }, parents: [...uniq.values()] };
  }
  const res = resolveVehicle(vehicle);
  if (res.status === 'resolved') {
    const parents = res.members.map((m: VehicleMember) => parseParentId(m.parent_id)).filter(Boolean) as ParentRef[];
    return { status: 'resolved', kind: 'vehicle', label: res.vehicle.label, requested: { vehicle }, parents, vehicle: res };
  }
  return {
    status: 'unresolved', kind: 'vehicle', requested: { vehicle },
    reason_code: res.status === 'ambiguous' ? 'ambiguous_vehicle' : res.status === 'unavailable' ? 'vehicle_unavailable' : 'unknown_vehicle',
    reason: res.reason,
    candidates: res.status === 'ambiguous' ? res.candidates : undefined,
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/**
 * PostgREST `or()` body selecting ORDERS whose recorded parent is one of `parents` — anchored on the
 * parent slot of the generated id, grouped by parent agency so the expression stays compact. An empty
 * list selects NOTHING (fail closed), never everything.
 */
export function parentScopeExpr(parents: ParentRef[]): string {
  if (!parents.length) return matchClause('contract_id', '^$');
  const byAgency = new Map<string, string[]>();
  for (const p of parents) byAgency.set(p.agency, [...(byAgency.get(p.agency) ?? []), p.piid]);
  return [...byAgency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agency, piids]) => {
      const alt = [...new Set(piids)].sort().map(escapeRe).join('|');
      return matchClause('contract_id', `^CONT_AWD_.+_[0-9A-Z]{4}_(${alt})_${agency}$`);
    })
    .join(',');
}

/**
 * A cheap SUPERSET prefilter for parentScopeExpr, derived from the parents themselves (never a
 * hard-coded prefix): one `like` per (agency, 6-char PIID stem). contract_id has no index usable by a
 * regex, and a 237-way anchored regex over the whole table hit the statement timeout (measured
 * 2026-09-24). Postgres evaluates equal-cost quals in written order, so this op — placed FIRST — cuts the
 * table to the few hundred candidate rows before the exact regex runs. It can only admit extra rows,
 * which the exact regex then rejects; it can never exclude a member's order.
 */
export function parentPrefilterExpr(parents: ParentRef[]): string {
  if (!parents.length) return matchClause('contract_id', '^$');
  const stems = new Set<string>();
  for (const p of parents) stems.add(`${p.agency}|${p.piid.slice(0, 6)}`);
  return [...stems].sort().map((k) => {
    const [agency, stem] = k.split('|');
    return `contract_id.like.CONT_AWD_*_${stem}*_${agency}`;
  }).join(',');
}

/** Award types that are ORDERS under a vehicle (mirrors award-lineage.ts ORDER_TYPES). */
export const ORDER_CONTRACT_TYPES = ['DELIVERY ORDER', 'BPA CALL', 'TASK ORDER'] as const;

/**
 * The parent slot of a generated award id is MISSING: `…_-NONE-_-NONE-`, `…_<piid>_-NONE-` or
 * `…_-NONE-_<agency>`. Such an id cannot match any parent scope (the scope needs a piid AND an agency).
 */
export const MISSING_PARENT_SLOT_RE = '_-NONE-(_[0-9A-Z]{4}|_-NONE-)?$';

/**
 * ORDERS whose parent is not fully recorded — they may belong to the requested vehicle and nothing can
 * tell, so they are counted (never included, never denied). Two shapes, both of them orders by
 * contract_type:
 *   · a raw-PIID row (contract_id not a generated id) — the parent was never captured;
 *   · a GENERATED id whose parent slot is missing (MISSING_PARENT_SLOT_RE). The first version counted
 *     only the raw-PIID shape, so a delivery order stored as `CONT_AWD_X_9700_-NONE-_-NONE-` was
 *     neither in scope nor unattributed — it vanished from both numbers.
 * Written in the SQL twin's closed grammar (eq / match / not.match) so the same string executes on
 * PostgREST and in SQL; isUnattributedOrder is its JS twin (the oracle recount).
 */
export const UNATTRIBUTED_ORDERS_OR =
  `and(or(${ORDER_CONTRACT_TYPES.map((t) => `contract_type.eq."${t}"`).join(',')}),`
  + `or(contract_id.not.match."^CONT_AWD_",contract_id.match."${MISSING_PARENT_SLOT_RE}"))`;

export function isUnattributedOrder(row: { contract_id?: string | null; contract_type?: string | null }): boolean {
  const type = String(row.contract_type ?? '').trim().toUpperCase();
  if (!(ORDER_CONTRACT_TYPES as readonly string[]).includes(type)) return false;
  const id = String(row.contract_id ?? '');
  return !id.startsWith('CONT_AWD_') || new RegExp(MISSING_PARENT_SLOT_RE).test(id);
}

// ── Work subject ────────────────────────────────────────────────────────────────────────────────

/** WORK fields only. Deliberately NOT incumbent_name / awarding_agency: "management consulting" must
 *  not match a FEMA ("Emergency Management Agency") order held by "XYZ Consulting LLC". */
export const WORK_FIELDS = ['description', 'naics_description', 'psc_description'] as const;

/** JS twin of the Postgres whole-word `\m…\M` term regex. */
function termRe(term: string): RegExp {
  const src = wordRegex(term).replace(/^\\m/, '').replace(/\\M$/, '');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`, 'iu');
}

/**
 * Six-digit NAICS codes whose OFFICIAL title (src/data/naics-codes.json, USASpending's NAICS API)
 * contains the term as a whole word. The row's own naics_description is 0% filled on
 * recompete_opportunities (0 of 142,000, measured 2026-09-24) while naics_code is fully filled, so the
 * code's official title is the only NAICS text an order has. The title is authoritative reference
 * data — never inferred.
 */
export function naicsCodesForTerm(term: string): string[] {
  const re = termRe(term);
  return NAICS_SIX_DIGIT.filter((e) => re.test(e.title)).map((e) => e.code).sort();
}

const STOP = new Set(['and', 'or', 'the', 'of', 'for', 'to', 'in', 'on', 'a', 'an', 'with', 'by', 'at', 'under', 'services', 'service']);

export function workTerms(work: string): string[] {
  const toks = String(work || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  return [...new Set(toks.filter((t) => t.length >= 2 && !STOP.has(t)))].slice(0, 8);
}

/** One `or()` body per term — the ops are ANDed, so EVERY term must appear in some work field. */
export function workScopeExprs(work: string): string[] {
  return workTerms(work).map((t) => [
    ...WORK_FIELDS.map((c) => imatchClause(c, wordRegex(t))),
    ...naicsCodesForTerm(t).map((code) => `naics_code.eq.${code}`),
  ].join(','));
}

/**
 * Evidence for a returned row: which work field carried each term. JS twin of Postgres `\m…\M`
 * (word start/end). The oracle asserts every returned row has evidence for every term, so a drift
 * between this and the DB predicate fails loudly.
 */
export function workEvidence(row: Record<string, unknown>, work: string): { term: string; fields: string[] }[] {
  const code = String(row.naics_code ?? '').trim();
  return workTerms(work).map((t) => {
    const re = termRe(t);
    const fields: string[] = WORK_FIELDS.filter((f) => re.test(String(row[f] ?? '')));
    const title = code.length === 6 ? naicsTitle(code) : undefined;
    if (title && re.test(title)) fields.push(`naics_title(${code}: ${title})`);
    return { term: t, fields };
  });
}

/** The parent recorded on a row, from its generated id (null = not recorded). */
export function recordedParent(contractId: string): ParentRef | null {
  const m = /^CONT_AWD_.+_[0-9A-Z]{4}_(.+)_([0-9A-Z]{4})$/i.exec(String(contractId || ''));
  if (!m || m[1] === '-NONE-') return null;
  return { piid: m[1].toUpperCase(), agency: m[2].toUpperCase() };
}
