/**
 * Shared sourced-intelligence reader — provenance contract + legacy fallback.
 */
import { describe, it, expect } from 'vitest';
import {
  extractDocumentNumber,
  dedupeLegacyAgainstSourced,
  getAgencySourcedIntelligence,
  INSTITUTE_SOURCE_CUSTOMER_SELECT,
  INSTITUTE_SOURCE_PUBLIC_SELECT,
  loadLegacyPainPointsForAgency,
  loadSourcedPainPointsForAgency,
  formatPainPointForDisplay,
  omitUnsourcedDollarAmounts,
  sanitizeLegacyClaimText,
  toCitation,
  type SourcedPainPoint,
} from './sourced-pain-points';
import type { SupabaseClient } from '@supabase/supabase-js';

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
    const { text, omitted, emptied } = omitUnsourcedDollarAmounts(raw);
    expect(omitted.some((a) => /2\.3/i.test(a))).toBe(true);
    expect(emptied).toBe(false);
    expect(text).not.toMatch(/\$/);
    expect(text).toMatch(/Columbia-class submarine program/i);
    expect(text).toMatch(/shipbuilding contractors/i);

    const bundle = loadLegacyPainPointsForAgency('NAVSEA', 10);
    expect(bundle.priorities.length).toBeGreaterThan(0);
    for (const p of bundle.priorities) {
      expect(p.pain_point).not.toMatch(/\$/);
      expect(p.pain_point.length).toBeGreaterThan(0);
      expect(p.provenance).toBe('LEGACY_MANUAL');
    }
    // Qualitative program names survive.
    const joined = bundle.priorities.map((p) => p.pain_point).join(' ');
    expect(joined).toMatch(/Columbia-class/i);
    expect(joined).toMatch(/Virginia-class/i);
    expect(joined).toMatch(/SIOP|Shipyard Infrastructure/i);
  });

  it('does not restore a claim that sanitizes to empty (dollar-only)', () => {
    // Regression: `out || text` used to re-emit the original amount.
    for (const raw of ['$2.3B', 'Allocated $2.3B', 'allocated $2.3B for']) {
      const { text, omitted, emptied } = omitUnsourcedDollarAmounts(raw);
      expect(omitted.length).toBeGreaterThan(0);
      expect(emptied).toBe(true);
      expect(text).toBe('');
      expect(text).not.toMatch(/\$|2\.3/i);
      expect(sanitizeLegacyClaimText(raw)).toBe('');
    }
  });

  it('keeps sourced dollar claims (SOURCE_FACT) intact', () => {
    const s = sourced({
      pain_point: 'Program cost grew to $16.1B (Source: GAO-26-107726)',
    });
    expect(formatPainPointForDisplay(s)).toMatch(/\$16\.1B/);
    expect(toCitation(s).claim).toMatch(/\$16\.1B/);
  });

  it('marks a thrown living read as failed and an empty result as not failed', async () => {
    const down = {
      from() {
        throw new Error('down');
      },
    } as unknown as SupabaseClient;
    const failed = await getAgencySourcedIntelligence('Department of Defense', { client: down });
    expect(failed.meta.sourcedReadFailed).toBe(true);
    expect(failed.sourced).toEqual([]);
    expect(failed.legacy.length).toBeGreaterThan(0);

    const empty = {
      from() {
        const chain = {
          select: () => chain,
          in: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: async () => ({ data: [], error: null }),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    const none = await getAgencySourcedIntelligence('Department of Defense', { client: empty });
    expect(none.meta.sourcedReadFailed).toBe(false);
    expect(none.sourced).toEqual([]);
  });

  it('scorecard findability omits institute_sources.raw from the select', async () => {
    expect(INSTITUTE_SOURCE_PUBLIC_SELECT).not.toMatch(/\braw\b/);
    expect(INSTITUTE_SOURCE_CUSTOMER_SELECT).toMatch(/\braw\b/);

    const instituteSelects: string[] = [];
    const painRow = {
      id: 'p1',
      agency: 'Department of Energy',
      pain_point: 'Scheduling delays (Source: OIG-26-3)',
      source: 'ig_report',
      source_url: 'https://www.oversight.gov/report/oig-26-3',
      institute_source_ids: ['ig-1'],
      confidence: 'high',
      status: 'open',
    };
    const instituteRow = {
      id: 'ig-1',
      document_number: 'OIG-26-3',
      source_url: 'https://www.oversight.gov/report/oig-26-3',
      publication_date: '2026-01-01',
      title: 'Scheduling',
      canonical_agency: 'Department of Energy',
      raw: { acquisition: { recommendation: 'SECRET_REC', resolution_status: 'open' } },
    };

    const client = {
      from(table: string) {
        const result = table === 'agency_pain_points_db'
          ? { data: [painRow], error: null }
          : { data: [instituteRow], error: null };
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = (cols: string) => {
          if (table === 'institute_sources') instituteSelects.push(cols);
          return chain;
        };
        chain.in = (..._args: unknown[]) => {
          if (table === 'institute_sources') return Promise.resolve(result);
          return chain;
        };
        chain.eq = self;
        chain.order = self;
        chain.limit = () => Promise.resolve(result);
        return chain;
      },
    } as unknown as SupabaseClient;

    const thin = await loadSourcedPainPointsForAgency('Department of Energy', {
      client,
      includeAcquisitionRaw: false,
    });
    expect(instituteSelects).toEqual([INSTITUTE_SOURCE_PUBLIC_SELECT]);
    expect(thin[0]?.recommendation).toBeNull();
    expect(thin[0]?.institute_source_id).toBe('ig-1');
    expect(JSON.stringify(thin)).not.toContain('SECRET_REC');

    instituteSelects.length = 0;
    const full = await loadSourcedPainPointsForAgency('Department of Energy', {
      client,
      includeAcquisitionRaw: true,
    });
    expect(instituteSelects).toEqual([INSTITUTE_SOURCE_CUSTOMER_SELECT]);
    expect(full[0]?.recommendation).toBe('SECRET_REC');
  });
});
