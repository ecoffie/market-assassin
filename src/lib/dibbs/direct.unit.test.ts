import { describe, it, expect } from 'vitest';
import {
  parseIndexFile, formatSolicitationNumber, formatNsn,
  parseReturnByDate, indexFileName, isBusinessDay, recentIndexFiles,
  isPublicationDay, classifyArchiveResponse,
} from './direct';

// A REAL line captured from in260731.txt (2026-08-02). Every field below is
// cross-checked against the row the Apify vendor independently produced.
const REAL =
  'SPE2DP26T42516505016247068                                    701758470508/05/26SPE2DP26T4251.pdf  0000002BTOMEPRAZOLE EXTENDED-RPHPHAZ1N000';

describe('DIBBS direct parser', () => {
  it('parses a real fixed-width record to match the vendor output', () => {
    const [r] = parseIndexFile(REAL);
    expect(r.solicitationNumber).toBe('SPE2DP-26-T-4251'); // vendor: same
    expect(r.nsn).toBe('6505-01-624-7068');                // vendor: same
    expect(r.fsc).toBe('6505');                            // vendor: same
    expect(r.unitOfIssue).toBe('BT');                      // vendor: same
    expect(r.returnByDate).toBe('2026-08-05');             // vendor: same
    expect(r.quantity).toBe(2);
    expect(r.pdfUrl).toContain('SPE2DP26T4251.pdf');
  });

  it('skips malformed/short lines rather than emitting wrong data', () => {
    expect(parseIndexFile('too short\n\n')).toHaveLength(0);
    expect(parseIndexFile(`${REAL}\nshort line\n${REAL}`)).toHaveLength(2);
  });

  it('formats solicitation numbers and NSNs, passing through odd shapes', () => {
    expect(formatSolicitationNumber('SPE2DP26T4251')).toBe('SPE2DP-26-T-4251');
    expect(formatSolicitationNumber('WEIRD')).toBe('WEIRD');
    expect(formatNsn('6505016247068')).toBe('6505-01-624-7068');
    expect(formatNsn('123')).toBe('123');
  });

  it('parses MM/DD/YY dates and rejects junk', () => {
    expect(parseReturnByDate('08/05/26')).toBe('2026-08-05');
    expect(parseReturnByDate('')).toBeUndefined();
    expect(parseReturnByDate('2026-08-05')).toBeUndefined();
  });

  it('builds in<YYMMDD>.txt names', () => {
    expect(indexFileName(new Date('2026-07-31T12:00:00Z'))).toBe('in260731.txt');
  });

  it('knows business days — the weekend rule the STARVED check depends on', () => {
    expect(isBusinessDay(new Date('2026-08-02T12:00:00Z'))).toBe(false); // Sunday
    expect(isBusinessDay(new Date('2026-08-01T12:00:00Z'))).toBe(false); // Saturday
    expect(isBusinessDay(new Date('2026-07-31T12:00:00Z'))).toBe(true);  // Friday
  });

  it('requests SUNDAY files and skips only Saturday (DLA publishes Sun–Fri)', () => {
    // Verified 2026-10-10: in261004.txt (Sunday) = 1,416 rows; in261003.txt (Saturday)
    // redirects to FileNotFound.aspx. The old Mon–Fri rule skipped every Sunday file.
    expect(isPublicationDay(new Date('2026-10-04T12:00:00Z'))).toBe(true);  // Sunday
    expect(isPublicationDay(new Date('2026-10-03T12:00:00Z'))).toBe(false); // Saturday
    expect(isPublicationDay(new Date('2026-10-02T12:00:00Z'))).toBe(true);  // Friday
    // Sunday, looking back 2 days = Sun + Sat -> only Sunday's file
    expect(recentIndexFiles(2, new Date('2026-08-02T12:00:00Z'))).toEqual(['in260802.txt']);
    // Monday, looking back 3 days = Mon + Sun + Sat
    expect(recentIndexFiles(3, new Date('2026-10-05T12:00:00Z'))).toEqual(['in261005.txt', 'in261004.txt']);
    // A Saturday-only window is the one genuinely empty case
    expect(recentIndexFiles(1, new Date('2026-10-03T12:00:00Z'))).toEqual([]);
  });

  it('dashes letter-suffixed serials exactly like the actor (no more twin rows)', () => {
    // Real ids from in261006/in261007; the actor stored these dashed. The digits-only pattern
    // left them raw, so one RFQ became two dibbs_rfqs rows.
    expect(formatSolicitationNumber('SPE7MC26T252L')).toBe('SPE7MC-26-T-252L');
    expect(formatSolicitationNumber('SPE2DS26T213Q')).toBe('SPE2DS-26-T-213Q');
    expect(formatSolicitationNumber('SPE4A526T449G')).toBe('SPE4A5-26-T-449G');
    expect(formatSolicitationNumber('SPE2DP26T4251')).toBe('SPE2DP-26-T-4251'); // unchanged
    const line = 'SPE7MC26T252L' + REAL.slice(13);
    expect(parseIndexFile(line)[0].solicitationNumber).toBe('SPE7MC-26-T-252L');
  });
});

describe('archive response classification — missing is not blocked', () => {
  const ARCH = 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in261007.txt';
  it('a real file is data', () => {
    expect(classifyArchiveResponse({ status: 200, contentType: 'text/plain; charset=ISO-8859-1', finalUrl: ARCH, text: REAL })).toBe('data');
  });
  it('the FileNotFound redirect is MISSING (Saturday, not-yet-posted, bogus date)', () => {
    // Measured 2026-10-10: 302 -> /FileNotFound.aspx, 200 text/html, 4,900 B.
    expect(classifyArchiveResponse({
      status: 200, contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://dibbs2.bsm.dla.mil/FileNotFound.aspx', text: '\r<!DOCTYPE html PUBLIC',
    })).toBe('missing');
    expect(classifyArchiveResponse({ status: 404, contentType: 'text/html', finalUrl: ARCH, text: '' })).toBe('missing');
  });
  it('the consent page (or any other HTML) on the file URL is BLOCKED', () => {
    expect(classifyArchiveResponse({
      status: 200, contentType: 'text/html; charset=utf-8', finalUrl: ARCH,
      text: '<!DOCTYPE html><title>Department of Defense (DoD) Warning and Consent ~ DIBBS</title>',
    })).toBe('blocked');
    // HTML served with a misleading content-type is still HTML
    expect(classifyArchiveResponse({ status: 200, contentType: 'text/plain', finalUrl: ARCH, text: '  <html><body>Request Rejected' })).toBe('blocked');
  });
  it('other statuses are errors, not "no data"', () => {
    expect(classifyArchiveResponse({ status: 500, contentType: 'text/html', finalUrl: ARCH, text: 'x' })).toBe('error');
  });
});
