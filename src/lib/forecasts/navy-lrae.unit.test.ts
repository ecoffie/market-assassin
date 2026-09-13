import { describe, it, expect } from 'vitest';
import {
  isXlsxSignature, revisionCandidates, revisionSortKey, discoverLatestRevision,
  assessCurrentness, selectSheet, detectHeaderRow, isEmptyColumnParse,
} from './navy-lrae';

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const HTML = new Uint8Array([0x3c, 0x68, 0x74, 0x6d]); // '<htm' — the soft-404 body

const respond = (body: Uint8Array, status = 200) => ({
  status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
}) as unknown as Response;

describe('the soft-404 trap — status codes never prove existence', () => {
  it('HTTP 200 + HTML does NOT count as a revision', () => {
    expect(isXlsxSignature(HTML)).toBe(false);
  });

  it('only the ZIP/XLSX signature counts', () => {
    expect(isXlsxSignature(PK)).toBe(true);
    expect(isXlsxSignature(new Uint8Array([0x50]))).toBe(false);   // truncated
    expect(isXlsxSignature(new Uint8Array())).toBe(false);
  });

  it('discovery skips every 200-with-HTML and returns the first REAL workbook', async () => {
    // Measured shape: 02.2027 / 01.2027 / 09.2026 all soft-404; 02.2026 is real.
    const fake = (async (url: string) =>
      respond(String(url).includes('02.2026') ? PK : HTML)) as unknown as typeof fetch;
    const d = await discoverLatestRevision(fake, new Date('2026-09-13T00:00:00Z'), 12);
    expect(d.latestAvailable?.revision).toBe('02.2026');
    expect(d.discoveryFailed).toBe(false);
  });
});

describe('discovery failure is never "no newer revision"', () => {
  it('a transport failure on every candidate reports discoveryFailed, not "none"', async () => {
    const dead = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const d = await discoverLatestRevision(dead, new Date('2026-09-13T00:00:00Z'), 6);
    expect(d.discoveryFailed).toBe(true);
    expect(assessCurrentness(d, '02.2026').state).toBe('latest_upstream_unmeasured');
  });

  it('UNMEASURED never reads as CURRENT even when a revision is held', async () => {
    const dead = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const c = assessCurrentness(await discoverLatestRevision(dead, new Date(), 3), '02.2026');
    expect(c.state).not.toBe('current');
  });
});

describe('currentness is orthogonal to a successful sync', () => {
  const found = { latestAvailable: { revision: '03.2027', url: 'u', probedBytes: 2048 }, discoveryFailed: false, probed: 1 };

  it('BEHIND_UPSTREAM even though the held revision ingested fine', () => {
    const c = assessCurrentness(found, '02.2026');
    expect(c.state).toBe('behind_upstream');
    expect(c.latestAvailableRevision).toBe('03.2027');
  });

  it('CURRENT when held equals available', () => {
    expect(assessCurrentness({ ...found, latestAvailable: { revision: '02.2026', url: 'u', probedBytes: 1 } }, '02.2026').state).toBe('current');
  });

  it('holding nothing while upstream exists is BEHIND_UPSTREAM', () => {
    expect(assessCurrentness(found, null).state).toBe('behind_upstream');
  });
});

describe('revision ordering and bounded probing', () => {
  it('candidates are newest-first and BOUNDED', () => {
    const c = revisionCandidates(new Date('2026-09-13T00:00:00Z'), 18);
    expect(c).toHaveLength(18);
    expect(c[0]).toBe('09.2026');
    expect(c[1]).toBe('08.2026');
    expect(c.at(-1)).toBe('04.2025');
  });

  it('orders MM.YYYY chronologically, not lexically', () => {
    expect(revisionSortKey('03.2027')).toBeGreaterThan(revisionSortKey('12.2026'));
    expect(revisionSortKey('02.2026')).toBeGreaterThan(revisionSortKey('01.2026'));
    expect(revisionSortKey('nonsense')).toBe(-1);
  });
});

describe('parser safety — the __EMPTY silent-failure shape', () => {
  it('selects the authoritative sheet, not the Query Sheet', () => {
    expect(selectSheet(['Query Sheet', 'Full LRAE', 'Dropdowns'])).toBe('Full LRAE');
    expect(selectSheet(['Query Sheet', 'Dropdowns'])).toBeNull();
  });

  it('detects the REAL header row (row 3 in the live workbook), not row 0', () => {
    const aoa = [[], ['Title', 'Description'], [], ['Requirement Title', 'Requirement Description']];
    expect(detectHeaderRow(aoa)).toBe(3);
  });

  it('returns null when the required business column is absent', () => {
    expect(detectHeaderRow([['a', 'b'], ['c', 'd']])).toBeNull();
  });

  it('rejects an __EMPTY_*-only parse — the silent-failure signature', () => {
    expect(isEmptyColumnParse(['__EMPTY', '__EMPTY_1', '__EMPTY_2'])).toBe(true);
    expect(isEmptyColumnParse([])).toBe(true);
    expect(isEmptyColumnParse(['Requirement Title', '__EMPTY_1'])).toBe(false);
  });
});
