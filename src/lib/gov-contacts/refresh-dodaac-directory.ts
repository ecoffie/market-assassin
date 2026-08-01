/**
 * Refresh the dodaac_directory reference table from BigQuery awards
 * (FPDS office names). Single source of truth — used by both the cron route
 * (/api/cron/refresh-dodaac-directory, fired by the dispatcher) and the
 * standalone script (scripts/populate-dodaac-directory.mjs).
 *
 * TWO passes, in order:
 *   1. refreshDodaacDirectory() — FPDS awards. The historical record.
 *   2. fillDodaacGapsFromSam()  — SAM `agency_hierarchy`, INSERT-ONLY.
 *
 * Why a second pass instead of one merged source: FPDS and SAM genuinely
 * DISAGREE for ~232 offices, and both are right about different things. A
 * DoDAAC keeps its old district name across FPDS award history when districts
 * reorganize (W912QR = "ENDIST LOUISVILLE" over 24,034 awards), while SAM's
 * hierarchy names the office buying TODAY ("ENDIST BALTIMORE"). Overwriting
 * either one destroys information, so pass 2 only fills rows pass 1 left EMPTY
 * (measured 2026-07-31: 1,664 of 4,813 offices had no name at all).
 *
 * Do NOT "simplify" this into an upsert — see the never-overwrite guard below.
 */
import { createClient } from '@supabase/supabase-js';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

// Strip a leading copy of the code from FPDS names ("FA7000  10 CONS LGC").
function cleanName(code: string, raw: string): string {
  let n = (raw || '').trim();
  // Strip a leading copy of the DoDAAC ("FA7000  10 CONS LGC" → "10 CONS LGC").
  if (n.toUpperCase().startsWith(code.toUpperCase())) n = n.slice(code.length).trim();
  // FPDS names also often start with a 4-6 char ALT office code
  // ("W7NC USPFO ACTIVITY MEANG 101" → "USPFO ACTIVITY MEANG 101") which reads
  // like a code, not a name (Eric QA). Strip a leading uppercase-alnum token of
  // 4-6 chars that contains a digit — but only when real words follow.
  const m = /^([A-Z0-9]{4,6})\s+(.+)$/.exec(n);
  if (m && /\d/.test(m[1]) && /[A-Z]{3,}/.test(m[2])) n = m[2].trim();
  return n || raw || code;
}

export async function refreshDodaacDirectory(): Promise<{ offices: number; written: number }> {
  const rows = await bqQuery<{
    dodaac: string; office_name: string; agency: string | null;
    sub_agency: string | null; award_count: number; total_obligated: number;
  }>({
    query: `
      SELECT
        awarding_office_code AS dodaac,
        ANY_VALUE(awarding_office) AS office_name,
        ANY_VALUE(awarding_agency) AS agency,
        ANY_VALUE(awarding_sub_agency) AS sub_agency,
        COUNT(*) AS award_count,
        SUM(obligation_amount) AS total_obligated
      FROM ${BQ_TABLES.awards}
      WHERE awarding_office_code IS NOT NULL
        AND awarding_office IS NOT NULL
        AND LENGTH(awarding_office_code) = 6
      GROUP BY awarding_office_code
      HAVING award_count > 0
    `,
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
  });

  const records = rows.map(r => ({
    dodaac: r.dodaac,
    office_name: cleanName(r.dodaac, r.office_name),
    agency: r.agency || null,
    sub_agency: r.sub_agency || null,
    award_count: Number(r.award_count || 0),
    total_obligated: Number(r.total_obligated || 0),
    source: 'fpds_awards',
    updated_at: new Date().toISOString(),
  }));

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let written = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await sb.from('dodaac_directory').upsert(batch, { onConflict: 'dodaac' });
    if (error) throw new Error(`dodaac upsert: ${error.message}`);
    written += batch.length;
  }
  return { offices: rows.length, written };
}

/**
 * A real DoDAAC is exactly 6 chars, alphanumeric, starting with a letter or
 * digit — NOT every 6-char prefix of a solicitation number. Civilian and
 * ad-hoc numbering schemes ("CORHQ-", "IT-26-", "A-A-50", "852674") slice into
 * garbage, which is how "_" and "1" nearly landed as office names.
 */
const DODAAC_RE = /^[A-Z0-9]{6}$/;

/**
 * Extract the office name from a SAM `agency_hierarchy` path.
 *
 * The leaf is the most specific segment, but it often carries the PARENT org's
 * routing code as a prefix ("W2SD ENDIST BALTIMORE", "W071 ENDIST PORTLAND") —
 * that code is not part of the name. Depth varies 5–7, so a fixed level index
 * is wrong: at depth 5 the 5th segment is LESS specific than the 4th (nine DLA
 * desks all collapse to "DLA LAND AND MARITIME").
 */
export function officeNameFromHierarchy(hierarchy: string): string | null {
  const segments = (hierarchy || '').split('.').map(s => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  const leaf = segments[segments.length - 1];
  // Strip a leading 4-6 char routing code ("W2SD ENDIST BALTIMORE"), but only
  // when it CONTAINS A DIGIT and real words follow. The digit test is load
  // bearing: without it, all-alpha words like "ENDIST" read as codes and get
  // eaten, silently turning "ENDIST WALLA WALLA" into "WALLA WALLA" and
  // dropping the token that marks it a Corps of Engineers district.
  const stripped = /^([A-Z0-9]{4,6})\s+(.+)$/.exec(leaf);
  const name = (
    stripped && /\d/.test(stripped[1]) && /[A-Z]{3,}/.test(stripped[2]) ? stripped[2] : leaf
  ).trim();
  // Reject names that are themselves just codes/stubs ("FAO", "PL8", "_", "1").
  if (name.length < 5) return null;
  if (!/[A-Z]{3,}/i.test(name)) return null;
  return name;
}

const PAGE = 1000;

/**
 * Derive the CURRENT office name per DoDAAC from active SAM solicitations.
 *
 * Shared by fillDodaacGapsFromSam() and refreshSamOfficeNames() so the parsing
 * and validation rules can't drift between them.
 *
 * Returns dodaac → winning name, chosen by MAJORITY vote across that office's
 * active solicitations. A single office occasionally carries more than one
 * hierarchy spelling, and picking arbitrarily makes the result non-deterministic
 * run to run.
 */
async function samOfficeNamesByDodaac(
  // Deliberately structural rather than ReturnType<typeof createClient>: the
  // generic defaults resolve differently at the call site, so naming the client
  // type produces a "'public' is not assignable to 'never'" mismatch.
  sb: { from: (table: string) => any }
): Promise<{ names: Map<string, string>; skippedInvalid: number }> {
  type Opp = { solicitation_number: string | null; agency_hierarchy: string | null };
  const opps: Opp[] = [];
  // Paginated — PostgREST silently caps a select at 1,000 rows.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('sam_opportunities')
      .select('solicitation_number, agency_hierarchy')
      .eq('active', true)
      .not('solicitation_number', 'is', null)
      .not('agency_hierarchy', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sam_opportunities read: ${error.message}`);
    if (!data?.length) break;
    opps.push(...(data as Opp[]));
    if (data.length < PAGE) break;
  }

  const counts = new Map<string, Map<string, number>>();
  let skippedInvalid = 0;
  for (const o of opps) {
    const dodaac = (o.solicitation_number || '').slice(0, 6).toUpperCase();
    // NOT every 6-char prefix is a DoDAAC — civilian schemes ("PR1610",
    // "IHS152", "REPOST") slice into fragments. See the header note.
    if (!DODAAC_RE.test(dodaac)) { skippedInvalid++; continue; }
    const name = officeNameFromHierarchy(o.agency_hierarchy || '');
    if (!name) { skippedInvalid++; continue; }
    const m = counts.get(dodaac) || new Map<string, number>();
    m.set(name, (m.get(name) || 0) + 1);
    counts.set(dodaac, m);
  }

  const names = new Map<string, string>();
  for (const [dodaac, m] of counts) {
    // Majority vote; ties break on the alphabetically-first name so the result
    // is stable across runs rather than depending on Map insertion order.
    const winner = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    names.set(dodaac, winner);
  }
  return { names, skippedInvalid };
}

/**
 * Pass 2: name the offices FPDS never covered, from SAM's live hierarchy.
 * INSERT-ONLY — never updates an existing row (see file header for why).
 */
export async function fillDodaacGapsFromSam(
  opts: { dryRun?: boolean } = {}
): Promise<{ candidates: number; skippedExisting: number; skippedInvalid: number; inserted: number }> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { names: samNames, skippedInvalid } = await samOfficeNamesByDodaac(sb);
  const byDodaac = samNames;

  // Existing rows are OFF LIMITS — read the full key set, paginated.
  const existing = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('dodaac_directory')
      .select('dodaac')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`dodaac_directory read: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as { dodaac: string }[]) existing.add(r.dodaac.toUpperCase());
    if (data.length < PAGE) break;
  }

  const now = new Date().toISOString();
  const records: Array<Record<string, unknown>> = [];
  let skippedExisting = 0;
  for (const [dodaac, office_name] of byDodaac) {
    if (existing.has(dodaac)) { skippedExisting++; continue; }
    records.push({
      dodaac,
      office_name,
      agency: null,
      sub_agency: null,
      award_count: 0,
      total_obligated: 0,
      source: 'sam_hierarchy', // provenance — always separable from fpds_awards
      updated_at: now,
    });
  }

  const result = {
    candidates: byDodaac.size,
    skippedExisting,
    skippedInvalid,
    inserted: 0,
  };
  if (opts.dryRun) return result;

  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    // insert(), NOT upsert() — a conflict here means the never-overwrite
    // invariant broke and we want it to FAIL LOUDLY, not silently clobber FPDS.
    const { error } = await sb.from('dodaac_directory').insert(batch);
    if (error) throw new Error(`dodaac gap-fill insert: ${error.message}`);
    result.inserted += batch.length;
  }
  return result;
}

export interface SamOfficeNameResult {
  /** DoDAACs with a usable SAM name (before matching against the directory). */
  candidates: number;
  /** Rows whose sam_office_name was written or refreshed. */
  updated: number;
  /** Already correct — skipped, so a no-op run writes nothing. */
  unchanged: number;
  /** Had a SAM name but no directory row (offices FPDS never covered). */
  noDirectoryRow: number;
  /** Opportunity rows rejected: not a real DoDAAC, or no usable name. */
  skippedInvalid: number;
  /** Of the rows written, how many DISAGREE with the FPDS name. */
  disagreeWithFpds: number;
  /** Skipped because the SAM name is strictly LESS specific than FPDS. */
  skippedLessSpecific: number;
}

/**
 * TRUE when the SAM name is a strict truncation of the FPDS name — same office,
 * less detail. FPDS distinguishes "FPAC BUS CNTR-ACQ DIV-WESTERN SEC" from its
 * CENTRAL and EASTERN siblings; SAM calls all three "FPAC BUS CNTR-ACQ DIV".
 *
 * Writing those would make three distinct offices display identically. Measured
 * 2026-08-01: 37 of 1,253 candidate writes are this shape. Skipping them keeps
 * the specific FPDS name via the display view's COALESCE fallback.
 *
 * Deliberately narrow: only a PREFIX relationship counts. A genuinely different
 * name ("USDA-FS, CSA EAST 5" -> "MONONGAHELA NATIONAL FOREST") is a real
 * improvement and must still be written.
 *
 * KNOWN LIMIT — this catches truncations, not mis-assignments. 36 writes give
 * two DoDAACs the same SAM name where FPDS named them differently and neither
 * is a prefix of the other (140A07 "ALBUQERQUE ACQUISITION OFFICE" and 140A12
 * "NORTHWEST REGION" both become "NORTHWEST REGION"). Those look like SAM
 * pointing at a parent or sibling office. They are left in because the display
 * view still exposes fpds_office_name, so no information is lost — but if
 * office-name precision ever matters more than currency, that is the next
 * thing to fix.
 */
function samIsLessSpecific(samName: string, fpdsName: string | null): boolean {
  if (!fpdsName) return false;
  const s = samName.trim().toUpperCase();
  const f = fpdsName.trim().toUpperCase();
  if (!s || !f || s === f) return false;
  // FPDS extends the SAM name with more detail → SAM is the truncation.
  return f.startsWith(s) && f.length > s.length;
}

/**
 * Pass 3: populate sam_office_name — the CURRENT buying office name, from
 * active SAM solicitations.
 *
 * WRITES ONE COLUMN. office_name (the historical FPDS record) is never touched,
 * because the two sources genuinely disagree for ~363 offices and both are
 * right about different questions:
 *
 *   W912QR  FPDS "ENDIST LOUISVILLE" (24,034 awards)  SAM "ENDIST BALTIMORE"
 *
 * Overwriting FPDS would destroy award-history context; leaving SAM unstored
 * means the UI shows a district that no longer buys. Hence two columns and the
 * dodaac_directory_display view, which resolves the display rule in one place.
 *
 * Only rows that ALREADY EXIST are updated — this never inserts. Offices with
 * no directory row are counted (noDirectoryRow) and left alone, because
 * inserting them is the thing fillDodaacGapsFromSam() proved unsafe.
 */
export async function refreshSamOfficeNames(
  opts: { dryRun?: boolean } = {}
): Promise<SamOfficeNameResult> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { names: samNames, skippedInvalid } = await samOfficeNamesByDodaac(sb);

  // Current state of every directory row we might touch.
  type Row = { dodaac: string; office_name: string | null; sam_office_name: string | null };
  const current = new Map<string, Row>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('dodaac_directory')
      .select('dodaac, office_name, sam_office_name')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`dodaac_directory read: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as Row[]) current.set(r.dodaac.toUpperCase(), r);
    if (data.length < PAGE) break;
  }

  const result: SamOfficeNameResult = {
    candidates: samNames.size,
    updated: 0,
    unchanged: 0,
    noDirectoryRow: 0,
    skippedInvalid,
    disagreeWithFpds: 0,
    skippedLessSpecific: 0,
  };

  const pending: Array<{ dodaac: string; sam_office_name: string }> = [];
  for (const [dodaac, samName] of samNames) {
    const row = current.get(dodaac);
    if (!row) { result.noDirectoryRow++; continue; }
    // Never trade a specific FPDS name for a vaguer SAM one — the display view
    // falls back to office_name, so skipping keeps the better name.
    if (samIsLessSpecific(samName, row.office_name)) { result.skippedLessSpecific++; continue; }
    // Idempotent: a re-run with no upstream change writes zero rows.
    if (row.sam_office_name === samName) { result.unchanged++; continue; }
    pending.push({ dodaac, sam_office_name: samName });
    if (row.office_name && row.office_name.toUpperCase() !== samName.toUpperCase()) {
      result.disagreeWithFpds++;
    }
  }

  if (opts.dryRun) {
    result.updated = pending.length;
    return result;
  }

  const stamp = new Date().toISOString();
  for (const p of pending) {
    // UPDATE by primary key, one column + its timestamp. Deliberately NOT an
    // upsert: upsert would INSERT a row for any dodaac missing from the table,
    // silently reintroducing the bogus-office problem, and a partial payload
    // would null out office_name on conflict.
    const { error } = await sb
      .from('dodaac_directory')
      .update({ sam_office_name: p.sam_office_name, sam_office_name_updated_at: stamp })
      .eq('dodaac', p.dodaac);
    if (error) throw new Error(`sam_office_name update ${p.dodaac}: ${error.message}`);
    result.updated++;
  }
  return result;
}
