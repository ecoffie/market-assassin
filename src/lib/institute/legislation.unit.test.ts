import { describe, it, expect } from 'vitest';
import {
  currentCongress,
  versionCode,
  chamberOf,
  fiscalYearFromTitle,
  matchesSubject,
  discoverBills,
  billVersionsToDocuments,
  committeeReportToDocument,
  collectBillDocuments,
  citationSuffix,
  readStatus,
  parseReportRef,
  resolveLegislationAgency,
  NDAA_TITLE_PATTERN,
  LEGISLATIVE_SOURCE_TYPES,
  type BillRef,
} from './legislation';
import { classifyFamilyState } from '@/app/api/cron/institute-legislation-sync/route';
import CODES from '@/data/agency-toptier-codes.json';

const NAMES = Object.keys(CODES as Record<string, unknown>);

/** Shapes copied from real api.congress.gov payloads captured 2026-09-18. */
const HR8800: BillRef = {
  congress: 119, billType: 'HR', number: '8800',
  title: 'National Defense Authorization Act for Fiscal Year 2027',
  updateDate: '2026-09-15', originChamber: 'House',
};
const S4784: BillRef = {
  congress: 119, billType: 'S', number: '4784',
  title: 'National Defense Authorization Act for Fiscal Year 2027',
  updateDate: '2026-09-18', originChamber: 'Senate',
};

const HOUSE_VERSIONS = [
  { type: 'Engrossed in House', date: '2026-07-22T04:00:00Z', formats: [{ type: 'Formatted Text', url: 'https://congress.gov/eh.htm' }] },
  { type: 'Reported in House', date: '2026-06-15T04:00:00Z', formats: [{ type: 'Formatted Text', url: 'https://congress.gov/rh.htm' }] },
  { type: 'Introduced in House', date: '2026-05-13T04:00:00Z', formats: [{ type: 'Formatted Text', url: 'https://congress.gov/ih.htm' }] },
];
const SENATE_VERSIONS = [
  { type: 'Reported to Senate', date: '2026-06-15T04:00:00Z', formats: [{ type: 'Formatted Text', url: 'https://congress.gov/rs.htm' }] },
];
const NO_LAW = { latestActionDate: '2026-09-14', latestActionText: 'Received in the Senate.', becameLaw: false, lawNumber: null };

const page = (bills: unknown[]) => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ bills }) }) as unknown as Response;
const empty = () => page([]);

/**
 * THE HEADLINE REGRESSION. The incident's root cause was a hardcoded bill number
 * (senate-bill/2296) that could only ever fetch FY2026. These tests fail if anyone
 * reintroduces a hardcoded identifier into the steady-state discovery path.
 */
describe('discovery is dynamic — no hardcoded bill number, FY, or Congress', () => {
  it('finds a FUTURE, UNKNOWN bill number in a FUTURE Congress with zero code changes', async () => {
    // FY2028, 120th Congress, bill numbers nobody can know today.
    const future = [
      { congress: 120, type: 'HR', number: '9911', title: 'National Defense Authorization Act for Fiscal Year 2028', updateDate: '2027-06-01', originChamber: 'House' },
      { congress: 120, type: 'S', number: '5123', title: 'National Defense Authorization Act for Fiscal Year 2028', updateDate: '2027-06-02', originChamber: 'Senate' },
      { congress: 120, type: 'HR', number: '12', title: 'A bill about postal reform', updateDate: '2027-06-03', originChamber: 'House' },
    ];
    let call = 0;
    const res = await discoverBills({
      congress: 120,
      maxPages: 2,
      fetchImpl: (async () => (call++ === 0 ? page(future) : empty())) as unknown as typeof fetch,
    });
    expect(res.state).toBe('introduced');
    expect(res.matched.map((b) => `${b.billType}${b.number}`).sort()).toEqual(['HR9911', 'S5123']);
  });

  it('derives the sitting Congress from the date rather than a constant', () => {
    expect(currentCongress(new Date('2026-09-18T00:00:00Z'))).toBe(119);
    expect(currentCongress(new Date('2027-06-01T00:00:00Z'))).toBe(120); // FY28 cycle
    expect(currentCongress(new Date('2029-03-01T00:00:00Z'))).toBe(121);
    // Before the new Congress convenes on Jan 3, the prior one still sits.
    expect(currentCongress(new Date('2027-01-01T00:00:00Z'))).toBe(119);
  });

  it('the discovery predicate keys on TITLE, not on any bill number', () => {
    expect(matchesSubject({ title: 'National Defense Authorization Act for Fiscal Year 2031' }, NDAA_TITLE_PATTERN)).toBe(true);
    expect(matchesSubject({ title: 'Postal Service Reform Act' }, NDAA_TITLE_PATTERN)).toBe(false);
    expect(matchesSubject({ title: null }, NDAA_TITLE_PATTERN)).toBe(false);
  });

  it('source files contain no hardcoded NDAA bill numbers in the discovery path', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./legislation.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of ['8800', '4784', '2296', '2027']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

/**
 * "Mindy has nothing" must never be indistinguishable from "nothing exists".
 */
describe('discovery states are mutually exclusive and honest', () => {
  it('API failure is source_unavailable — NEVER "no legislation"', async () => {
    const res = await discoverBills({
      fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch,
    });
    expect(res.state).toBe('source_unavailable');
    expect(res.pollOk).toBe(false);
    expect(res.matched).toHaveLength(0);
    expect(res.error).toMatch(/ECONNRESET/);
  });

  it('an HTTP error is source_unavailable, not an empty Congress', async () => {
    const res = await discoverBills({
      fetchImpl: (async () => ({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) })) as unknown as typeof fetch,
    });
    expect(res.state).toBe('source_unavailable');
    expect(res.pollOk).toBe(false);
  });

  it('a successful poll with no match is not_yet_introduced — a REAL observation', async () => {
    const res = await discoverBills({
      maxPages: 1,
      fetchImpl: (async () => page([{ congress: 119, type: 'HR', number: '1', title: 'Unrelated Act', updateDate: '2026-01-01' }])) as unknown as typeof fetch,
    });
    expect(res.state).toBe('not_yet_introduced');
    expect(res.pollOk).toBe(true);   // the distinguishing fact
    expect(res.billsSeen).toBe(1);
  });

  it('introduced but not advanced is distinct from diverging and from enacted', () => {
    expect(classifyFamilyState({ becameLaw: false, houseVersions: 1, senateVersions: 0 })).toBe('introduced');
    expect(classifyFamilyState({ becameLaw: false, houseVersions: 3, senateVersions: 1 })).toBe('diverging');
    expect(classifyFamilyState({ becameLaw: true, houseVersions: 3, senateVersions: 1 })).toBe('enacted');
  });

  it('enacted law is read from the laws field, never guessed from action text', () => {
    expect(readStatus({ latestAction: { actionDate: '2026-09-14', text: 'Received in the Senate.' }, laws: null }).becameLaw).toBe(false);
    const enacted = readStatus({ latestAction: { actionDate: '2026-12-20', text: 'Became Public Law No: 119-201.' }, laws: [{ number: '119-201', type: 'Public Law' }] });
    expect(enacted.becameLaw).toBe(true);
    expect(enacted.lawNumber).toBe('119-201');
  });
});

/**
 * One row per VERSION. Collapsing the family is the failure this module prevents.
 */
describe('legislative versions never collapse into one document', () => {
  it('each House text version becomes its own distinctly-keyed document', () => {
    const docs = billVersionsToDocuments(HR8800, HOUSE_VERSIONS, NO_LAW, '2026-09-18T00:00:00Z');
    expect(docs).toHaveLength(3);
    const ids = docs.map((d) => d.documentNumber);
    expect(ids).toEqual(['119-HR8800-EH', '119-HR8800-RH', '119-HR8800-IH']);
    expect(new Set(ids).size).toBe(3);
  });

  it('House and Senate texts of the SAME act never share a key', () => {
    const h = billVersionsToDocuments(HR8800, HOUSE_VERSIONS, NO_LAW, 'T');
    const s = billVersionsToDocuments(S4784, SENATE_VERSIONS, NO_LAW, 'T');
    const all = [...h, ...s].map((d) => d.documentNumber);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain('119-S4784-RS');
  });

  it('an UNKNOWN version label gets its own key rather than merging into a sibling', () => {
    const docs = billVersionsToDocuments(
      HR8800,
      [...HOUSE_VERSIONS, { type: 'Star Print', date: '2026-08-01T04:00:00Z', formats: [] }],
      NO_LAW, 'T',
    );
    expect(docs).toHaveLength(4);
    expect(docs.map((d) => d.documentNumber)).toContain('119-HR8800-STAR-PRINT');
  });

  it('enrolled text of an ENACTED measure is typed enacted_law, not introduced_bill', () => {
    const enacted = { latestActionDate: '2026-12-20', latestActionText: 'Became Public Law.', becameLaw: true, lawNumber: '119-201' };
    const docs = billVersionsToDocuments(HR8800, [{ type: 'Enrolled Bill', date: '2026-12-18T04:00:00Z', formats: [] }], enacted, 'T');
    expect(docs[0].sourceType).toBe('enacted_law');
    expect(docs[0].documentNumber).toBe('119-HR8800-ENR');
    // A mid-process version of the same bill stays introduced_bill.
    expect(billVersionsToDocuments(HR8800, HOUSE_VERSIONS, enacted, 'T').every((d) => d.sourceType === 'introduced_bill')).toBe(true);
  });

  it('committee reports are separate evidence, and conference reports are flagged from the API', () => {
    const hrpt = committeeReportToDocument({
      type: 'HRPT', number: 698, congress: 119, part: 1, isConferenceReport: false,
      citation: 'H. Rept. 119-698', issueDate: '2026-06-15T04:00:00Z',
      title: 'NATIONAL DEFENSE AUTHORIZATION ACT FOR FISCAL YEAR 2027', chamber: 'House',
      associatedBill: [{ congress: 119, type: 'HR', number: '8800' }],
    }, 'T')!;
    expect(hrpt.sourceType).toBe('committee_report');
    expect(hrpt.documentNumber).toBe('119-HRPT-698');

    const conf = committeeReportToDocument({
      type: 'HRPT', number: 900, congress: 119, part: 1, isConferenceReport: true,
      citation: 'H. Rept. 119-900', issueDate: '2026-11-20T04:00:00Z', title: 'NDAA FY2027 Conference', chamber: 'House',
    }, 'T')!;
    expect(conf.title).toMatch(/Conference Report/);
    expect((conf.raw as Record<string, unknown>).isConferenceReport).toBe(true);
    // Distinct from the HASC report AND from every bill version.
    expect(conf.documentNumber).not.toBe(hrpt.documentNumber);
  });

  it('multi-part reports are distinct documents', () => {
    const p1 = committeeReportToDocument({ type: 'SRPT', number: 127, congress: 119, part: 1, citation: 'S. Rept. 119-127', title: 'X' }, 'T')!;
    const p2 = committeeReportToDocument({ type: 'SRPT', number: 127, congress: 119, part: 2, citation: 'S. Rept. 119-127', title: 'X' }, 'T')!;
    expect(p1.documentNumber).toBe('119-SRPT-127');
    expect(p2.documentNumber).toBe('119-SRPT-127-PT2');
  });
});

describe('provenance is preserved, not summarized', () => {
  it('carries congress, chamber, bill, version, dates and retrieval time', () => {
    const [eh] = billVersionsToDocuments(HR8800, HOUSE_VERSIONS, NO_LAW, '2026-09-18T12:00:00Z');
    const raw = eh.raw as Record<string, unknown>;
    expect(raw.congress).toBe(119);
    expect(raw.chamber).toBe('House');
    expect(raw.billType).toBe('HR');
    expect(raw.billNumber).toBe('8800');
    expect(raw.legislativeVersion).toBe('Engrossed in House');
    expect(raw.versionCode).toBe('EH');
    expect(raw.fiscalYear).toBe(2027);
    expect(raw.versionDate).toBe('2026-07-22');
    expect(raw.retrievedAt).toBe('2026-09-18T12:00:00Z');
    expect(raw.latestActionText).toBe('Received in the Senate.');
    expect(eh.url).toBe('https://congress.gov/eh.htm');
    expect(eh.publicationDate).toBe('2026-07-22');
  });

  it('fiscal year is parsed from the title, never from the calendar', () => {
    expect(fiscalYearFromTitle('National Defense Authorization Act for Fiscal Year 2027')).toBe(2027);
    expect(fiscalYearFromTitle('NDAA FY2028')).toBe(2028);
    expect(fiscalYearFromTitle('A bill with no year')).toBeNull();
  });

  it('chamber comes from the bill type', () => {
    expect(chamberOf('HR')).toBe('House');
    expect(chamberOf('S')).toBe('Senate');
    expect(chamberOf('HJRES')).toBe('House');
  });

  it('version labels map to stable codes', () => {
    expect(versionCode('Introduced in House')).toBe('IH');
    expect(versionCode('Reported to Senate')).toBe('RS');
    expect(versionCode('Enrolled Bill')).toBe('ENR');
  });

  it('report refs are parsed from the API url, never hand-built', () => {
    expect(parseReportRef('https://api.congress.gov/v3/committee-report/119/HRPT/698?format=json')).toEqual({ type: 'HRPT', number: '698' });
    expect(parseReportRef('https://example.com/nope')).toBeNull();
  });
});

describe('agency identity refuses to guess', () => {
  it('resolves a defense authorization to DoD', () => {
    const [d] = billVersionsToDocuments(HR8800, HOUSE_VERSIONS, NO_LAW, 'T');
    expect(resolveLegislationAgency(d, NAMES).canonicalAgency).toBe('Department of Defense');
  });

  it('leaves an unnameable measure unresolved rather than bucketing it', () => {
    const ref: BillRef = { congress: 119, billType: 'HR', number: '1', title: 'A Bill To Do Things', updateDate: null, originChamber: 'House' };
    const [d] = billVersionsToDocuments(ref, [{ type: 'Introduced in House', date: '2026-01-01T00:00:00Z', formats: [] }], NO_LAW, 'T');
    expect(resolveLegislationAgency(d, NAMES).resolved).toBe(false);
  });
});

describe('enacted-law typing covers every enacted artifact (live-observed)', () => {
  it('types BOTH enrolled and public-law text as enacted_law', () => {
    // Shape observed live on S.1071 (FY2026 NDAA, became PL 119-60) 2026-09-18.
    const enacted = { latestActionDate: '2025-12-19', latestActionText: 'Became Public Law No: 119-60.', becameLaw: true, lawNumber: '119-60' };
    const ref: BillRef = { congress: 119, billType: 'S', number: '1071', title: 'National Defense Authorization Act for Fiscal Year 2026', updateDate: '2026-09-15', originChamber: 'Senate' };
    const docs = billVersionsToDocuments(ref, [
      { type: 'Enrolled Bill', date: null, formats: [] },
      { type: 'Public Law', date: '2025-12-19T04:00:00Z', formats: [] },
      { type: 'Introduced in Senate', date: '2025-03-14T04:00:00Z', formats: [] },
    ], enacted, 'T');
    const byId = Object.fromEntries(docs.map((d) => [d.documentNumber, d.sourceType]));
    expect(byId['119-S1071-ENR']).toBe('enacted_law');
    expect(byId['119-S1071-PUBLIC-LAW']).toBe('enacted_law');
    // The introduced text of the SAME act stays a proposal — never retroactively law.
    expect(byId['119-S1071-IS']).toBe('introduced_bill');
  });

  it('does not type enacted artifacts as law when the measure did NOT become law', () => {
    const ref: BillRef = { congress: 119, billType: 'HR', number: '8800', title: 'NDAA FY2027', updateDate: null, originChamber: 'House' };
    const docs = billVersionsToDocuments(ref, [{ type: 'Enrolled Bill', date: '2026-08-01T04:00:00Z', formats: [] }], NO_LAW, 'T');
    expect(docs[0].sourceType).toBe('introduced_bill');
  });
});

/**
 * REGRESSION GUARD for a SILENT coverage failure found in live testing 2026-09-18.
 * URLSearchParams encodes the `+` in `updateDate+desc` as `%2B`; congress.gov does
 * not error on it, it silently returns a DIFFERENT ordering. Under the encoded form
 * H.R. 8800 was absent from the very page that contains it — real 200s, real pages,
 * bill never seen. Anyone "tidying" withKey into URLSearchParams reintroduces it.
 */
describe('the sort parameter must not be percent-encoded', () => {
  it('requests a literal updateDate+desc, never %2B', async () => {
    const urls: string[] = [];
    await discoverBills({
      maxPages: 1,
      fetchImpl: (async (u: string) => {
        urls.push(String(u));
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ bills: [] }) } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    expect(urls[0]).toContain('sort=updateDate+desc');
    expect(urls[0]).not.toContain('%2B');
  });
});

/**
 * CLOCK SCOPE. institute_sources and intelligence_changes are SHARED with the GAO
 * collector, which writes daily. An unscoped "newest row" query reports GAO's
 * activity as legislative activity, so a legislative ingest dead for months would
 * still show a fresh clock. Measured live 2026-09-18: the unscoped query returned a
 * `gao_report` row's timestamp while zero legislative rows existed.
 */
describe('legislative clocks are scoped to the legislative corpus', () => {
  it('the scope list holds exactly the types this collector emits', () => {
    expect([...LEGISLATIVE_SOURCE_TYPES].sort()).toEqual(['committee_report', 'enacted_law', 'introduced_bill']);
  });

  it('every document this collector can emit falls inside the scope list', () => {
    const enacted = { latestActionDate: '2025-12-19', latestActionText: 'Became law', becameLaw: true, lawNumber: '119-60' };
    const emitted = new Set<string>([
      ...billVersionsToDocuments(HR8800, HOUSE_VERSIONS, NO_LAW, 'T').map((d) => d.sourceType),
      ...billVersionsToDocuments(S4784, SENATE_VERSIONS, NO_LAW, 'T').map((d) => d.sourceType),
      ...billVersionsToDocuments(HR8800, [{ type: 'Enrolled Bill', date: null, formats: [] }, { type: 'Public Law', date: '2025-12-19T04:00:00Z', formats: [] }], enacted, 'T').map((d) => d.sourceType),
      committeeReportToDocument({ type: 'HRPT', number: 698, congress: 119, part: 1, citation: 'H. Rept. 119-698', title: 'X' }, 'T')!.sourceType,
    ]);
    // A type emitted but NOT in the scope list would silently fall out of the clock.
    for (const t of emitted) expect(LEGISLATIVE_SOURCE_TYPES as unknown as string[]).toContain(t);
  });

  it('gao_report is NOT in scope — the contamination the live probe caught', () => {
    expect(LEGISLATIVE_SOURCE_TYPES as unknown as string[]).not.toContain('gao_report');
  });

  it('the route filters both clock reads by source type and never reads unscoped', async () => {
    const fs = await import('node:fs');
    const route = fs.readFileSync(
      new URL('../../app/api/cron/institute-legislation-sync/route.ts', import.meta.url), 'utf8',
    );
    const code = route.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // Slice each query at its OWN terminator. A fixed character window spills into
    // the NEXT query — which also mentions LEGISLATIVE_SOURCE_TYPES — so a window
    // assertion passes even with the filter deleted. (Caught by inject-testing this
    // very guard: the first version of it did exactly that.)
    const stmt = (marker: string) => {
      const from = code.indexOf(marker);
      expect(from).toBeGreaterThan(-1);
      const end = code.indexOf('maybeSingle()', from);
      expect(end).toBeGreaterThan(from);
      return code.slice(from, end);
    };

    // The ingest clock must be type-filtered within its OWN statement.
    const ingest = stmt("from('institute_sources')");
    expect(ingest).toContain("in('source_type', LEGISLATIVE_SOURCE_TYPES");

    // The change clock must join back to the corpus, not read the table bare.
    const change = stmt("from('intelligence_changes')");
    expect(change).toContain('institute_sources!inner');
    expect(change).toContain("in('institute_sources.source_type', LEGISLATIVE_SOURCE_TYPES");

    // And a failed clock read must not stamp (null would erase real history).
    expect(code).toContain('clocksReadable');
  });
});

/**
 * REGRESSION (found in production preview 2026-09-20): Congress lists SEPARATE
 * artifacts under ONE report number. S.2296 returns both `S. Rept. 119-39` and
 * `S. Rept. 119-39,Errata`, each with part=1. Keying on number+part alone produced
 * ONE id for both, so a backfill would have inserted the report and silently dropped
 * the errata on the unique key — losing a correction to report language.
 */
describe('committee report errata do not collapse into the base report', () => {
  const rpt = (citation: string, part = 1) => committeeReportToDocument(
    { type: 'SRPT', number: 39, congress: 119, part, isConferenceReport: false,
      citation, issueDate: '2025-07-15T04:00:00Z', title: 'NDAA FY2026', chamber: 'Senate' }, 'T')!;

  it('gives the errata its own document_number', () => {
    const base = rpt('S. Rept. 119-39');
    const errata = rpt('S. Rept. 119-39,Errata');
    expect(base.documentNumber).toBe('119-SRPT-39');
    expect(errata.documentNumber).toBe('119-SRPT-39-ERRATA');
    expect(base.documentNumber).not.toBe(errata.documentNumber);
  });

  it('leaves an ordinary report id unchanged (no churn for existing ids)', () => {
    expect(rpt('S. Rept. 119-39').documentNumber).toBe('119-SRPT-39');
    const hrpt = committeeReportToDocument(
      { type: 'HRPT', number: 698, congress: 119, part: 1, citation: 'H. Rept. 119-698', title: 'X' }, 'T')!;
    expect(hrpt.documentNumber).toBe('119-HRPT-698');
  });

  it('still distinguishes multi-part reports, and combines part + suffix', () => {
    expect(rpt('S. Rept. 119-39', 2).documentNumber).toBe('119-SRPT-39-PT2');
    expect(rpt('S. Rept. 119-39,Errata', 2).documentNumber).toBe('119-SRPT-39-PT2-ERRATA');
  });

  it('citationSuffix is empty for a plain citation', () => {
    expect(citationSuffix('S. Rept. 119-39')).toBe('');
    expect(citationSuffix('S. Rept. 119-39,Errata')).toBe('-ERRATA');
    expect(citationSuffix('S. Rept. 119-39, Part 2 Supplemental')).toBe('-PART-2-SUPPLEMENTAL');
  });
});

/**
 * REGRESSION (live, 2026-09-20): the REPORT endpoint returns every artifact sharing
 * a report number, but `fetchCommitteeReport` returned only `arr[0]`, discarding the
 * errata. The bill also lists one entry per artifact pointing at the SAME url, so
 * the caller refetched and got that same first record twice. Together they produced
 * 29 documents with 28 distinct identities — the base report kept, the errata lost.
 *
 * The citation-key fix alone did NOT solve this: the key was right, the fetch was
 * wrong. Caught only by polling the live API, never by the unit fixture.
 */
describe('a report number expands into ALL of its artifacts', () => {
  const REPORT_PAYLOAD = {
    committeeReports: [
      { type: 'SRPT', number: 39, congress: 119, part: 1, citation: 'S. Rept. 119-39',
        issueDate: '2025-07-15T04:00:00Z', title: 'NDAA FY2026', chamber: 'Senate', isConferenceReport: false },
      { type: 'SRPT', number: 39, congress: 119, part: 1, citation: 'S. Rept. 119-39,Errata',
        issueDate: null, title: 'NDAA FY2026', chamber: 'Senate', isConferenceReport: false },
    ],
  };

  const fetchImpl = (async (u: string) => {
    if (String(u).includes('/committee-report/')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => REPORT_PAYLOAD } as unknown as Response;
    }
    if (String(u).includes('/text')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ textVersions: [] }) } as unknown as Response;
    }
    // bill detail — TWO list entries, both pointing at the SAME report url
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ bill: {
        latestAction: { actionDate: '2025-11-12', text: 'Held at the desk.' }, laws: null,
        committeeReports: [
          { citation: 'S. Rept. 119-39', url: 'https://api.congress.gov/v3/committee-report/119/SRPT/39?format=json' },
          { citation: 'S. Rept. 119-39,Errata', url: 'https://api.congress.gov/v3/committee-report/119/SRPT/39?format=json' },
        ],
      } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const ref: BillRef = { congress: 119, billType: 'S', number: '2296', title: 'NDAA FY2026', updateDate: null, originChamber: 'Senate' };

  it('keeps BOTH the base report and its errata as distinct documents', async () => {
    const { documents } = await collectBillDocuments(ref, fetchImpl, () => 'T');
    const ids = documents.filter((d) => d.sourceType === 'committee_report').map((d) => d.documentNumber);
    expect(ids.sort()).toEqual(['119-SRPT-39', '119-SRPT-39-ERRATA']);
  });

  it('produces NO duplicate identities even though the bill lists the url twice', async () => {
    const { documents } = await collectBillDocuments(ref, fetchImpl, () => 'T');
    const keys = documents.map((d) => `${d.sourceType}::${d.documentNumber}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('fetches each report number ONCE regardless of how many list entries cite it', async () => {
    let reportFetches = 0;
    const counting = (async (u: string) => {
      if (String(u).includes('/committee-report/')) reportFetches++;
      return fetchImpl(u as never);
    }) as unknown as typeof fetch;
    await collectBillDocuments(ref, counting, () => 'T');
    expect(reportFetches).toBe(1);
  });

  it('is idempotent: two independent collections yield identical persistence keys', async () => {
    const a = await collectBillDocuments(ref, fetchImpl, () => 'T1');
    const b = await collectBillDocuments(ref, fetchImpl, () => 'T2');
    const k = (r: typeof a) => r.documents.map((d) => `${d.sourceType}::${d.documentNumber}`).sort();
    expect(k(a)).toEqual(k(b));   // (source_type, document_number) IS the unique key
  });
});
