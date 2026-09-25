/**
 * Shared strategic reader — legislation family.
 *
 * Fixture rows copy the SHAPE of production `institute_sources` legislative rows
 * (measured 2026-09-25: 29 rows; FY2027 H.R. 8800 IH/RH/EH + S. 4784 RS + two
 * committee reports; FY2026 S. 1071 → PL 119-60, plus H.R. 3838 / S. 2296 that did
 * not become law; S. Rept. 119-39 and its errata as SEPARATE records).
 */
import { describe, it, expect } from 'vitest';
import {
  groupLegislativeEvidence,
  legislativeCoverage,
  legislativeAgencyGrain,
  hostRules,
  billLabel,
  getLegislativeEvidenceForAgency,
} from './legislative-evidence';

const DOD = 'Department of Defense';

function bill(doc: string, o: {
  type: string; num: string; code: string; label: string; stage: string; law: string;
  fy?: number | null; amends?: number; role?: string; date?: string | null; becameLaw?: boolean;
  lawNumber?: string | null; action?: [string, string]; sourceType?: string; agency?: string | null;
}) {
  return {
    source_type: o.sourceType ?? 'introduced_bill',
    document_number: doc,
    title: `x [${o.type} ${o.num} — ${o.label}]`,
    source_url: `https://www.congress.gov/119/bills/${o.type.toLowerCase()}${o.num}/BILLS-119${o.type.toLowerCase()}${o.num}${o.code.toLowerCase()}.htm`,
    publication_date: o.date ?? null,
    canonical_agency: o.agency === undefined ? DOD : o.agency,
    raw: {
      congress: 119, chamber: o.type === 'HR' ? 'House' : 'Senate', billType: o.type, billNumber: o.num,
      billTitle: 'National Defense Authorization Act for Fiscal Year X', legislativeVersion: o.label,
      versionCode: o.code, legislativeStage: o.stage, lawStatusAtIngestion: o.law,
      measureRole: o.role ?? 'authorization_vehicle', fiscalYear: o.fy ?? null,
      ...(o.amends ? { amendsFiscalYear: o.amends } : {}),
      becameLaw: o.becameLaw ?? false, lawNumber: o.lawNumber ?? null,
      latestActionDate: o.action?.[0] ?? null, latestActionText: o.action?.[1] ?? null,
    },
  };
}

function report(doc: string, citation: string, assoc: { type: string; number: string }, date: string | null, agency: string | null = DOD) {
  return {
    source_type: 'committee_report', document_number: doc, title: `${citation}`,
    source_url: `https://www.congress.gov/congressional-report/119th-congress/x/${doc}`,
    publication_date: date, canonical_agency: agency,
    raw: { congress: 119, citation, isConferenceReport: false, associatedBill: { congress: 119, ...assoc } },
  };
}

const ROWS = [
  // FY2027 — nothing enacted
  bill('119-HR8800-IH', { type: 'HR', num: '8800', code: 'IH', label: 'Introduced in House', stage: 'introduced', law: 'not_enacted', fy: 2027, date: '2026-05-13', action: ['2026-09-14', 'Received in the Senate.'] }),
  bill('119-HR8800-RH', { type: 'HR', num: '8800', code: 'RH', label: 'Reported in House', stage: 'reported', law: 'not_enacted', fy: 2027, date: '2026-06-15', action: ['2026-09-14', 'Received in the Senate.'] }),
  bill('119-HR8800-EH', { type: 'HR', num: '8800', code: 'EH', label: 'Engrossed in House', stage: 'passed_chamber', law: 'not_enacted', fy: 2027, date: '2026-07-22', action: ['2026-09-14', 'Received in the Senate.'] }),
  bill('119-S4784-RS', { type: 'S', num: '4784', code: 'RS', label: 'Reported to Senate', stage: 'reported', law: 'not_enacted', fy: 2027, date: '2026-06-15', action: ['2026-07-27', 'Motion to proceed.'] }),
  report('119-HRPT-698', 'H. Rept. 119-698', { type: 'HR', number: '8800' }, '2026-06-15'),
  report('119-SRPT-127', 'S. Rept. 119-127', { type: 'S', number: '4784' }, '2026-06-15'),
  // FY2026 — enacted via S. 1071
  bill('119-S1071-ES', { type: 'S', num: '1071', code: 'ES', label: 'Engrossed in Senate', stage: 'passed_chamber', law: 'superseded_by_enactment', fy: 2026, date: '2025-08-01', becameLaw: true, lawNumber: '119-60', action: ['2025-12-18', 'Became Public Law No: 119-60.'] }),
  bill('119-S1071-PUBLIC-LAW', { type: 'S', num: '1071', code: 'PUBLIC-LAW', label: 'Public Law', stage: 'enacted', law: 'enacted', fy: 2026, date: '2025-12-19', becameLaw: true, lawNumber: '119-60', sourceType: 'enacted_law', action: ['2025-12-18', 'Became Public Law No: 119-60.'] }),
  bill('119-S1071-ENR', { type: 'S', num: '1071', code: 'ENR', label: 'Enrolled Bill', stage: 'enrolled', law: 'enacted', fy: 2026, date: null, becameLaw: true, lawNumber: '119-60', sourceType: 'enacted_law' }),
  bill('119-S2296-ES', { type: 'S', num: '2296', code: 'ES', label: 'Engrossed in Senate', stage: 'passed_chamber', law: 'not_enacted', fy: 2026, date: '2025-10-09', action: ['2025-11-12', 'Held at the desk.'] }),
  report('119-SRPT-39', 'S. Rept. 119-39', { type: 'S', number: '2296' }, '2025-07-15'),
  // The errata's own agency resolution is UNRESOLVED (measured) — it must still attach, marked inherited.
  report('119-SRPT-39-ERRATA', 'S. Rept. 119-39,Errata', { type: 'S', number: '2296' }, null, null),
  // An amending bill is not a vehicle for the year it amends.
  bill('119-HR8175-IH', { type: 'HR', num: '8175', code: 'IH', label: 'Introduced in House', stage: 'introduced', law: 'not_enacted', fy: null, amends: 1994, role: 'amends_prior_act', date: '2026-04-02', action: ['2026-04-02', 'Referred.'] }),
  // Another department's measure must not leak in.
  bill('119-HR1-IH', { type: 'HR', num: '1', code: 'IH', label: 'Introduced in House', stage: 'introduced', law: 'not_enacted', fy: 2027, date: '2026-01-01', agency: 'Department of Energy' }),
];

describe('groupLegislativeEvidence — vehicle vs version, never collapsed', () => {
  const { vehicles, other_measures } = groupLegislativeEvidence(ROWS as never, DOD);
  const fy27 = vehicles.find((v) => v.fiscal_year === 2027)!;
  const fy26 = vehicles.find((v) => v.fiscal_year === 2026)!;

  it('FY2027: House and Senate stay separate measures, and nothing is enacted', () => {
    expect(fy27.status).toBe('not_enacted');
    expect(fy27.enacted_by).toBeNull();
    expect(fy27.measures.map((m) => m.bill)).toEqual(['H.R. 8800', 'S. 4784']);
    const hr = fy27.measures.find((m) => m.bill === 'H.R. 8800')!;
    expect(hr.most_advanced_stage).toBe('passed_chamber');
    expect(hr.versions.map((v) => v.document_number)).toEqual(['119-HR8800-IH', '119-HR8800-RH', '119-HR8800-EH']);
  });

  it('HOUSE-PASSED IS NOT LAW — no FY2027 version carries ENACTED_LAW', () => {
    const all = fy27.measures.flatMap((m) => m.versions);
    expect(all.every((v) => v.evidence_class === 'LEGISLATIVE_ACTIVITY_NOT_LAW')).toBe(true);
    expect(all.every((v) => v.law_status === 'not_enacted')).toBe(true);
  });

  it('FY2026: enacted by S. 1071 as PL 119-60, linked to the public-law text', () => {
    expect(fy26.status).toBe('enacted');
    expect(fy26.enacted_by).toEqual({
      bill: 'S. 1071', law_number: '119-60',
      source_url: 'https://www.congress.gov/119/bills/s1071/BILLS-119s1071public-law.htm',
    });
    const s1071 = fy26.measures.find((m) => m.bill === 'S. 1071')!;
    // The engrossed Senate text is NOT law, even though its measure became law.
    expect(s1071.versions.find((v) => v.document_number === '119-S1071-ES')!.evidence_class).toBe('LEGISLATIVE_ACTIVITY_NOT_LAW');
    expect(s1071.versions.find((v) => v.document_number === '119-S1071-PUBLIC-LAW')!.evidence_class).toBe('ENACTED_LAW');
    // Undated enrolled text stays undated — never guessed.
    expect(s1071.versions.find((v) => v.document_number === '119-S1071-ENR')!.source_date).toBeNull();
    // S. 2296 passed the Senate and did not become law.
    expect(fy26.measures.find((m) => m.bill === 'S. 2296')!.became_law).toBe(false);
  });

  it('committee reports are report language, attached to their bill; errata is its own record', () => {
    const s2296 = fy26.measures.find((m) => m.bill === 'S. 2296')!;
    expect(s2296.committee_reports.map((r) => r.document_number)).toEqual(['119-SRPT-39', '119-SRPT-39-ERRATA']);
    expect(s2296.committee_reports.every((r) => r.evidence_class === 'COMMITTEE_REPORT_LANGUAGE')).toBe(true);
    const errata = s2296.committee_reports.find((r) => r.document_number === '119-SRPT-39-ERRATA')!;
    expect(errata.agency_link).toBe('inherited_from_associated_bill');
    expect(s2296.versions.some((v) => v.source_type === 'committee_report')).toBe(false);
  });

  it('an amending bill is not a vehicle for the year it amends', () => {
    expect(vehicles.map((v) => v.fiscal_year)).not.toContain(1994);
    expect(other_measures.map((m) => m.bill)).toEqual(['H.R. 8175']);
    expect(other_measures[0].amends_fiscal_year).toBe(1994);
  });

  it("another department's measure never leaks in", () => {
    expect(fy27.measures.map((m) => m.bill)).not.toContain('H.R. 1');
  });
});

describe('coverage — partial or unknown never reads as complete', () => {
  const notes = '[legislation-discovery-cursor:v1]\n{"lastCompleteDiscoveryAt":"2026-09-23T01:29:18Z","congress":119,"reportedTotal":598,"scanned":598}\n[/legislation-discovery-cursor]';
  const now = '2026-09-25T00:00:00Z';

  it('complete when the newest poll was a verified ingest', () => {
    const c = legislativeCoverage({ instance: { last_poll: '2026-09-23T01:29:17Z', last_verified_ingest: '2026-09-23T01:29:17Z', last_source_advance: '2026-07-30T00:00:00Z' }, notes, heldRowsTruncated: false, now });
    expect(c.status).toBe('complete');
    expect(c.congress).toBe(119);
    expect(c.scope).toContain('119th Congress');
    expect(c.freshness).toBe('upstream_quiet');
  });

  it('partial when the newest poll is after the last verified ingest', () => {
    const c = legislativeCoverage({ instance: { last_poll: '2026-09-27T13:40:00Z', last_verified_ingest: '2026-09-23T01:29:17Z', last_source_advance: null }, notes, heldRowsTruncated: false, now });
    expect(c.status).toBe('partial');
  });

  it('a truncated held population is partial, and no control plane is unknown', () => {
    expect(legislativeCoverage({ instance: { last_poll: '2026-09-23T01:29:17Z', last_verified_ingest: '2026-09-23T01:29:17Z', last_source_advance: null }, notes, heldRowsTruncated: true, now }).status).toBe('partial');
    expect(legislativeCoverage({ instance: null, notes: null, heldRowsTruncated: false, now }).status).toBe('unknown');
  });

  it('host rules carry NOT_ESTABLISHED when coverage is not complete, and parent-grain attribution', () => {
    const partial = legislativeCoverage({ instance: null, notes: null, heldRowsTruncated: false, now });
    const rules = hostRules('parent_department', 'Navy', DOD, partial).join(' ');
    expect(rules).toContain('NOT_ESTABLISHED');
    expect(rules).toContain('does not attribute them to Navy');
    expect(rules).toContain('Only ENACTED_LAW is law');
  });
});

describe('agency grain — a component is answered at its parent, never guessed', () => {
  it('a department resolves directly', () => {
    expect(legislativeAgencyGrain('Department of Defense', null)).toEqual({ department: DOD, grain: 'department' });
  });
  it('a component with an ESTABLISHED parent is parent_department', () => {
    expect(legislativeAgencyGrain('Navy', DOD)).toEqual({ department: DOD, grain: 'parent_department' });
  });
  it('an unestablished component is not guessed onto a department', () => {
    expect(legislativeAgencyGrain('SOCOM', null)).toEqual({ department: null, grain: null });
  });
});

describe('getLegislativeEvidenceForAgency — reads, never fabricates', () => {
  function client(rows: unknown[], opts: { rowsError?: string; instError?: string } = {}) {
    return {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        q.select = chain; q.in = chain; q.order = chain; q.eq = chain;
        q.limit = async () => (opts.rowsError ? { data: null, error: { message: opts.rowsError } } : { data: rows, error: null });
        q.maybeSingle = async () => {
          if (table === 'data_source_instances') {
            return opts.instError
              ? { data: null, error: { message: opts.instError } }
              : { data: { last_poll: '2026-09-23T01:29:17Z', last_verified_ingest: '2026-09-23T01:29:17Z', last_source_advance: '2026-07-30' }, error: null };
          }
          return { data: { notes: null }, error: null };
        };
        return q;
      },
    };
  }

  it('an unestablished agency makes no query and says NOT_ESTABLISHED', async () => {
    const e = await getLegislativeEvidenceForAgency({ query: 'SOCOM' }, { client: client([]) as never });
    expect(e.status).toBe('not_established');
    expect(e.vehicles).toEqual([]);
  });

  it('a corpus read error THROWS — the caller reports unavailable, never "no legislation"', async () => {
    await expect(getLegislativeEvidenceForAgency({ query: DOD }, { client: client([], { rowsError: 'boom' }) as never })).rejects.toThrow('boom');
  });

  it('a clock read error makes coverage UNKNOWN, not complete', async () => {
    const e = await getLegislativeEvidenceForAgency({ query: DOD }, { client: client(ROWS, { instError: 'x' }) as never });
    expect(e.status).toBe('grounded');
    expect(e.coverage?.status).toBe('unknown');
  });

  it('bill text is never claimed — TEXT_NOT_HELD is always carried', async () => {
    const e = await getLegislativeEvidenceForAgency({ query: DOD }, { client: client(ROWS) as never });
    expect(e.not_established.join(' ')).toMatch(/TEXT is not held/);
    expect(e.not_established.join(' ')).toMatch(/appropriations/);
  });
});

it('billLabel formats House and Senate bill numbers', () => {
  expect(billLabel('HR', '8800')).toBe('H.R. 8800');
  expect(billLabel('S', 4784)).toBe('S. 4784');
});
