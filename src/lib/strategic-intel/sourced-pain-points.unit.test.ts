/**
 * Shared sourced-intelligence reader — provenance contract + legacy fallback.
 */
import { describe, it, expect } from 'vitest';
import {
  extractDocumentNumber,
  dedupeLegacyAgainstSourced,
  loadLegacyPainPointsForAgency,
  formatPainPointForDisplay,
  omitUnsourcedDollarAmounts,
  toCitation,
  type SourcedPainPoint,
} from './sourced-pain-points';

const sourced = (o: Partial<SourcedPainPoint>): SourcedPainPoint => ({
  agency: 'Department of Transportation',
  pain_point: 'Flight Simulators: FAA Should Take Steps (Source: GAO-26-107726)',
  source_type: 'gao',
  source_url: 'https://www.gao.gov/products/gao-26-107726',
  document_number: 'GAO-26-107726',
  published_at: '2026-09-03',
  institute_source_id: 'src-1',
  provenance: 'SOURCE_FACT',
  legacy_source_tag: null,
  ...o,
});

const legacy = (o: Partial<SourcedPainPoint>): SourcedPainPoint => ({
  agency: 'Department of Transportation',
  pain_point: 'Aging infrastructure challenges (Source: GAO)',
  source_type: 'legacy_manual',
  source_url: null,
  document_number: null,
  published_at: null,
  institute_source_id: null,
  provenance: 'LEGACY_MANUAL',
  legacy_source_tag: 'GAO',
  ...o,
});

describe('sourced pain points — provenance contract', () => {
  it('extracts GAO document numbers', () => {
    expect(extractDocumentNumber('x (Source: GAO-26-107726)')).toBe('GAO-26-107726');
    expect(extractDocumentNumber('no doc')).toBeNull();
  });

  it('customer sourced rows require URL + Institute id for SOURCE_FACT display path', () => {
    const s = sourced({});
    expect(s.source_url).toBeTruthy();
    expect(s.institute_source_id).toBeTruthy();
    expect(s.provenance).toBe('SOURCE_FACT');
    expect(formatPainPointForDisplay(s)).not.toMatch(/LEGACY_MANUAL/);
  });

  it('derived interpretation is labeled as interpretation', () => {
    const s = sourced({ provenance: 'MINDY_INTERPRETATION', institute_source_id: null, source_url: null });
    expect(formatPainPointForDisplay(s)).toMatch(/MINDY_INTERPRETATION/);
  });

  it('legacy JSON fallback never fabricates provenance / URL', () => {
    const bundle = loadLegacyPainPointsForAgency('Department of Veterans Affairs', 5);
    for (const p of bundle.painPoints) {
      expect(p.provenance).toBe('LEGACY_MANUAL');
      expect(p.source_url).toBeNull();
      expect(p.institute_source_id).toBeNull();
      expect(formatPainPointForDisplay(p)).toMatch(/LEGACY_MANUAL/);
    }
  });

  it('dedupes legacy claim that shares a sourced GAO document number', () => {
    const s = [sourced({})];
    const l = [
      legacy({ pain_point: 'Other claim', document_number: 'GAO-26-107726' }),
      legacy({ pain_point: 'Unrelated legacy claim about bridges' }),
    ];
    const kept = dedupeLegacyAgainstSourced(s, l);
    expect(kept).toHaveLength(1);
    expect(kept[0].pain_point).toMatch(/Unrelated/);
  });

  it('does not merge sourced + legacy into one provenance class', () => {
    const s = sourced({});
    const l = legacy({});
    expect(s.provenance).not.toBe(l.provenance);
    expect(formatPainPointForDisplay(s)).not.toEqual(formatPainPointForDisplay(l));
  });

  it('omits unsourced dollar amounts from LEGACY_MANUAL default claims', () => {
    const raw =
      'NAVSEA allocated $2.3B for the Columbia-class submarine program in FY2025, with ongoing contracts for design and construction support open to shipbuilding contractors.';
    const { text, omitted } = omitUnsourcedDollarAmounts(raw);
    expect(omitted.some((a) => /2\.3/i.test(a))).toBe(true);
    expect(text).not.toMatch(/\$/);
    expect(text).toMatch(/Columbia-class submarine program/i);
    expect(text).toMatch(/shipbuilding contractors/i);

    const bundle = loadLegacyPainPointsForAgency('NAVSEA', 10);
    expect(bundle.priorities.length).toBeGreaterThan(0);
    for (const p of bundle.priorities) {
      expect(p.pain_point).not.toMatch(/\$/);
      expect(p.provenance).toBe('LEGACY_MANUAL');
    }
    // Qualitative program names survive.
    const joined = bundle.priorities.map((p) => p.pain_point).join(' ');
    expect(joined).toMatch(/Columbia-class/i);
    expect(joined).toMatch(/Virginia-class/i);
    expect(joined).toMatch(/SIOP|Shipyard Infrastructure/i);
  });

  it('keeps sourced dollar claims (SOURCE_FACT) intact', () => {
    const s = sourced({
      pain_point: 'Program cost grew to $16.1B (Source: GAO-26-107726)',
    });
    expect(formatPainPointForDisplay(s)).toMatch(/\$16\.1B/);
    expect(toCitation(s).claim).toMatch(/\$16\.1B/);
  });
});
