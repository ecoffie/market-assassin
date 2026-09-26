/**
 * get_legislation_status — gold fixtures A–L (tasks/legislation-status-v1-2026-09-26.md §19).
 *
 * Rows copy the SHAPE of production institute_sources legislative rows (2026-09-25):
 * FY2027 H.R. 8800 IH/RH/EH + H. Rept. 119-698, S. 4784 RS + S. Rept. 119-127;
 * FY2026 S. 1071 IS/ES/EAH/ENR/PUBLIC-LAW (PL 119-60), H.R. 3838 IH/RH/EH + H. Rept. 119-231,
 * S. 2296 RS/ES + S. Rept. 119-39 and its errata (unresolved agency, as measured).
 */
import { describe, it, expect } from 'vitest';
import { getLegislationStatus } from './legislation-status';
import { parseLegislationQuery } from '@/lib/strategic-intel/legislation-query';
import { stageForCode, KNOWN_VERSION_CODES } from '@/lib/strategic-intel/legislation-stages';

const DOD = 'Department of Defense';
const CURSOR = '[legislation-discovery-cursor:v1]\n{"lastCompleteDiscoveryAt":"2026-09-23T01:29:18Z","congress":119,"reportedTotal":598,"scanned":598}\n[/legislation-discovery-cursor]';

function v(type: 'HR' | 'S', num: string, code: string, label: string, stage: string, law: string, fy: number | null,
  date: string | null, extra: { becameLaw?: boolean; lawNumber?: string; action?: [string, string]; enacted?: boolean; role?: string; amends?: number } = {}) {
  return {
    source_type: extra.enacted ? 'enacted_law' : 'introduced_bill',
    document_number: `119-${type}${num}-${code}`,
    title: `National Defense Authorization Act [${type} ${num} — ${label}]`,
    source_url: `https://www.congress.gov/119/bills/${type.toLowerCase()}${num}/BILLS-119${type.toLowerCase()}${num}${code.toLowerCase()}.htm`,
    publication_date: date,
    canonical_agency: DOD,
    raw: {
      congress: 119, chamber: type === 'HR' ? 'House' : 'Senate', billType: type, billNumber: num,
      billTitle: `National Defense Authorization Act for Fiscal Year ${fy ?? 'X'}`,
      legislativeVersion: label, versionCode: code, legislativeStage: stage, lawStatusAtIngestion: law,
      measureRole: extra.role ?? 'authorization_vehicle', fiscalYear: fy,
      ...(extra.amends ? { amendsFiscalYear: extra.amends } : {}),
      becameLaw: extra.becameLaw ?? false, lawNumber: extra.lawNumber ?? null,
      latestActionDate: extra.action?.[0] ?? null, latestActionText: extra.action?.[1] ?? null,
    },
  };
}
function rpt(doc: string, citation: string, bill: { type: string; number: string }, date: string | null, agency: string | null = DOD) {
  return {
    source_type: 'committee_report', document_number: doc, title: citation,
    source_url: `https://www.congress.gov/congressional-report/119th-congress/x/${doc}`,
    publication_date: date, canonical_agency: agency,
    raw: { congress: 119, citation, isConferenceReport: false, associatedBill: { congress: 119, ...bill } },
  };
}

const HR8800_ACT: [string, string] = ['2026-09-14', 'Received in the Senate.'];
const S4784_ACT: [string, string] = ['2026-07-27', 'Motion to proceed to consideration of measure made in Senate.'];
const S1071_ACT: [string, string] = ['2025-12-18', 'Became Public Law No: 119-60.'];

const ROWS = [
  v('HR', '8800', 'IH', 'Introduced in House', 'introduced', 'not_enacted', 2027, '2026-05-13', { action: HR8800_ACT }),
  v('HR', '8800', 'RH', 'Reported in House', 'reported', 'not_enacted', 2027, '2026-06-15', { action: HR8800_ACT }),
  v('HR', '8800', 'EH', 'Engrossed in House', 'passed_chamber', 'not_enacted', 2027, '2026-07-22', { action: HR8800_ACT }),
  v('S', '4784', 'RS', 'Reported to Senate', 'reported', 'not_enacted', 2027, '2026-06-15', { action: S4784_ACT }),
  rpt('119-HRPT-698', 'H. Rept. 119-698', { type: 'HR', number: '8800' }, '2026-06-15'),
  rpt('119-SRPT-127', 'S. Rept. 119-127', { type: 'S', number: '4784' }, '2026-06-15'),
  v('HR', '3838', 'EH', 'Engrossed in House', 'passed_chamber', 'not_enacted', 2026, '2025-09-10', { action: ['2025-09-30', 'Received in the Senate.'] }),
  rpt('119-HRPT-231', 'H. Rept. 119-231', { type: 'HR', number: '3838' }, '2025-08-19'),
  v('S', '1071', 'IS', 'Introduced in Senate', 'introduced', 'superseded_by_enactment', 2026, '2025-03-14', { becameLaw: true, lawNumber: '119-60', action: S1071_ACT }),
  v('S', '1071', 'ES', 'Engrossed in Senate', 'passed_chamber', 'superseded_by_enactment', 2026, '2025-08-01', { becameLaw: true, lawNumber: '119-60', action: S1071_ACT }),
  v('S', '1071', 'EAH', 'Engrossed Amendment House', 'passed_chamber', 'superseded_by_enactment', 2026, '2025-12-10', { becameLaw: true, lawNumber: '119-60', action: S1071_ACT }),
  v('S', '1071', 'ENR', 'Enrolled Bill', 'enrolled', 'enacted', 2026, null, { becameLaw: true, lawNumber: '119-60', enacted: true, action: S1071_ACT }),
  v('S', '1071', 'PUBLIC-LAW', 'Public Law', 'enacted', 'enacted', 2026, '2025-12-19', { becameLaw: true, lawNumber: '119-60', enacted: true, action: S1071_ACT }),
  v('S', '2296', 'RS', 'Reported to Senate', 'reported', 'not_enacted', 2026, '2025-07-15', { action: ['2025-11-12', 'Held at the desk.'] }),
  v('S', '2296', 'ES', 'Engrossed in Senate', 'passed_chamber', 'not_enacted', 2026, '2025-10-09', { action: ['2025-11-12', 'Held at the desk.'] }),
  rpt('119-SRPT-39', 'S. Rept. 119-39', { type: 'S', number: '2296' }, '2025-07-15'),
  rpt('119-SRPT-39-ERRATA', 'S. Rept. 119-39,Errata', { type: 'S', number: '2296' }, null, null),
  v('HR', '8175', 'IH', 'Introduced in House', 'introduced', 'not_enacted', null, '2026-04-02', { role: 'amends_prior_act', amends: 1994, action: ['2026-04-02', 'Referred.'] }),
];

type Coverage = 'complete' | 'partial' | 'unknown';
function client(rows: unknown[], opts: { coverage?: Coverage; rowsError?: string } = {}) {
  const coverage = opts.coverage ?? 'complete';
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = chain; q.in = chain; q.order = chain; q.eq = chain;
      q.limit = async () => (opts.rowsError ? { data: null, error: { message: opts.rowsError } } : { data: rows, error: null });
      q.maybeSingle = async () => {
        if (table === 'data_source_instances') {
          if (coverage === 'unknown') return { data: null, error: { message: 'down' } };
          return {
            data: {
              last_poll: coverage === 'partial' ? '2026-09-27T13:40:00Z' : '2026-09-23T01:29:17Z',
              last_verified_ingest: '2026-09-23T01:29:17Z',
              last_source_advance: '2026-07-30',
            },
            error: null,
          };
        }
        return { data: { notes: CURSOR }, error: null };
      };
      return q;
    },
  };
}
const run = (query: string, rows: unknown[] = ROWS, o: { coverage?: Coverage; rowsError?: string } = {}) =>
  getLegislationStatus({ query }, { client: client(rows, o) as never, now: '2026-09-26T00:00:00Z' });

describe('A/B — FY2027 NDAA: not enacted, House and Senate kept separate', () => {
  it('A: status — H.R. 8800 House-passed, S. 4784 Senate-reported, two bills', async () => {
    const r = await run('What is the status of the FY2027 NDAA?');
    expect(r.resolution).toMatchObject({ kind: 'fy_vehicle', outcome: 'FOUND', matched: 'FY2027 NDAA' });
    expect(r.overall_status?.enacted).toBe(false);
    expect(r.overall_status?.enacted_by).toBeNull();
    expect(r.overall_status?.by_chamber?.house).toMatchObject({ bill: 'H.R. 8800', stage: 'HOUSE_PASSED' });
    expect(r.overall_status?.by_chamber?.senate).toMatchObject({ bill: 'S. 4784', stage: 'REPORTED_IN_SENATE' });
    expect(r.documents.map((d) => d.bill)).toEqual(['H.R. 8800', 'S. 4784']);
    expect(r.documents.every((d) => d.progress.enacted === false)).toBe(true);
    expect(r.documents.find((d) => d.bill === 'H.R. 8800')!.committee_reports.map((x) => x.document_number)).toEqual(['119-HRPT-698']);
    expect(r.documents.find((d) => d.bill === 'S. 4784')!.committee_reports.map((x) => x.document_number)).toEqual(['119-SRPT-127']);
    expect(r.documents.flatMap((d) => d.versions).every((x) => x.source_url.startsWith('https://www.congress.gov/'))).toBe(true);
    expect(r.coverage?.status).toBe('complete');
    expect(r.limitations).toContain('bill_text_not_held');
    expect(r.limitations).toContain('action_history_not_held');
    expect(r.content_status).toBe('NOT_REQUESTED');
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, source_count: 6, as_of: '2026-09-23T01:29:17Z' });
  });

  it('REPORTED is not PASSED — S. 4784 has no Senate-passed stage', async () => {
    const r = await run('FY2027 NDAA');
    const s = r.documents.find((d) => d.bill === 'S. 4784')!;
    expect(s.current_stage).toBe('REPORTED_IN_SENATE');
    expect(s.progress.senate).toBe('REPORTED_IN_SENATE');
    expect(s.current_stage_display).toMatch(/not passed/);
  });

  it('B: has it become law — no, from stage evidence', async () => {
    const r = await run('Has the FY2027 NDAA become law?');
    expect(r.overall_status?.enacted).toBe(false);
    expect(r.documents.flatMap((d) => d.versions).some((x) => x.evidence_class === 'ENACTED_LAW')).toBe(false);
  });

  it('FY spellings resolve to the same vehicle', () => {
    for (const q of ['FY2027 NDAA', '2027 NDAA', 'NDAA FY27', 'fiscal year 2027 National Defense Authorization Act']) {
      expect(parseLegislationQuery(q).query).toMatchObject({ kind: 'fy_vehicle', fiscalYear: 2027 });
    }
  });
});

describe('C/D — bill lookup returns only that bill', () => {
  it('C: H.R. 8800 family only, in every spelling', async () => {
    for (const q of ['Show me H.R. 8800', 'HR8800', 'HR 8800', 'H. R. 8800']) {
      const r = await run(q);
      expect(r.resolution).toMatchObject({ kind: 'bill', outcome: 'FOUND', matched: 'H.R. 8800' });
      expect(r.documents).toHaveLength(1);
      expect(r.documents[0].versions.map((x) => x.version_code)).toEqual(['IH', 'RH', 'EH']);
      expect(r.documents[0].committee_reports.map((x) => x.document_number)).toEqual(['119-HRPT-698']);
      expect(r.documents[0].chamber_of_origin).toBe('House');
    }
  });

  it('D: committee report for S. 4784 — report only, report provenance', async () => {
    const r = await run('Show me the committee report for S 4784');
    expect(r.resolution).toMatchObject({ kind: 'bill', matched: 'S. 4784' });
    const d = r.documents[0];
    expect(d.versions).toEqual([]);
    expect(d.committee_reports).toEqual([expect.objectContaining({
      document_number: '119-SRPT-127', document_kind: 'committee_report', law_status: 'not_applicable', is_errata: false,
    })]);
  });
});

describe('E — FY2026 NDAA enacted through S. 1071 / PL 119-60', () => {
  it('fiscal-year query: enacted_by points at the PUBLIC LAW record', async () => {
    const r = await run('What is the status of the FY2026 NDAA?');
    expect(r.overall_status).toMatchObject({
      enacted: true, law_number: '119-60',
      enacted_by: { bill: 'S. 1071', law_number: '119-60', source_date: '2025-12-19' },
    });
    expect(r.overall_status?.enacted_by?.source_url).toMatch(/public-law\.htm$/);
    const s1071 = r.documents.find((d) => d.bill === 'S. 1071')!;
    expect(s1071.current_stage).toBe('PUBLIC_LAW');
    expect(s1071.progress).toMatchObject({ senate: 'SENATE_PASSED', house: 'HOUSE_PASSED_WITH_AMENDMENT', enrolled: true, enacted: true });
    // ENR is shown as ENROLLED — the public law is the authority.
    expect(s1071.versions.find((x) => x.version_code === 'ENR')!.stage).toBe('ENROLLED');
    // The House and Senate bills that did not become law stay not enacted.
    expect(r.documents.find((d) => d.bill === 'H.R. 3838')!.progress.enacted).toBe(false);
    expect(r.documents.find((d) => d.bill === 'S. 2296')!.progress.enacted).toBe(false);
  });

  it('PL 119-60 / Public Law 119-60 resolve to S. 1071', async () => {
    for (const q of ['PL 119-60', 'Public Law 119-60', 'P.L. 119-60']) {
      const r = await run(q);
      expect(r.resolution).toMatchObject({ kind: 'public_law', outcome: 'FOUND' });
      expect(r.documents.map((d) => d.bill)).toEqual(['S. 1071']);
      expect(r.overall_status?.enacted).toBe(true);
    }
  });
});

describe('F/G — committee reports and errata are never bill versions', () => {
  it('F: S. Rept. 119-127 returns the report, attached to S. 4784', async () => {
    const r = await run('S. Rept. 119-127');
    expect(r.resolution).toMatchObject({ kind: 'committee_report', outcome: 'FOUND' });
    expect(r.resolution.note).toMatch(/not law/);
    expect(r.documents[0].committee_reports.map((x) => x.document_number)).toEqual(['119-SRPT-127']);
    expect(r.documents[0].versions.every((x) => x.version_code !== null)).toBe(true);
  });

  it('G: the errata is its own record, separate from the base report', async () => {
    const e = await run('S. Rept. 119-39 errata');
    expect(e.documents[0].committee_reports).toEqual([expect.objectContaining({ document_number: '119-SRPT-39-ERRATA', is_errata: true })]);
    expect(e.resolution.note).toContain('119-SRPT-39');
    const b = await run('S. Rept. 119-39');
    expect(b.documents[0].committee_reports).toEqual([expect.objectContaining({ document_number: '119-SRPT-39', is_errata: false })]);
    expect(b.resolution.note).toContain('119-SRPT-39-ERRATA');
  });
});

describe('H/I/K — absence follows coverage, never "does not exist"', () => {
  it('H: unknown bill with COMPLETE coverage → NOT_FOUND_IN_COVERED_CORPUS, scope stated', async () => {
    const r = await run('H.R. 1234');
    expect(r.resolution.outcome).toBe('NOT_FOUND_IN_COVERED_CORPUS');
    expect(r.resolution.note).toMatch(/National Defense Authorization Act.*119th Congress/);
    expect(r.resolution.note).toMatch(/not evidence/);
    expect(r._meta.grounded).toBe(false);
  });

  it('H: a covered FY whose vehicle is not held → NOT_FOUND_IN_COVERED_CORPUS', async () => {
    const withoutFy27 = ROWS.filter((x) => (x.raw as { fiscalYear?: number | null }).fiscalYear !== 2027
      && !String(x.document_number).match(/HRPT-698|SRPT-127/));
    const r = await run('FY2027 NDAA', withoutFy27);
    expect(r.resolution.outcome).toBe('NOT_FOUND_IN_COVERED_CORPUS');
  });

  it('I: the same misses with PARTIAL or UNKNOWN coverage → NOT_ESTABLISHED', async () => {
    for (const coverage of ['partial', 'unknown'] as const) {
      expect((await run('H.R. 1234', ROWS, { coverage })).resolution.outcome).toBe('NOT_ESTABLISHED');
      expect((await run('S. Rept. 119-999', ROWS, { coverage })).resolution.outcome).toBe('NOT_ESTABLISHED');
    }
  });

  it('K: another Congress or an out-of-scope FY → NOT_ESTABLISHED even with complete coverage', async () => {
    for (const q of ['FY2025 NDAA', 'H.R. 2670 118th Congress', 'PL 118-31', 'FY2028 NDAA']) {
      const r = await run(q);
      expect(r.resolution.outcome).toBe('NOT_ESTABLISHED');
      expect(r.resolution.note).toMatch(/outside the Congress|NOT_ESTABLISHED/);
    }
  });

  it('a corpus read failure is degraded + NOT_ESTABLISHED, never "not found"', async () => {
    const r = await run('FY2027 NDAA', ROWS, { rowsError: 'boom' });
    expect(r._meta.degraded).toBe(true);
    expect(r.resolution.outcome).toBe('NOT_ESTABLISHED');
    expect(r.resolution.note).toMatch(/UNKNOWN/);
  });
});

describe('J/L — content questions return status, never content', () => {
  it('J: known bill + topic → status returned, content NOT_HELD', async () => {
    const r = await run('What does H.R. 8800 say about cybersecurity?');
    expect(r.resolution).toMatchObject({ kind: 'bill', outcome: 'FOUND', matched: 'H.R. 8800' });
    expect(r.content_request).toEqual({ terms: ['cybersecurity'], kind: 'topic' });
    expect(r.content_status).toBe('NOT_HELD');
    expect(r.limitations).toContain('bill_text_not_held');
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/cybersecurity provision|section \d+ requires/);
  });

  it('L: House-vs-Senate comparison → comparison kind, NOT_HELD', async () => {
    const r = await run('What changed between the House and Senate NDAA?');
    expect(r.content_request?.kind).toBe('comparison');
    expect(r.content_status).toBe('NOT_HELD');
  });

  it('status-only phrasings are NOT content requests', () => {
    for (const q of ['What is the status of the FY2027 NDAA?', 'Has the FY2027 NDAA become law?', 'Show me H.R. 8800',
      'Which NDAA is currently law?', 'What versions of the FY2027 NDAA does Mindy have?', 'Show me the committee report for S 4784']) {
      expect(parseLegislationQuery(q).content_request).toBeNull();
    }
  });
});

describe('stage model — only held codes; unknown codes never promoted', () => {
  it('covers exactly the 10 production codes', () => {
    expect([...KNOWN_VERSION_CODES].sort()).toEqual(['CPS', 'EAH', 'EH', 'ENR', 'ES', 'IH', 'IS', 'PUBLIC-LAW', 'RH', 'RS']);
  });
  it('an unknown code is OTHER with its raw label and the lowest rank', () => {
    expect(stageForCode('PCS', 'Placed on Calendar Senate')).toEqual({ stage: 'OTHER', chamber: null, rank: 0, display: 'Placed on Calendar Senate' });
  });
  it('passed one chamber is never PUBLIC_LAW; only PUBLIC-LAW is', () => {
    for (const c of ['EH', 'ES', 'CPS', 'EAH', 'RH', 'RS', 'ENR']) expect(stageForCode(c).stage).not.toBe('PUBLIC_LAW');
    expect(stageForCode('PUBLIC-LAW').stage).toBe('PUBLIC_LAW');
  });
});

describe('routing boundary — non-legislation questions do not resolve', () => {
  it('agency / regulation / opportunity questions are unresolved and make no claim', async () => {
    for (const q of ['What does the Navy care about?', 'What new federal rules affect drones?', 'I want to sell cybersecurity to SOCOM.']) {
      const r = await run(q);
      expect(r.resolution.kind).toBe('unresolved');
      expect(r._meta.grounded).toBe(false);
    }
  });
});
