import { describe, it, expect } from 'vitest';
import {
  parseIndexFile, formatSolicitationNumber, formatNsn,
  parseReturnByDate, indexFileName, isBusinessDay, recentIndexFiles,
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

  it('emits no files for an all-weekend window, and skips weekends otherwise', () => {
    // Sunday, looking back 2 days = Sat+Sun -> nothing published
    expect(recentIndexFiles(2, new Date('2026-08-02T12:00:00Z'))).toEqual([]);
    // Sunday, looking back 3 days reaches Friday
    expect(recentIndexFiles(3, new Date('2026-08-02T12:00:00Z'))).toEqual(['in260731.txt']);
  });
});
