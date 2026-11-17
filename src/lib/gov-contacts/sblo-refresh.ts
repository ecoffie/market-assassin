/**
 * SBLO refresh importer — pure logic + an injectable-IO runner.
 * CLI: scripts/import-sblo-refresh.ts (`npx tsx scripts/import-sblo-refresh.ts --csv <path>`).
 *
 * The canonical roster (src/data/sblo-roster-2026-06.json) is a MANUAL curation — there is
 * no automated producer (docs/DATA-SOURCES-REGISTRY.md §SBLO lineage). This tool does not
 * research anything. It takes a hand-researched CSV in which every contact field carries
 * its own status / date / source URL, and shows (default) or applies (--write) the change
 * against the current roster under rules that can never make the data less verified:
 *
 *   1. A blank cell never overwrites a populated field.
 *   2. not_named / unreachable keep the existing value and mark it stale (staleSince).
 *   3. `changed` replaces a value ONLY with a sourceUrl; the old value goes to history[field].
 *   4. `confirmed` must match the value we hold and carry a sourceUrl; it bumps verifiedAt.
 *   5. A verified company ROLE mailbox is preferred over a personal email: a role mailbox
 *      replaces a personal one (the personal one is kept internally as personalEmail,
 *      status stale), and a personal email never displaces a role mailbox.
 *   6. Any rejected field blocks --write — fix the CSV, then re-run.
 *
 * Diff mode (the default when --write is absent) performs no writes of any kind.
 */
import {
  SBLO_FIELDS, SBLO_FIELD_STORAGE, PROVENANCE_STATUSES, classifyEmailKind,
  type SbloField, type ProvenanceStatus, type FieldProvenance, type FieldHistoryEntry,
  type SbloProvenanceFields, type EmailKind,
} from './sblo-provenance';

// ── Types ─────────────────────────────────────────────────────────────────────────────

export interface RosterContact extends SbloProvenanceFields {
  company?: string;
  name?: string; // prime-DB rows key the company as `name`
  sbloName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  supplierPortal?: string | null;
  source?: string | null;
  [k: string]: unknown;
}

export interface CsvFieldInput {
  value: string;
  status: string; // raw — validated
  verifiedAt: string;
  sourceUrl: string;
}

export interface CsvRow {
  company: string;
  title: string;
  source: string;
  emailKind: string;
  fields: Record<SbloField, CsvFieldInput>;
}

export type FieldAction =
  | 'unchanged'   // nothing to do (blank cell, no status)
  | 'confirmed'   // value re-verified, verifiedAt bumped
  | 'changed'     // value replaced, old value in history
  | 'added'       // field was empty, now populated from a verified source
  | 'marked_stale'// not_named/unreachable, existing value kept
  | 'noted'       // not_named/unreachable on an EMPTY field — provenance recorded, nothing to keep
  | 'kept_role_mailbox' // a personal email was offered but a role mailbox holds the slot
  | 'rejected';

export interface FieldChange {
  field: SbloField | 'title';
  action: FieldAction;
  before: string | null;
  after: string | null;
  status: ProvenanceStatus | null;
  verifiedAt: string | null;
  sourceUrl: string | null;
  reason?: string;
}

export interface CompanyDiff {
  company: string;
  matched: boolean; // present in the base roster
  fields: FieldChange[];
}

export interface DiffReport {
  csv: string;
  base: string;
  mode: 'diff' | 'write';
  summary: {
    csvRows: number;
    companiesInCsv: number;
    newCompanies: number;
    baseCompaniesNotInCsv: number;
    confirmed: number;
    changed: number;
    added: number;
    markedStale: number;
    keptRoleMailbox: number;
    rejected: number;
  };
  companies: CompanyDiff[];
  notInCsv: string[];
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Column name for a field's value. `portal` also accepts the Jun-2026 header `vendorPortal`. */
const VALUE_COLUMNS: Record<SbloField, string[]> = {
  sbloName: ['sbloName'],
  email: ['email'],
  phone: ['phone'],
  portal: ['portal', 'vendorPortal', 'supplierPortal'],
};

export function parseSbloCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/);
  if (!lines[0] || !lines[0].trim()) return [];
  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitLine(lines[i]);
    const r: Record<string, string> = {};
    headers.forEach((h, j) => (r[h] = (cells[j] || '').trim()));
    const pick = (cols: string[]) => cols.map((c) => r[c]).find((v) => v !== undefined && v !== '') ?? '';
    const fields = {} as Record<SbloField, CsvFieldInput>;
    for (const f of SBLO_FIELDS) {
      fields[f] = {
        value: pick(VALUE_COLUMNS[f]),
        status: r[`${f}_status`] ?? '',
        verifiedAt: r[`${f}_verifiedAt`] ?? '',
        sourceUrl: r[`${f}_sourceUrl`] ?? '',
      };
    }
    rows.push({
      company: r.company ?? '',
      title: r.title ?? '',
      source: r.source ?? '',
      emailKind: r.email_kind ?? '',
      fields,
    });
  }
  return rows;
}

// ── Merge ─────────────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/i;

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function sameValue(field: SbloField, a: string, b: string): boolean {
  if (field === 'email' || field === 'portal') return a.toLowerCase() === b.toLowerCase();
  if (field === 'phone') return a.replace(/\D/g, '') === b.replace(/\D/g, '');
  return a.replace(/\s+/g, ' ').toLowerCase() === b.replace(/\s+/g, ' ').toLowerCase();
}

function pushHistory(
  rec: RosterContact, field: SbloField | 'title', entry: FieldHistoryEntry,
): void {
  const history = { ...(rec.history || {}) };
  history[field] = [...(history[field] || []), entry];
  rec.history = history;
}

function setProvenance(rec: RosterContact, field: SbloField, p: FieldProvenance): void {
  rec.provenance = { ...(rec.provenance || {}), [field]: p };
}

function emailKindOf(rec: RosterContact, email: string, explicit?: EmailKind | null): EmailKind | null {
  return classifyEmailKind(email, { sbloName: rec.sbloName, title: rec.title, explicit });
}

/**
 * Apply one CSV row to one existing contact. Returns a NEW object (the input is not
 * mutated) plus the per-field change list. Rejected fields leave the value untouched.
 */
export function mergeSbloContact(
  existing: RosterContact,
  row: CsvRow,
): { next: RosterContact; changes: FieldChange[] } {
  const next: RosterContact = JSON.parse(JSON.stringify(existing));
  const changes: FieldChange[] = [];
  const explicitKind = (['role', 'personal', 'unknown'] as const).find((k) => k === row.emailKind.toLowerCase()) ?? null;
  let identityAccepted = false; // a changed/added name or email lets a new title come with it

  for (const field of SBLO_FIELDS) {
    const key = SBLO_FIELD_STORAGE[field];
    const inp = row.fields[field];
    const before = norm(next[key]) || null;
    const value = norm(inp.value);
    const status = norm(inp.status).toLowerCase();
    const verifiedAt = norm(inp.verifiedAt);
    const sourceUrl = norm(inp.sourceUrl) || null;
    const base: Omit<FieldChange, 'action'> = {
      field, before, after: before, status: null, verifiedAt: verifiedAt || null, sourceUrl,
    };
    const reject = (reason: string) => changes.push({ ...base, action: 'rejected', reason });

    // A field with no status and no value is simply not part of this refresh.
    if (!status) {
      if (value && (!before || !sameValue(field, value, before))) {
        reject('value without a status — every refreshed field needs confirmed|changed|not_named|unreachable');
      } else {
        changes.push({ ...base, action: 'unchanged' });
      }
      continue;
    }
    if (!(PROVENANCE_STATUSES as readonly string[]).includes(status)) {
      reject(`unknown status "${inp.status}"`);
      continue;
    }
    const st = status as ProvenanceStatus;
    base.status = st;
    if (!DATE_RE.test(verifiedAt)) {
      reject('verifiedAt must be YYYY-MM-DD');
      continue;
    }
    if (sourceUrl && !URL_RE.test(sourceUrl)) {
      reject('sourceUrl must be an http(s) URL');
      continue;
    }

    if (st === 'not_named' || st === 'unreachable') {
      // Never blank a populated field on an unverified absence: keep it, mark it stale.
      const prior = next.provenance?.[field];
      setProvenance(next, field, {
        status: st, verifiedAt, sourceUrl,
        staleSince: before ? (prior?.staleSince || verifiedAt) : null,
      });
      changes.push({
        ...base, action: before ? 'marked_stale' : 'noted',
        ...(value ? { reason: `${st}: offered value "${value}" ignored` } : {}),
      });
      continue;
    }

    if (!sourceUrl) {
      reject(`${st} requires a sourceUrl`);
      continue;
    }

    if (st === 'confirmed') {
      if (!before) {
        if (!value) { reject('confirmed on an empty field with no value'); continue; }
        // Nothing held — a verified value with a source is an addition.
      } else if (value && !sameValue(field, value, before)) {
        reject(`confirmed but value "${value}" differs from held "${before}" — use status changed`);
        continue;
      } else {
        setProvenance(next, field, { status: 'confirmed', verifiedAt, sourceUrl, staleSince: null });
        changes.push({ ...base, action: 'confirmed' });
        continue;
      }
    }

    // changed (or confirmed-on-empty): needs a real value.
    if (!value) {
      reject(`${st} with a blank value — a blank never replaces a field; use not_named`);
      continue;
    }
    if (before && sameValue(field, value, before)) {
      setProvenance(next, field, { status: 'confirmed', verifiedAt, sourceUrl, staleSince: null });
      changes.push({ ...base, status: 'confirmed', action: 'confirmed', reason: 'changed but value equals held value' });
      continue;
    }

    if (field === 'email' && before) {
      const newKind = emailKindOf(next, value, explicitKind);
      const oldKind = emailKindOf(next, before, next.emailKind ?? null);
      if (newKind === 'personal' && oldKind === 'role') {
        // A role mailbox holds the slot; the verified personal email is kept internally only.
        next.personalEmail = value;
        next.personalEmailStatus = 'confirmed';
        changes.push({ ...base, action: 'kept_role_mailbox', reason: 'personal email offered; role mailbox kept as the served email' });
        continue;
      }
      if (newKind === 'role' && oldKind !== 'role') {
        next.personalEmail = before;
        next.personalEmailStatus = 'stale';
      }
    }

    if (before) {
      pushHistory(next, field, {
        value: before,
        provenance: next.provenance?.[field] ?? null,
        replacedAt: verifiedAt,
        replacedBecause: field === 'email' && emailKindOf(next, value, explicitKind) === 'role'
          && emailKindOf(next, before, next.emailKind ?? null) !== 'role'
          ? 'role_mailbox_preferred' : 'changed',
      });
    }
    (next as Record<string, unknown>)[key] = value;
    if (field === 'email') next.emailKind = explicitKind ?? null;
    setProvenance(next, field, { status: 'changed', verifiedAt, sourceUrl, staleSince: null });
    changes.push({ ...base, status: 'changed', action: before ? 'changed' : 'added', after: value });
    if (field === 'sbloName' || field === 'email') identityAccepted = true;
  }

  // Title has no provenance of its own: it may only move together with an accepted
  // name/email change, and never to a blank.
  const newTitle = norm(row.title);
  const oldTitle = norm(next.title) || null;
  if (identityAccepted && newTitle && newTitle !== oldTitle) {
    const nameProv = next.provenance?.sbloName ?? next.provenance?.email ?? null;
    if (oldTitle) {
      pushHistory(next, 'title', {
        value: oldTitle, provenance: null,
        replacedAt: nameProv?.verifiedAt ?? '', replacedBecause: 'changed',
      });
    }
    next.title = newTitle;
    changes.push({
      field: 'title', action: oldTitle ? 'changed' : 'added', before: oldTitle, after: newTitle,
      status: 'changed', verifiedAt: nameProv?.verifiedAt ?? null, sourceUrl: nameProv?.sourceUrl ?? null,
    });
  }

  const accepted = changes.some((c) => c.action !== 'unchanged' && c.action !== 'rejected');
  if (accepted && norm(row.source)) next.source = norm(row.source);
  return { next, changes };
}

// ── Company matching (roster: normalized exact; prime DB: the importer's curated aliases) ─

export function normCompany(n: string): string {
  return (n || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[,.'"\-()]/g, ' ')
    .replace(/\b(LLC|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|THE)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Roster company → the EXACT prime-DB name (carried over from the Jun-2026 importer). */
export const PRIME_ALIAS: Record<string, string> = {
  'BOOZ ALLEN HAMILTON INCORPORATED': 'BOOZ ALLEN HAMILTON INC',
  'SAIC': 'SCIENCE APPLICATIONS INTERNATIONAL CORPORATION',
  'WSP': 'WSP USA INC.',
  'RAYTHEON COMPANY (RTX)': 'RAYTHEON COMPANY',
  'CGI Federal': 'CGI INC',
  'IBM US Federal': 'INTERNATIONAL BUSINESS MACHINES CORPORATION',
  'KPMG': 'KPMG L.L.P.',
  'DELOITTE (FEDERAL)': 'DELOITTE CONSULTING LLP',
  'QINETIQ NORTH AMERICA, INC.': 'QINETIQ INC.',
  'Fluor Government Group': 'FLUOR FEDERAL SERVICES INC',
  'General Atomics Aeronautical Systems, Inc.': 'GENERAL ATOMICS',
  'Mortenson': 'M. A. MORTENSON COMPANIES  INC.',
  'NTTData Federal': 'NTT DATA FEDERAL SERVICES  INC.',
  'Accenture': 'ACCENTURE FEDERAL SERVICES LLC',
  'Amentum': 'AMENTUM SERVICES  INC.',
  'APTIM': 'APTIM FEDERAL SERVICES  LLC',
  'SIKORSKY AIRCRAFT (LOCKHEED MARTIN)': 'SIKORSKY AIRCRAFT CORPORATION',
  'Gilbane Building Company': 'GILBANE FEDERAL',
  'AAI CORPORATION': 'TEXTRON SYSTEMS CORP',
};

export function buildPrimeFinder(primes: RosterContact[]): (company: string) => RosterContact | null {
  const byNorm = new Map<string, RosterContact>();
  for (const p of primes) {
    const k = normCompany(String(p.name || ''));
    if (!byNorm.has(k)) byNorm.set(k, p);
  }
  const exact = new Map(primes.map((p) => [String(p.name || ''), p]));
  return (company: string) => {
    if (PRIME_ALIAS[company]) {
      const t = PRIME_ALIAS[company];
      return exact.get(t) || byNorm.get(normCompany(t)) || null;
    }
    const k = normCompany(company);
    if (byNorm.has(k)) return byNorm.get(k)!;
    if (k.length >= 5) {
      const hits = [...byNorm.keys()].filter((pk) => pk.startsWith(k + ' ')).sort((a, b) => a.length - b.length);
      if (hits.length) return byNorm.get(hits[0])!;
    }
    const kt = k.split(' ').filter(Boolean);
    if (kt.length >= 2) {
      const hits = primes
        .filter((p) => { const s = new Set(normCompany(String(p.name || '')).split(' ')); return kt.every((t) => s.has(t)); })
        .sort((a, b) => String(a.name).length - String(b.name).length);
      if (hits.length) return hits[0];
    }
    return null;
  };
}

// ── Diff over a whole roster ──────────────────────────────────────────────────────────

export function diffRoster(
  baseContacts: RosterContact[],
  rows: CsvRow[],
  meta: { csv: string; base: string; mode: 'diff' | 'write' },
): { report: DiffReport; merged: RosterContact[] } {
  const merged: RosterContact[] = baseContacts.map((c) => JSON.parse(JSON.stringify(c)));
  const index = new Map<string, number>();
  merged.forEach((c, i) => { const k = normCompany(String(c.company || '')); if (k && !index.has(k)) index.set(k, i); });

  const companies: CompanyDiff[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (!row.company) continue;
    const k = normCompany(row.company);
    const at = index.get(k);
    const existing: RosterContact = at !== undefined
      ? merged[at]
      : { company: row.company, sbloName: null, title: null, email: null, phone: null, supplierPortal: null, source: null };
    const { next, changes } = mergeSbloContact(existing, row);
    if (at !== undefined) { merged[at] = next; seen.add(at); } else if (changes.some((c) => c.action !== 'unchanged' && c.action !== 'rejected')) {
      merged.push(next);
    }
    companies.push({ company: row.company, matched: at !== undefined, fields: changes });
  }

  const count = (a: FieldAction) => companies.reduce((n, c) => n + c.fields.filter((f) => f.action === a).length, 0);
  const notInCsv = merged.slice(0, baseContacts.length).map((c, i) => (seen.has(i) ? null : String(c.company || ''))).filter((x): x is string => !!x);
  const report: DiffReport = {
    ...meta,
    summary: {
      csvRows: rows.length,
      companiesInCsv: companies.length,
      newCompanies: companies.filter((c) => !c.matched).length,
      baseCompaniesNotInCsv: notInCsv.length,
      confirmed: count('confirmed'),
      changed: count('changed'),
      added: count('added'),
      markedStale: count('marked_stale'),
      keptRoleMailbox: count('kept_role_mailbox'),
      rejected: count('rejected'),
    },
    companies,
    notInCsv,
  };
  return { report, merged };
}

export function renderDiffText(report: DiffReport): string {
  const s = report.summary;
  const out: string[] = [
    `SBLO refresh — ${report.mode === 'write' ? 'WRITE' : 'DIFF ONLY (no files written)'}`,
    `  csv:  ${report.csv}`,
    `  base: ${report.base}`,
    `  rows ${s.csvRows} · new companies ${s.newCompanies} · base companies not in CSV ${s.baseCompaniesNotInCsv}`,
    `  confirmed ${s.confirmed} · changed ${s.changed} · added ${s.added} · marked stale ${s.markedStale} · kept role mailbox ${s.keptRoleMailbox} · REJECTED ${s.rejected}`,
    '',
  ];
  for (const c of report.companies) {
    const moved = c.fields.filter((f) => f.action !== 'unchanged');
    if (!moved.length) continue;
    out.push(`${c.company}${c.matched ? '' : '  [NEW — not in base roster]'}`);
    for (const f of moved) {
      const arrow = f.before === f.after ? `${f.before ?? '∅'}` : `${f.before ?? '∅'} → ${f.after ?? '∅'}`;
      const prov = [f.status, f.verifiedAt, f.sourceUrl].filter(Boolean).join(' · ');
      out.push(`  ${f.field.padEnd(8)} ${f.action.toUpperCase().padEnd(17)} ${arrow}${prov ? `  (${prov})` : ''}${f.reason ? `  — ${f.reason}` : ''}`);
    }
  }
  return out.join('\n');
}

// ── Runner (injectable IO so tests can prove diff mode writes nothing) ────────────────

export interface ImporterIO {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
  resolve(path: string): string;
  log(line: string): void;
  error(line: string): void;
}

export const DEFAULT_BASE_ROSTER = 'src/data/sblo-roster-2026-06.json';
export const PRIME_DB_PATH = 'src/data/prime-contractors-database.json';

export const USAGE = [
  'Usage: npx tsx scripts/import-sblo-refresh.ts --csv <path> [--base <roster.json>] [--json]',
  '       npx tsx scripts/import-sblo-refresh.ts --csv <path> --write --out <new-roster.json> [--merge-prime-db]',
  '',
  '  --csv <path>       REQUIRED. Hand-researched refresh CSV (no default; the Jun-2026 file was',
  '                     data/imports/sblo-refresh-2026-06.csv and is never assumed).',
  `  --base <path>      Roster to diff against (default ${DEFAULT_BASE_ROSTER}). Never written.`,
  '  --json             Print only the JSON report.',
  '  --write            Apply. Requires --out; refused while any field is rejected.',
  '  --out <path>       NEW roster file to write. Must not exist and must not be the base roster.',
  '  --merge-prime-db   Also apply the same rules to matched rows of prime-contractors-database.json.',
  '',
  '  Without --write this is DIFF ONLY and writes nothing.',
].join('\n');

function argValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

/** Returns a process exit code. */
export function runSbloImport(argv: string[], io: ImporterIO): number {
  const csv = argValue(argv, '--csv');
  if (!csv) {
    io.error('ERROR: --csv <path> is required. There is no default input file.');
    io.error(USAGE);
    return 2;
  }
  const write = argv.includes('--write');
  const asJson = argv.includes('--json');
  const mergePrime = argv.includes('--merge-prime-db');
  const baseArg = argValue(argv, '--base');
  const base = baseArg || DEFAULT_BASE_ROSTER;
  const out = argValue(argv, '--out');

  if (!io.exists(csv)) { io.error(`ERROR: CSV not found: ${csv}`); return 2; }
  if (!io.exists(base)) { io.error(`ERROR: base roster not found: ${base}`); return 2; }
  if (write) {
    if (!out) { io.error('ERROR: --write requires --out <new-roster.json> (the base roster is never overwritten).'); return 2; }
    if (io.resolve(out) === io.resolve(base) || io.resolve(out) === io.resolve(DEFAULT_BASE_ROSTER)) {
      io.error('ERROR: --out must be a NEW file, not the base / canonical roster.'); return 2;
    }
    if (io.exists(out)) { io.error(`ERROR: --out already exists: ${out} (refusing to overwrite).`); return 2; }
  } else if (mergePrime || out) {
    io.error('NOTE: --out / --merge-prime-db are ignored without --write (diff only).');
  }

  const rows = parseSbloCsv(io.readFile(csv));
  const roster = JSON.parse(io.readFile(base)) as { metadata?: Record<string, unknown>; contacts?: RosterContact[] };
  const { report, merged } = diffRoster(roster.contacts || [], rows, { csv, base, mode: write ? 'write' : 'diff' });

  if (asJson) io.log(JSON.stringify(report, null, 2));
  else { io.log(renderDiffText(report)); io.log('\n--- JSON report ---'); io.log(JSON.stringify(report, null, 2)); }

  if (!write) return 0;

  if (report.summary.rejected > 0) {
    io.error(`REFUSED: ${report.summary.rejected} field(s) rejected — fix the CSV and re-run. Nothing written.`);
    return 1;
  }

  const outDoc = {
    metadata: {
      ...(roster.metadata || {}),
      refreshedFrom: { csv, base },
      fieldProvenance: 'per-field status/verifiedAt/sourceUrl (src/lib/gov-contacts/sblo-provenance.ts)',
      companyCount: merged.length,
    },
    contacts: merged,
  };
  io.writeFile(out!, JSON.stringify(outDoc, null, 2) + '\n');
  io.log(`wrote ${out}`);

  if (mergePrime) {
    const db = JSON.parse(io.readFile(PRIME_DB_PATH)) as { primes: RosterContact[] };
    const find = buildPrimeFinder(db.primes);
    let touched = 0;
    for (const row of rows) {
      const p = find(row.company);
      if (!p) continue;
      const { next, changes } = mergeSbloContact(p, row);
      if (changes.some((c) => c.action !== 'unchanged' && c.action !== 'rejected')) {
        Object.assign(p, next);
        touched++;
      }
    }
    io.writeFile(PRIME_DB_PATH, JSON.stringify(db, null, 2));
    io.log(`merged ${touched} prime-DB rows into ${PRIME_DB_PATH}`);
  }
  return 0;
}
