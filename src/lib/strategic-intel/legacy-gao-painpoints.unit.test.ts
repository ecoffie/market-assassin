import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractLegacyGaoTagged,
  labelHistoricalGaoPainPoint,
  legacyGaoPublicationDate,
  legacySetHash,
  matchLegacyToGovinfo,
  type ArchivedLegacyPainPoint,
  type PainPointJson,
} from './legacy-gao-painpoints';

const ROOT = resolve(__dirname, '../../..');
const SERVED_PATH = join(ROOT, 'src/data/agency-pain-points.json');
const ARCHIVE_NAME = 'agency-pain-points-historical-gao-1993-2000.json';
const ARCHIVE_PATH = join(ROOT, 'src/data', ARCHIVE_NAME);

const servedRaw = readFileSync(SERVED_PATH);
const served = JSON.parse(servedRaw.toString('utf8')) as PainPointJson;
const archive = JSON.parse(readFileSync(ARCHIVE_PATH, 'utf8')) as {
  summary: { tagged_count: number; set_hash: string };
  items: ArchivedLegacyPainPoint[];
};

// Pinned 2026-11-17 (Data Core PR 4). If either pin moves, the served data changed:
// that is a retirement/adoption decision and must arrive in its own approved PR.
const SERVED_SHA256 = '9c5920e528c69accc8b30290105aceee2a705b55216bbd36c315236aa7e88bbd';
const LEGACY_SET_SHA256 = 'e96fec3381cd621ec75f33cfc5a230efef80c895aaeb0d7ce3dc7e161cffb5f5';

describe('served pain-point JSON is unchanged (nothing retired in this PR)', () => {
  it('byte-for-byte hash pin', () => {
    expect(createHash('sha256').update(servedRaw).digest('hex')).toBe(SERVED_SHA256);
  });
  it('still 307 agency keys and 3,036 pain point strings', () => {
    const agencies = Object.values(served.agencies);
    expect(agencies.length).toBe(307);
    expect(agencies.reduce((n, a) => n + (a.painPoints?.length ?? 0), 0)).toBe(3036);
  });
});

describe('the legacy "(Source: GAO)" set is exactly 278', () => {
  const tagged = extractLegacyGaoTagged(served);
  it('count, unique texts, agencies', () => {
    expect(tagged.length).toBe(278);
    expect(new Set(tagged.map((t) => t.text)).size).toBe(176);
    expect(new Set(tagged.map((t) => t.agency)).size).toBe(27);
  });
  it('content hash pin', () => {
    expect(legacySetHash(tagged)).toBe(LEGACY_SET_SHA256);
  });
  it('a living citation "(Source: GAO-26-…)" is not in the set', () => {
    const t = extractLegacyGaoTagged({
      agencies: { X: { painPoints: ['A (Source: GAO-26-107726)', 'B (Source: GAO)', 42] } },
    });
    expect(t.map((x) => x.text)).toEqual(['B (Source: GAO)']);
    expect(t[0].title).toBe('B');
  });
});

describe('the historical archive matches the set exactly', () => {
  const tagged = extractLegacyGaoTagged(served);
  it('same multiset of (agency, text)', () => {
    expect(archive.items.length).toBe(278);
    expect(archive.summary.tagged_count).toBe(278);
    expect(legacySetHash(archive.items)).toBe(legacySetHash(tagged));
    expect(archive.summary.set_hash).toBe(LEGACY_SET_SHA256);
  });
  it('every item is sourced to a 1993-2000 GovInfo GAO document with a URL', () => {
    for (const item of archive.items) {
      expect(item.match_method).not.toBe('unmatched');
      expect(item.source).not.toBeNull();
      const d = item.source!.publication_date!;
      expect(d >= '1993-01-01' && d < '2001-01-01').toBe(true);
      expect(item.source!.source_url).toMatch(/^https:\/\/www\.govinfo\.gov\/app\/details\/GAOREPORTS-/);
      expect(item.source!.source_document).toMatch(/^GAOREPORTS-/);
    }
  });
  it('the archive is NOT served — no src file references it', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|js|mjs)$/.test(name) || /\.unit\.test\./.test(name)) continue;
        if (readFileSync(p, 'utf8').includes(ARCHIVE_NAME)) hits.push(p);
      }
    };
    walk(join(ROOT, 'src'));
    expect(hits).toEqual([]);
  });
});

describe('labelHistoricalGaoPainPoint — raw surfaces get date + LEGACY_MANUAL', () => {
  it('labels a bare (Source: GAO) string with its government date', () => {
    const text = 'Contract Management: DOD\'s Anthrax Vaccine Manufacturer (Source: GAO)';
    expect(legacyGaoPublicationDate(text)).toBe('2000-04-14');
    const labeled = labelHistoricalGaoPainPoint(text);
    expect(labeled).toContain('historical GAO finding, published 2000-04-14');
    expect(labeled).toContain('[LEGACY_MANUAL — provenance unavailable]');
    expect(labeled).not.toMatch(/\(Source: GAO\)$/);
  });

  it('leaves living citations and already-labeled strings alone', () => {
    expect(labelHistoricalGaoPainPoint('X (Source: GAO-26-107726)')).toBe('X (Source: GAO-26-107726)');
    const once = labelHistoricalGaoPainPoint('Y (Source: GAO)');
    expect(labelHistoricalGaoPainPoint(once)).toBe(once);
  });
});

describe('matchLegacyToGovinfo', () => {
  const rows = [
    { agency_name: 'A', title: 'Full Title Here', publication_date: '1998-01-02', source_url: 'https://x/1', source_document: 'GAOREPORTS-T-AIMD-98-1' },
    { agency_name: 'B', title: 'Full Title Here', publication_date: '1998-01-02', source_url: 'https://x/1', source_document: 'GAOREPORTS-T-AIMD-98-1' },
    { agency_name: 'A', title: 'Truncated Title Continues', publication_date: '1997-05-05', source_url: 'https://x/2', source_document: 'GAOREPORTS-RCED-97-2' },
    { agency_name: 'A', title: 'Truncated Title Other', publication_date: '1997-06-06', source_url: 'https://x/3', source_document: 'GAOREPORTS-RCED-97-3' },
  ];
  it('exact title, de-duplicated by package id, records every filing agency', () => {
    const [m] = matchLegacyToGovinfo([{ agency: 'B', text: 'Full Title Here (Source: GAO)', title: 'Full Title Here' }], rows);
    expect(m.match_method).toBe('exact_title');
    expect(m.source?.gao_product_number).toBe('T-AIMD-98-1');
    expect(m.alternate_sources).toEqual([]);
    expect(m.source_row_agencies).toEqual(['A', 'B']);
    expect(m.agency_matches_source_row).toBe(true);
  });
  it('prefix match keeps the ambiguity visible', () => {
    const [m] = matchLegacyToGovinfo([{ agency: 'Z', text: 'Truncated Title (Source: GAO)', title: 'Truncated Title' }], rows);
    expect(m.match_method).toBe('title_prefix');
    expect(m.source?.source_document).toBe('GAOREPORTS-RCED-97-2');
    expect(m.alternate_sources.map((s) => s.source_document)).toEqual(['GAOREPORTS-RCED-97-3']);
    expect(m.agency_matches_source_row).toBe(false);
  });
  it('unmatched stays unmatched', () => {
    const [m] = matchLegacyToGovinfo([{ agency: 'A', text: 'Nope (Source: GAO)', title: 'Nope' }], rows);
    expect(m.match_method).toBe('unmatched');
    expect(m.source).toBeNull();
  });
});
