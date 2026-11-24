/**
 * Intelligence gate: what may appear in a published report. The checks decide which records are pursuable;
 * this makes the REPORT agree with them, then verifies it before anything is saved or shared.
 *
 * Found on the Florida janitorial report (2026-11-24): the recompete table carried Gulfport MS and Washington DC
 * custodial contracts labelled FL, and the contacts block (labelled Veterans Affairs) listed Interior staff from
 * the office that awarded exactly those excluded contracts. A contract number (PIID) begins with its awarding
 * office's code, so a contact is tied to a contract only by that prefix. No name or agency guessing.
 */
import type { RecordCheck } from './evidence-checks';
import type { MarketReportResult } from '@/mcp/tools/market-report';

interface Person { office_code?: string | null; office?: string | null; [k: string]: unknown }
interface Contacts { agency?: string | null; office?: string | null; office_codes?: string[]; people?: Person[]; total?: number; [k: string]: unknown }
interface Row { contract_id?: string; piid?: string | null; awarding_agency?: string | null; [k: string]: unknown }

const up = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** A person belongs to a listed contract when their office code is the start of its PIID. */
export function personTiedToRows(p: Person, rows: Row[]): Row | undefined {
  const code = up(p.office_code);
  if (code.length < 4) return undefined;
  return rows.find((r) => up(r.piid).startsWith(code));
}

export interface CleanResult {
  report: MarketReportResult;
  removed: { recompetes: number; contacts: number };
}

/** Keep only pursuable records in the recompete table, and only contacts tied to them. Never adds anything. */
export function cleanReportForPublish(report: MarketReportResult, checks: RecordCheck[]): CleanResult {
  const pursue = new Set(checks.filter((c) => c.verdict === 'pursue').map((c) => c.contract_id));
  const rows = ((report.sections.recompetes?.contracts as Row[]) || []);
  const kept = rows.filter((r) => pursue.has(String(r.contract_id)));
  const contacts = report.sections.contacts as unknown as Contacts | null;
  const people = contacts?.people || [];
  const keptPeople = people.filter((p) => personTiedToRows(p, kept));
  const agencies = [...new Set(keptPeople.map((p) => personTiedToRows(p, kept)?.awarding_agency).filter(Boolean))] as string[];
  const cleanedContacts: Contacts | null = keptPeople.length && contacts
    ? {
        ...contacts,
        people: keptPeople,
        office_codes: [...new Set(keptPeople.map((p) => up(p.office_code)))],
        agency: agencies.length === 1 ? agencies[0] : agencies.length ? agencies.join('; ') : null,
        office: keptPeople[0]?.office ?? null,
        total: keptPeople.length,
      }
    : null;
  const next: MarketReportResult = {
    ...report,
    summary: { ...report.summary, recompetes: kept.length, contacts: keptPeople.length } as MarketReportResult['summary'],
    sections: {
      ...report.sections,
      recompetes: { ...report.sections.recompetes, contracts: kept, count: kept.length },
      contacts: cleanedContacts as MarketReportResult['sections']['contacts'],
    },
  };
  return { report: next, removed: { recompetes: rows.length - kept.length, contacts: people.length - keptPeople.length } };
}

export interface IntegrityFinding { pass: boolean; reason: string }

/** Hard checks on the report itself. Any failure blocks publication. */
export function reportIntegrity(
  report: MarketReportResult,
  checks: RecordCheck[],
  opts: { requestedState?: string | null; html?: string } = {},
): IntegrityFinding[] {
  const pursue = new Set(checks.filter((c) => c.verdict === 'pursue').map((c) => c.contract_id));
  const rows = ((report.sections.recompetes?.contracts as Row[]) || []);
  const out: IntegrityFinding[] = [];
  const bad = rows.filter((r) => !pursue.has(String(r.contract_id)));
  out.push(bad.length
    ? { pass: false, reason: `${bad.length} contract(s) in the report's table were ruled out (${bad.map((r) => r.piid || r.contract_id).join(', ')}).` }
    : { pass: true, reason: 'Every contract in the table is a pursuable record.' });

  const contacts = report.sections.contacts as unknown as Contacts | null;
  const untied = (contacts?.people || []).filter((p) => !personTiedToRows(p, rows));
  out.push(untied.length
    ? { pass: false, reason: `${untied.length} contact(s) are not from an office that awarded a contract in the report.` }
    : { pass: true, reason: 'Every contact is from the office that awarded a listed contract.' });
  if (contacts?.people?.length) {
    const rowAgencies = new Set(rows.map((r) => up(r.awarding_agency)));
    const labels = String(contacts.agency || '').split(';').map(up).filter(Boolean);
    const wrong = labels.filter((l) => !rowAgencies.has(l));
    out.push(wrong.length
      ? { pass: false, reason: `The contacts are labelled "${contacts.agency}", which is not the agency of any listed contract.` }
      : { pass: true, reason: 'The contacts label matches the listed contracts.' });
  }

  const basis = report.summary?.total_market_basis as { state_scoped?: boolean } | undefined;
  if (opts.requestedState && basis && basis.state_scoped === false && report.summary?.total_market) {
    const labelled = opts.html ? /national/i.test(opts.html) : false;
    out.push(labelled
      ? { pass: true, reason: 'The market total is labelled national.' }
      : { pass: false, reason: `The market total is national but the question asked about ${opts.requestedState}, and the report does not say national.` });
  }
  return out;
}
