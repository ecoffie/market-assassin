/**
 * Read-layer de-duplication of `recompete_opportunities` rows that describe the SAME award under
 * two different `contract_id`s.
 *
 * WHY (measured 2026-10-02, read-only, 186,535 rows): 27 groups / 54 rows share PIID + incumbent
 * UEI + period_of_performance_current_end + total_obligation + awarding agency but differ in
 * `contract_id`; 21 of those groups are visible to readers (quality_flag IS NULL, end in future).
 * Two causes, both sync artifacts — never two real awards:
 *
 *   1. RE-PARENTED ORDER. USASpending's `generated_internal_id` embeds the parent IDV
 *      (`CONT_AWD_<piid>_<agency>_<parent idv>_<parent agency>`). When USASpending re-links an
 *      order to a different parent (DOI BPA calls 140D0426F0336/0371/0372: 2034…A0000x → 140D0426A80xx;
 *      GAO 05GA0A26F0058 Tyler Federal: GS35F0240P → 47QTCA23D00C2), the award gets a NEW id. The
 *      sync upserts on `contract_id`, so the new id is inserted and the old row is orphaned — it is
 *      never refreshed again (its `last_synced_at` freezes) and USASpending answers 404 for it
 *      (verified: CONT_AWD_140D0426F0336_1406_20343125A00001_2036 → 404, the sibling → 200).
 *   2. LEGACY ID. Rows written by the April build (`data_source='usaspending'`, contract_id = bare
 *      PIID, last_synced_at 2026-04-05) beside the per-contract sync's CONT_AWD_ row for the same award.
 *
 * CANONICAL ROW: the most recently synced one. The sync touches every row USASpending still serves,
 * so the freshest `last_synced_at` is the id USASpending answers for today; the stale sibling is the
 * orphan. Ties → prefer a `CONT_AWD_` id over a legacy one → lowest `contract_id` (deterministic).
 *
 * NATURAL KEY: PIID + incumbent UEI + current end date + total_obligation + awarding agency. NAICS is
 * deliberately NOT in the key — the Tyler pair carries 511210 on the stale row and 541511 on the
 * live one (the re-parent moved the NAICS too). A row missing PIID, UEI or end date is never merged
 * (unknown ≠ equal). Distinct orders sharing a PIID (e.g. HHSM500T0002 under two real parents with
 * different values) keep different keys and stay separate.
 *
 * The DB is not altered. A sync-side prevention (delete/flag the orphan when an award id changes
 * parent) belongs in usaspending-sync.ts — see the PR notes; not implemented here.
 */

export interface DedupeableRecompeteRow {
  contract_id?: string | null;
  piid?: string | null;
  incumbent_uei?: string | null;
  period_of_performance_current_end?: string | null;
  total_obligation?: number | string | null;
  awarding_agency?: string | null;
  last_synced_at?: string | null;
  set_aside_enriched?: string | null;
}

/** The natural award key, or null when a component is unknown (such a row is never merged). */
export function recompeteNaturalKey(row: DedupeableRecompeteRow): string | null {
  const piid = String(row.piid ?? '').trim().toUpperCase();
  const uei = String(row.incumbent_uei ?? '').trim().toUpperCase();
  const end = String(row.period_of_performance_current_end ?? '').trim().slice(0, 10);
  if (!piid || !uei || !end) return null;
  const v = row.total_obligation;
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  const value = Number.isFinite(n) ? n.toFixed(2) : '?';
  const agency = String(row.awarding_agency ?? '').trim().toUpperCase();
  return `${piid}|${uei}|${end}|${value}|${agency}`;
}

function syncedMs(row: DedupeableRecompeteRow): number {
  const t = row.last_synced_at ? Date.parse(row.last_synced_at) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

/** Negative = a is the better canonical row. */
function compareCanonical(a: DedupeableRecompeteRow, b: DedupeableRecompeteRow): number {
  const ds = syncedMs(b) - syncedMs(a);
  if (ds !== 0 && !Number.isNaN(ds)) return ds > 0 ? 1 : -1;
  const aw = String(a.contract_id ?? '').startsWith('CONT_AWD_') ? 0 : 1;
  const bw = String(b.contract_id ?? '').startsWith('CONT_AWD_') ? 0 : 1;
  if (aw !== bw) return aw - bw;
  const ac = String(a.contract_id ?? '');
  const bc = String(b.contract_id ?? '');
  return ac < bc ? -1 : ac > bc ? 1 : 0;
}

export interface DedupeResult<T> {
  rows: T[];
  /** Rows folded into a canonical sibling (input length − output length). */
  collapsed: number;
}

/**
 * Collapse rows that describe the same award to ONE canonical row, preserving input order
 * (the canonical row takes the slot of the group's FIRST occurrence, so a caller's sort holds —
 * siblings share end date and value, so they sort adjacent anyway). Pure; never mutates input.
 *
 * `set_aside_enriched` is PIID-keyed (backfilled from BQ awards by PIID), so when the canonical
 * row lacks it and the siblings agree on one value, it is carried over — otherwise de-duplicating
 * would silently lose a recorded set-aside the stale row held. Nothing else is borrowed.
 */
export function dedupeRecompeteRows<T extends DedupeableRecompeteRow>(rows: readonly T[]): DedupeResult<T> {
  const groups = new Map<string, T[]>();
  const order: Array<{ key: string | null; row: T }> = [];
  for (const row of rows) {
    const key = recompeteNaturalKey(row);
    if (key === null) { order.push({ key: null, row }); continue; }
    const g = groups.get(key);
    if (g) g.push(row);
    else { groups.set(key, [row]); order.push({ key, row }); }
  }
  const out: T[] = [];
  for (const { key, row } of order) {
    if (key === null) { out.push(row); continue; }
    const members = groups.get(key)!;
    if (members.length === 1) { out.push(row); continue; }
    const canonical = members.slice().sort(compareCanonical)[0];
    if (canonical.set_aside_enriched == null) {
      const vals = new Set(members.map((m) => m.set_aside_enriched).filter((v): v is string => v != null && v !== ''));
      if (vals.size === 1) { out.push({ ...canonical, set_aside_enriched: [...vals][0] }); continue; }
    }
    out.push(canonical);
  }
  return { rows: out, collapsed: rows.length - out.length };
}
