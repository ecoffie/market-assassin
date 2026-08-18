import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { noticeTypeToDetected } from '@/lib/utils/notice-type';

/**
 * The Proposal Workspace picks its section set from the pursuit's notice type.
 *
 * THE DEFECT THIS GUARDS (measured on prod 2026-08-18): `STAGES` was ONE hardcoded
 * array, so a Sources Sought rendered the full 15-section RFP skeleton — Transition
 * Plan, Risk Management, "Submit Proposal" — for a notice that wants a 2-5 page
 * capability response. The right rail printed "Contract Type: Sources Sought" beside
 * it; `notice_type` was read for DISPLAY only and branched nothing.
 *
 * THE DRIFT RISK THIS GUARDS: the Workspace emits raw browser JS from a route
 * handler, so it CANNOT import the TS classifier the /app panel uses. Its
 * `detectNoticeMode()` reproduces that mapping by hand — exactly the lib-duplicate
 * pattern that let these two surfaces diverge in the first place. These tests run
 * the SHIPPED client function against the SHARED lib so a change to one that isn't
 * mirrored in the other fails the build.
 */

const src = readFileSync(
  join(process.cwd(), 'src/app/opportunity-map/proposal/route.ts'),
  'utf8',
);

/** Extract and evaluate the shipped client-side resolver. */
function shippedDetect(): (nt: string) => string {
  const start = src.indexOf('function detectNoticeMode(nt){');
  expect(start).toBeGreaterThan(0);
  const end = src.indexOf('\n  }', start) + 4;
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end)} return detectNoticeMode;`)() as (nt: string) => string;
}

describe('Workspace: the section set follows the notice type', () => {
  it('agrees with the SHARED lib for every real notice type', () => {
    const detect = shippedDetect();
    for (const nt of [
      'Sources Sought',
      'Special Notice',
      'Combined Synopsis/Solicitation',
      'Solicitation',
      'Presolicitation',
      'Request for Information (RFI)',
      'Award Notice',
      'Justification',
    ]) {
      const lib = noticeTypeToDetected(nt);
      const shipped = detect(nt);
      // Both must agree on the ONE decision the Workspace makes: LOI or not.
      const libIsLoi = lib === 'sources_sought' || lib === 'rfi';
      const shippedIsLoi = shipped === 'sources_sought' || shipped === 'rfi';
      expect({ nt, isLoi: shippedIsLoi }).toEqual({ nt, isLoi: libIsLoi });
    }
  });

  it('a Sources Sought gets the LOI sections and NO submit stage', () => {
    const loi = src.slice(src.indexOf('var LOI_STAGES'), src.indexOf('var RFP_STAGES'));
    for (const label of ['LOI Opening', 'Relevant Experience', 'Capability Fit', 'Why Us', 'Point of Contact']) {
      expect(loi).toContain(label);
    }
    // the RFP-only sections must be ABSENT, not hidden
    for (const gone of ['Transition Plan', 'Risk Management', 'Submit Proposal', 'Outline']) {
      expect(loi).not.toContain(gone);
    }
  });

  it('everything else keeps the full proposal set (RFQ and IDIQ included)', () => {
    const detect = shippedDetect();
    // an IDIQ solicitation arrives AS an RFP — it needs no case of its own
    expect(detect('Solicitation')).toBe('rfp');
    expect(detect('Combined Synopsis/Solicitation')).toBe('rfp');
    expect(['rfq', 'rfp']).toContain(detect('Request for Quote (RFQ)'));
    const rfp = src.slice(src.indexOf('var RFP_STAGES'), src.indexOf('function isLoiMode'));
    for (const label of ['Executive Summary', 'Technical Approach', 'Past Performance', 'Submit Proposal']) {
      expect(rfp).toContain(label);
    }
  });

  it('the terminal action names what actually happens', () => {
    // never "Prepare for Submission" on a notice you cannot submit a proposal to
    expect(src).toContain("isLoiMode()?'Export response':'Prepare for Submission'");
  });

  it('STAGES is resolved from the pursuit BEFORE anything renders', () => {
    const load = src.slice(src.indexOf('S.pursuit = row || {};'));
    const head = load.slice(0, load.indexOf('renderHero()'));
    expect(head).toContain('detectNoticeMode(');
    expect(head).toContain('applyStages()');
  });

  /**
   * The five notice types that ACTUALLY occur across Eric's 88 live pursuits
   * (measured from /api/pipeline on prod 2026-08-18). A synthetic list can pass
   * while the real corpus misroutes, so this pins the real one.
   */
  it('routes every notice type in the LIVE corpus correctly', () => {
    const detect = shippedDetect();
    const isLoi = (nt: string) => ['sources_sought', 'rfi'].includes(detect(nt));
    expect(isLoi('Sources Sought')).toBe(true);
    // the other four are all full-proposal flows
    for (const nt of ['Solicitation', 'Combined Synopsis/Solicitation', 'Presolicitation', 'Special Notice']) {
      expect({ nt, loi: isLoi(nt) }).toEqual({ nt, loi: false });
    }
  });
});

/**
 * The PURSUITS LIST must show the solicitation type on every row.
 *
 * Eric 2026-08-18, looking at the list: "i can't tell the solicitation type". Rows carried
 * only a title, so "Sources Sought B1502 Renovation" and "B149 Chiller Replacement at Pease
 * ANGB" looked like the same kind of work — one is a 2-5 page capability response, the other
 * a full proposal. Only titles that happened to START with the words gave it away.
 *
 * /api/pipeline already enriches every row with notice_type (verified live: 88 rows, 5 real
 * types) — it simply was not rendered.
 */
describe('Pursuits list: the row shows the solicitation type', () => {
  const listSrc = readFileSync(
    join(process.cwd(), 'src/app/opportunity-map/pursuits/route.ts'),
    'utf8',
  );

  function badge(): (nt: string) => string {
    const start = listSrc.indexOf('function noticeBadge(nt){');
    expect(start).toBeGreaterThan(0);
    const end = listSrc.indexOf('\n  }', start) + 4;
    // eslint-disable-next-line no-new-func
    return new Function(
      `const esc = (x) => String(x); ${listSrc.slice(start, end)} return noticeBadge;`,
    )() as (nt: string) => string;
  }

  it('labels every notice type in the LIVE corpus', () => {
    const b = badge();
    expect(b('Sources Sought')).toContain('Sources Sought');
    expect(b('Solicitation')).toContain('Solicitation');
    expect(b('Combined Synopsis/Solicitation')).toContain('Combined Synopsis');
    expect(b('Presolicitation')).toContain('Presolicitation');
    expect(b('Special Notice')).toContain('Special Notice');
  });

  it('marks a RESPONSE type differently from a BID type', () => {
    const b = badge();
    // the one distinction that changes what work the row actually is
    expect(b('Sources Sought')).toContain('resp');
    expect(b('Request for Information (RFI)')).toContain('resp');
    expect(b('Solicitation')).toContain('bid');
    expect(b('Combined Synopsis/Solicitation')).toContain('bid');
  });

  it('shows NOTHING rather than guessing when the type is absent or unknown', () => {
    const b = badge();
    expect(b('')).toBe('');
    expect(b('   ')).toBe('');
    expect(b('Some Future SAM Type')).toBe('');
  });

  it('renders the badge on the row title', () => {
    expect(listSrc).toContain("noticeBadge(p.notice_type)+esc(p.title");
  });

  it('agrees with the SHARED lib on the response-vs-bid split', () => {
    const b = badge();
    for (const nt of ['Sources Sought', 'Solicitation', 'Combined Synopsis/Solicitation', 'Presolicitation']) {
      const libIsResponse = ['sources_sought', 'rfi'].includes(noticeTypeToDetected(nt));
      const badgeIsResponse = b(nt).includes('resp');
      expect({ nt, response: badgeIsResponse }).toEqual({ nt, response: libIsResponse });
    }
  });
});
