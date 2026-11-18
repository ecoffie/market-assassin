/**
 * Recorded fixtures only. No live network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGaoRss } from './sources';
import {
  ACQUISITION_NEW_ROW_CAP,
  agencyFromOigName,
  annotateGaoRssDocument,
  capNewAcquisition,
  fetchTextSource,
  gaoRssAcquisition,
  igReportStatesProblem,
  isBareLegacyGaoCitation,
  laneFromFetch,
  parseOversightFederalReports,
  parseOversightOpenRecommendations,
  readAcquiredFields,
  resolutionFromSourceStatus,
} from './acquired-pain-points';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('resolution is copied from the source and never guessed from age', () => {
  it('open is confirmed-unresolved; closed is historical; anything else is unknown', () => {
    expect(resolutionFromSourceStatus('open')).toEqual({
      resolution_status: 'open', resolution_flag: 'confirmed_unresolved',
    });
    expect(resolutionFromSourceStatus('closed')).toEqual({
      resolution_status: 'closed', resolution_flag: 'historical',
    });
    expect(resolutionFromSourceStatus('unknown')).toEqual({
      resolution_status: 'unknown', resolution_flag: 'unknown',
    });
  });

  it('a stored flag cannot upgrade an unknown status', () => {
    const fields = readAcquiredFields({
      acquisition: {
        problem: 'A stated problem',
        recommendation: null,
        resolution_status: 'not-a-status',
        resolution_flag: 'confirmed_unresolved',
        source_identifier: 'OIG-REC:x:1',
        agency_as_stated: 'Department of Justice',
      },
    });
    expect(fields?.resolution_status).toBe('unknown');
    expect(fields?.resolution_flag).toBe('unknown');
  });
});

describe('the bare (Source: GAO) tag cannot be written again', () => {
  it('rejects the legacy tag and keeps a document-numbered citation', () => {
    expect(isBareLegacyGaoCitation('Aging systems (Source: GAO)')).toBe(true);
    expect(isBareLegacyGaoCitation('Aging systems (Source: GAO-26-107726)')).toBe(false);
    expect(isBareLegacyGaoCitation('Fix the ledger (Source: OIG-REC:reports~audit~x:1)')).toBe(false);
  });
});

describe('recorded oversight.gov open recommendations', () => {
  const docs = parseOversightOpenRecommendations(fixture('oversight-open-recommendations.html'));

  it('keeps agency, problem, date, url, source id, recommendation, and open status', () => {
    expect(docs.length).toBeGreaterThan(0);
    const first = docs[0];
    expect(first.sourceType).toBe('ig_report');
    expect(first.agencyAsStated).toBe('Consumer Product Safety Commission');
    expect(first.publicationDate).toBe('2026-11-17');
    expect(first.url).toMatch(/^https:\/\/www\.oversight\.gov\/reports\//);
    expect(first.documentNumber).toMatch(/^OIG-REC:/);
    expect(first.problem).toMatch(/monitoring controls/i);
    expect(first.recommendation).toBe(first.problem);
    expect(first.resolutionStatus).toBe('open');
    expect(first.statesProblem).toBe(true);
    expect(first.documentNumber).not.toMatch(/\(Source: GAO\)$/);
  });

  it('does not invent a closed status for a recommendation the page lists as open', () => {
    expect(docs.every((d) => d.resolutionStatus === 'open')).toBe(true);
  });
});

describe('recorded oversight.gov federal reports', () => {
  const docs = parseOversightFederalReports(fixture('oversight-federal-reports.html'));

  it('keeps the report identity and does not turn an accomplishments blurb into a problem', () => {
    expect(docs.length).toBe(2);
    const gpo = docs.find((d) => /Government Publishing Office/i.test(d.agencyAsStated));
    expect(gpo).toBeTruthy();
    expect(gpo?.documentNumber).toMatch(/^OIG-RPT:/);
    expect(gpo?.url).toMatch(/^https:\/\/www\.oversight\.gov\/reports\//);
    expect(gpo?.publicationDate).toBe('2026-11-18');
    expect(gpo?.recommendation).toBeNull();
    expect(gpo?.resolutionStatus).toBe('unknown');
    expect(docs.every((d) => d.statesProblem === false)).toBe(true);
  });

  it('a description that states a problem is a problem; the word oversight alone is not', () => {
    expect(igReportStatesProblem('This report highlights oversight accomplishments.')).toBe(false);
    expect(igReportStatesProblem('The agency should improve grant monitoring.')).toBe(true);
  });
});

describe('recorded GAO RSS', () => {
  const [doc] = parseGaoRss(fixture('gao-reports-rss.xml'));

  it('parses the recorded report and does not invent a recommendation', () => {
    expect(doc.documentNumber).toBe('GAO-27-108743');
    expect(doc.url).toBe('https://www.gao.gov/products/gao-27-108743');
    const fields = gaoRssAcquisition(doc);
    expect(fields.resolution_status).toBe('unknown');
    expect(fields.resolution_flag).toBe('unknown');
    expect(fields.recommendation).toBeNull();
    const annotated = annotateGaoRssDocument(doc);
    expect(readAcquiredFields(annotated.raw)?.source_identifier).toBe('GAO-27-108743');
  });

  it('a priority-open title is open; an explicit recommendation is copied; a refusal is not', () => {
    const open = gaoRssAcquisition({
      documentNumber: 'GAO-26-109162',
      title: 'Priority Open Recommendations: National Aeronautics and Space Administration',
      abstract: 'GAO identified priority recommendations that remain open.',
    });
    expect(open.resolution_status).toBe('open');
    expect(open.resolution_flag).toBe('confirmed_unresolved');
    expect(open.recommendation).toBeNull();

    const stated = gaoRssAcquisition({
      documentNumber: 'GAO-27-100001',
      title: 'Grants: Better Controls Needed',
      abstract: 'GAO recommends that the agency document its grant monitoring procedures.',
    });
    expect(stated.recommendation).toMatch(/document its grant monitoring/);
    expect(stated.resolution_status).toBe('unknown');

    const refused = gaoRssAcquisition({
      documentNumber: 'GAO-27-100002',
      title: 'Data Centers: An Update',
      abstract: 'GAO is not making recommendations to the agencies because the requirements expired. GAO recommends that Congress consider a new statute.',
    });
    expect(refused.recommendation).toBeNull();
  });
});

describe('a run acquires at most 200 new rows and does not touch rows it already holds', () => {
  it('skips held ids, then stops at the cap instead of backfilling the rest', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ documentNumber: `OIG-REC:r:${i}` }));
    const held = new Set(['OIG-REC:r:0', 'OIG-REC:r:2']);
    const capped = capNewAcquisition(rows, held, 2);
    expect(capped.selected.map((r) => r.documentNumber)).toEqual(['OIG-REC:r:1', 'OIG-REC:r:3']);
    expect(capped.heldSkipped).toBe(2);
    expect(capped.deferredOverCap).toBe(1);
    expect(ACQUISITION_NEW_ROW_CAP).toBe(200);
  });
});

describe('a source that is down is not a quiet zero', () => {
  it('non-2xx and an empty 200 are both degraded lanes', () => {
    const down = laneFromFetch('oversight_open_recommendations', {
      ok: false, status: 503, body: '', error: 'HTTP 503',
    }, () => [{ documentNumber: 'should-not-parse' } as never]);
    expect(down.ok).toBe(false);
    expect(down.documents).toEqual([]);
    expect(down.error).toBe('HTTP 503');

    const empty = laneFromFetch('oversight_federal_reports', {
      ok: true, status: 200, body: '<html></html>', error: null,
    }, () => []);
    expect(empty.ok).toBe(false);
    expect(empty.error).toBe('feed_parsed_zero_documents');
  });

  it('fetchTextSource reports the status and does not throw', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    const result = await fetchTextSource('https://www.oversight.gov/reports/recommendations', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe('HTTP 403');
  });
});

describe('the collector stays on the existing pipeline', () => {
  it('caps the batch, reports a down source, and does not delete pain points', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/institute-gao-sync/route.ts'), 'utf8');
    expect(route).toContain('ACQUISITION_NEW_ROW_CAP');
    expect(route).toContain("reportCronOutcome(\n    'institute-gao-sync'");
    expect(route).not.toMatch(/from\('agency_pain_points_db'\)[\s\S]{0,120}\.delete/);
    expect(route).not.toMatch(/from\('agency_intelligence'\)/);
  });
});

describe('OIG display names', () => {
  it('strips the office suffix and leaves the agency the source named', () => {
    expect(agencyFromOigName('Department of Veterans Affairs OIG')).toBe('Department of Veterans Affairs');
    expect(agencyFromOigName('Export-Import Bank of the United States OIG'))
      .toBe('Export-Import Bank of the United States');
  });
});
