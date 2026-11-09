/**
 * SBA certification status from a SAM.gov entity record — the ONE place that decides whether
 * a company is 8(a) / HUBZone / WOSB / EDWOSB certified, not certified, or not established.
 *
 * ── WHY THIS EXISTS (company-intelligence audit, 2026-11-09) ─────────────────────────────
 * `lookup_sam_entity` told an assistant AMS Consulting and Design (TH2ZULPHFJS8) was NOT 8(a)
 * and NOT HUBZone (`has8a:false, hasHUBZone:false`, source sam_live, degraded false). SBA's
 * own Small Business Search shows 8(a), HUBZone, WOSB and EDWOSB all active for that UEI.
 * Live SAM returned `sbaBusinessTypeList` as FOUR entries with every field null — code,
 * description, entry and exit date. The mapper dropped the blank labels and read the empty
 * remainder as "no". A list SAM did not fill in is not a list of zero certifications.
 *
 * Second defect, same audit: Jordon Construction (N4BAZDMM7DV7) carries ONE HUBZone row with
 * `certificationEntryDate 2024-04-05` and `certificationExitDate 2024-03-18`. The exit is
 * OLDER than the entry — the firm left the program and came back. SBA shows HUBZone active.
 * An older exit date must never overwrite a later re-entry.
 *
 * ── THE STATUSES ──────────────────────────────────────────────────────────────────────────
 *   active          SAM lists the SBA certification and its dates say it is in force.
 *   inactive        SAM lists it and its dates say it has ended (exit passed, no re-entry).
 *   not_listed      SAM returned a complete, readable list that does not include it. This is
 *                   SAM's negative; it can lag SBA, and it is the only status that maps to a
 *                   `false` boolean besides `inactive`.
 *   not_established SAM did not give us enough to say: blank entries, no list at all,
 *                   unreadable or contradictory dates. UNKNOWN — never "not certified".
 *
 * ⚠️ PROVENANCE: everything here is SBA certification data AS RELAYED BY SAM.gov. Nothing in
 * this module has checked SBA directly, so no record claims SBA verification — `basis` says
 * where the evidence sits, and the label says "listed in SAM.gov".
 */

export type CertProgram = '8(a)' | 'HUBZone' | 'WOSB' | 'EDWOSB';
export type CertificationStatus = 'active' | 'inactive' | 'not_listed' | 'not_established';

export interface CertificationRecord {
  program: CertProgram;
  status: CertificationStatus;
  /**
   * Where the evidence sits. `sam_sba_certification_list` = SAM's sbaBusinessTypeList (SBA
   * certifications relayed by SAM). `sam_extract` = Mindy's stored copy of a SAM bulk
   * extract. `none` = no evidence for this program at all.
   */
  basis: 'sam_sba_certification_list' | 'sam_extract' | 'none';
  source_label: string;
  /** SAM's own code(s) for the entries used, verbatim. */
  sam_codes: string[];
  /** Start of the CURRENT participation (after a re-entry, the re-entry date). */
  entry_date: string | null;
  /** End of the current participation; for 8(a) a future date is the scheduled program term. */
  exit_date: string | null;
  /** An exit SAM reports that is older than the current entry — kept, never applied. */
  prior_exit_date?: string | null;
  /** Machine-readable reasons, including every uncertainty. Empty only for a clean read. */
  reasons: string[];
}

export const CERT_PROGRAMS: readonly CertProgram[] = ['8(a)', 'HUBZone', 'WOSB', 'EDWOSB'];

// Verified SAM v3 codes. A6/JT/XX: entity-api.ts (2026-06-04). A0/A9: live GHFYLESVE2V5
// (2026-11-09) — "SBA-Certified Economically Disadvantaged Women-Owned Small Business" and
// "SBA-Certified Women-Owned Small Business".
const CODE_PROGRAM: Record<string, CertProgram> = {
  A6: '8(a)',
  JT: '8(a)',
  XX: 'HUBZone',
  A9: 'WOSB',
  A0: 'EDWOSB',
};

/** Program from SAM's description text (self-describing), else the code; null = unknown. */
export function programOf(code: string, desc: string): CertProgram | null {
  const d = desc.toLowerCase();
  if (d.includes('8(a)')) return '8(a)';
  if (d.includes('hubzone')) return 'HUBZone';
  if (d.includes('women')) return d.includes('economically') ? 'EDWOSB' : 'WOSB';
  return CODE_PROGRAM[code.toUpperCase().trim()] ?? null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type DateRead = { ok: true; value: string | null } | { ok: false };

function readDate(v: unknown): DateRead {
  if (v == null || v === '') return { ok: true, value: null };
  const s = String(v).trim().slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return { ok: false };
  return { ok: true, value: s };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

interface EntryVerdict {
  status: 'active' | 'inactive' | 'not_established';
  code: string;
  entry: string | null;
  exit: string | null;
  priorExit: string | null;
  reasons: string[];
}

/** One recognised SAM entry → its own verdict. Dates are ISO strings, so `<` is chronological. */
function judgeEntry(code: string, rawEntry: unknown, rawExit: unknown, asOf: string): EntryVerdict {
  const entry = readDate(rawEntry);
  const exit = readDate(rawExit);
  if (!entry.ok || !exit.ok) {
    return { status: 'not_established', code, entry: null, exit: null, priorExit: null, reasons: ['unreadable_date'] };
  }
  const en = entry.value;
  const ex = exit.value;
  const base = { code, entry: en, priorExit: null as string | null };

  if (en && en > asOf) {
    return { ...base, status: 'not_established', exit: ex, reasons: ['entry_date_in_future'] };
  }
  if (!ex) {
    return { ...base, status: 'active', exit: null, reasons: en ? [] : ['dates_not_provided'] };
  }
  if (ex >= asOf) {
    return { ...base, status: 'active', exit: ex, reasons: ['scheduled_exit_date'] };
  }
  // The exit has passed. A LATER entry means the firm re-entered the program after that exit
  // (Jordon: exit 2024-03-18, entry 2024-04-05). The old exit is history, not the status.
  if (en && en > ex) {
    return { code, status: 'active', entry: en, exit: null, priorExit: ex, reasons: ['re_entered_after_exit'] };
  }
  return { ...base, status: 'inactive', exit: ex, reasons: en ? ['exit_date_passed'] : ['exit_date_passed', 'entry_date_not_provided'] };
}

function combine(program: CertProgram, verdicts: EntryVerdict[]): CertificationRecord {
  const label = 'SBA certification as listed in SAM.gov';
  const codes = Array.from(new Set(verdicts.map((v) => v.code).filter(Boolean)));
  const active = verdicts.filter((v) => v.status === 'active');
  const inactive = verdicts.filter((v) => v.status === 'inactive');
  const unknown = verdicts.filter((v) => v.status === 'not_established');

  if (active.length) {
    // Conflict: an ended entry whose exit is LATER than the start of the "active" entry says
    // the program ended after that participation began. Two SAM rows disagree — do not pick.
    const latestActiveEntry = active.map((v) => v.entry).filter(Boolean).sort().pop() ?? null;
    const contradicted = inactive.some((v) => v.exit && (!latestActiveEntry || v.exit > latestActiveEntry));
    if (contradicted) {
      return {
        program, status: 'not_established', basis: 'sam_sba_certification_list', source_label: label,
        sam_codes: codes, entry_date: null, exit_date: null, reasons: ['conflicting_sam_entries'],
      };
    }
    const pick = [...active].sort((a, b) => String(b.entry ?? '').localeCompare(String(a.entry ?? '')))[0];
    return {
      program, status: 'active', basis: 'sam_sba_certification_list', source_label: label,
      sam_codes: codes, entry_date: pick.entry, exit_date: pick.exit,
      ...(pick.priorExit ? { prior_exit_date: pick.priorExit } : {}),
      reasons: Array.from(new Set(active.flatMap((v) => v.reasons))),
    };
  }
  if (unknown.length) {
    return {
      program, status: 'not_established', basis: 'sam_sba_certification_list', source_label: label,
      sam_codes: codes, entry_date: null, exit_date: null,
      reasons: Array.from(new Set(unknown.flatMap((v) => v.reasons))),
    };
  }
  const last = [...inactive].sort((a, b) => String(b.exit ?? '').localeCompare(String(a.exit ?? '')))[0];
  return {
    program, status: 'inactive', basis: 'sam_sba_certification_list', source_label: label,
    sam_codes: codes, entry_date: last.entry, exit_date: last.exit,
    reasons: Array.from(new Set(inactive.flatMap((v) => v.reasons))),
  };
}

/**
 * Interpret SAM's `sbaBusinessTypeList`. `list` is whatever SAM returned — undefined, null, an
 * array of objects, or (older shapes) bare code strings. `asOf` is the YYYY-MM-DD day the dates
 * are judged against (default: today, UTC).
 */
export function interpretSbaCertifications(list: unknown, asOf?: string): CertificationRecord[] {
  const today = asOf && DATE_RE.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);

  if (!Array.isArray(list)) {
    return CERT_PROGRAMS.map((program) => ({
      program, status: 'not_established' as const, basis: 'none' as const,
      source_label: 'SAM.gov returned no SBA certification list',
      sam_codes: [], entry_date: null, exit_date: null, reasons: ['sam_certification_list_absent'],
    }));
  }

  // ⚠️ SAM NEVER RETURNS AN EMPTY LIST. Measured 2026-11-09 across 31,664 cached entity
  // responses: 28,181 carry exactly ONE all-null entry, and the stored SAM extract shows any SBA
  // record for only 392 of them (1.4%). A lone blank entry is SAM's "none" placeholder, so it
  // is read as an empty list (not_listed). Two or more blanks — or a blank beside a real
  // entry — are different: 160 firms show 2–4 all-null entries and the extract holds SBA
  // records for 71% of them (100% at 3–4). Those blanks are real certifications SAM withheld
  // (AMS TH2ZULPHFJS8: four blanks, four active SBA certifications) → not_established.
  // The residue the placeholder rule gets wrong (≈201 firms whose extract shows current 8(a))
  // is caught where it matters: lookup_sam_entity cross-checks the stored extract
  // (`downgradeOnExtractConflict` in mcp/tools/sam-entity.ts).
  const isBlankEntry = (x: unknown) =>
    x == null || x === ''
    || (typeof x === 'object' && !str((x as Record<string, unknown>).sbaBusinessTypeCode)
      && !str((x as Record<string, unknown>).sbaBusinessTypeDesc));
  const placeholderOnly = list.length === 1 && isBlankEntry(list[0]);

  const byProgram = new Map<CertProgram, EntryVerdict[]>();
  let unattributed = 0;
  for (const item of list) {
    if (typeof item === 'string') {
      const program = programOf(item, '');
      if (!program) { if (item.trim()) continue; unattributed++; continue; }
      // A bare code carries no dates: listed, so in force as far as SAM says.
      const v: EntryVerdict = { status: 'active', code: item.trim(), entry: null, exit: null, priorExit: null, reasons: ['dates_not_provided'] };
      byProgram.set(program, [...(byProgram.get(program) ?? []), v]);
      continue;
    }
    if (!item || typeof item !== 'object') { unattributed++; continue; }
    const t = item as Record<string, unknown>;
    const code = str(t.sbaBusinessTypeCode);
    const desc = str(t.sbaBusinessTypeDesc);
    if (!code && !desc) {
      // THE AMS CASE: an entry exists but SAM left every identifying field blank. It is some
      // certification — we cannot say which, so it poisons every negative below.
      unattributed++;
      continue;
    }
    const program = programOf(code, desc);
    if (!program) continue; // a real, readable entry for a program this module does not track
    byProgram.set(program, [...(byProgram.get(program) ?? []), judgeEntry(code, t.certificationEntryDate, t.certificationExitDate, today)]);
  }

  return CERT_PROGRAMS.map((program) => {
    const verdicts = byProgram.get(program);
    if (verdicts?.length) {
      const rec = combine(program, verdicts);
      // An unreadable sibling entry could be a second, contradicting row for this program —
      // only matters for a negative; an active read stands on its own evidence.
      if (unattributed && rec.status === 'inactive') {
        return { ...rec, status: 'not_established' as const, reasons: [...rec.reasons, 'sam_returned_blank_certification_entries'] };
      }
      return rec;
    }
    if (unattributed && !placeholderOnly) {
      return {
        program, status: 'not_established' as const, basis: 'sam_sba_certification_list' as const,
        source_label: 'SAM.gov returned SBA certification entries with no program or dates',
        sam_codes: [], entry_date: null, exit_date: null,
        reasons: ['sam_returned_blank_certification_entries'],
      };
    }
    return {
      program, status: 'not_listed' as const, basis: 'none' as const,
      // ⚠️ The placeholder reading is an EMPIRICAL rule, not documented SAM semantics: GSA's
      // Entity API docs say nothing about what an uncertified firm's list looks like. So the
      // label says what SAM showed, never "not certified".
      source_label: placeholderOnly
        ? 'SAM.gov returned only its empty placeholder entry: no SBA certification listed in SAM (not an SBA determination of non-certification)'
        : 'Not listed in the SBA certifications SAM.gov returned (not an SBA determination of non-certification)',
      sam_codes: [], entry_date: null, exit_date: null,
      reasons: placeholderOnly ? ['sam_placeholder_entry'] : [],
    };
  });
}

/**
 * Stale/conflicting evidence. A live `not_listed` that rests ONLY on SAM's placeholder entry is
 * contradicted when Mindy's stored SAM extract shows that program for the same UEI. Neither
 * source wins: the negative becomes not_established. This can only WEAKEN a negative — it never
 * turns the extract into a positive claim (the extract's HUBZone dates are known-unreliable).
 * `extractShows[p] === true` means the extract lists program p as certified. `'conflicting'`
 * means the extract's own two columns disagree about p (listed in `certifications` while
 * certification_records says expired — the Jordon pattern, where SBA showed HUBZone ACTIVE).
 * That is contradictory evidence, not agreement with SAM's placeholder, so it weakens the
 * negative too (measured 2026-11-09: 97 8(a) + 4 HUBZone placeholder firms). It never
 * becomes a positive.
 */
export function downgradeOnExtractConflict(
  records: CertificationRecord[],
  extractShows: Partial<Record<CertProgram, boolean | 'conflicting' | undefined>>,
): { records: CertificationRecord[]; downgraded: CertProgram[] } {
  const downgraded: CertProgram[] = [];
  const out = records.map((r) => {
    if (r.status !== 'not_listed' || !r.reasons.includes('sam_placeholder_entry')) return r;
    const shown = extractShows[r.program];
    if (shown !== true && shown !== 'conflicting') return r;
    downgraded.push(r.program);
    return {
      ...r,
      status: 'not_established' as const,
      source_label: shown === 'conflicting'
        ? 'SAM.gov listed no certification, and Mindy\'s stored SAM extract holds contradictory records for it'
        : 'SAM.gov listed no certification, but Mindy\'s stored SAM extract shows one',
      reasons: shown === 'conflicting'
        ? [...r.reasons, 'conflicts_with_stored_sam_extract', 'stored_extract_fields_conflict']
        : [...r.reasons, 'conflicts_with_stored_sam_extract'],
    };
  });
  return { records: out, downgraded };
}

/**
 * FAIL SAFE: when the extract cross-check could not run, a negative that rests only on SAM's
 * placeholder has nothing behind it but an empirical rule — so it becomes not_established.
 * Negatives from a complete readable list or a passed exit date are untouched.
 */
export function downgradeUncheckedPlaceholderNegatives(records: CertificationRecord[]): CertificationRecord[] {
  return records.map((r) =>
    r.status === 'not_listed' && r.reasons.includes('sam_placeholder_entry')
      ? {
          ...r,
          status: 'not_established' as const,
          source_label: 'SAM.gov listed no certification, and the stored-extract cross-check could not run',
          reasons: [...r.reasons, 'extract_cross_check_unavailable'],
        }
      : r,
  );
}

/** Tri-state flag: true / false / undefined (= unknown — callers must leave the field ABSENT). */
export function certFlag(records: CertificationRecord[], ...programs: CertProgram[]): boolean | undefined {
  const rs = records.filter((r) => programs.includes(r.program));
  if (!rs.length) return undefined;
  if (rs.some((r) => r.status === 'active')) return true;
  if (rs.some((r) => r.status === 'not_established')) return undefined;
  return false;
}

/** Programs whose status is unknown — the assistant-facing caveat names them. */
export function unestablishedPrograms(records: CertificationRecord[]): CertProgram[] {
  return records.filter((r) => r.status === 'not_established').map((r) => r.program);
}
