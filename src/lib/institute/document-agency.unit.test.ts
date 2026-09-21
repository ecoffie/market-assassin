import { describe, it, expect } from 'vitest';
import { classifyDocumentAgency } from './document-agency';
import type { InstituteDocument } from './sources';
import CODES from '@/data/agency-toptier-codes.json';

const NAMES = Object.keys(CODES as Record<string, unknown>);
const doc = (o: Partial<InstituteDocument>): InstituteDocument => ({
  sourceOrg: 'GAO', sourceType: 'gao_report', documentNumber: 'GAO-26-000001',
  title: 'T', url: 'https://www.gao.gov/products/gao-26-000001',
  publicationDate: '2026-09-10', abstract: null, ...o,
});

describe('document agency classification — no force-map', () => {
  it('EXACT_RESOLVABLE: FAA title → DOT', () => {
    const a = classifyDocumentAgency(doc({
      title: 'Flight Simulators: FAA Should Take Steps',
      abstract: 'The Federal Aviation Administration (FAA) uses the National Simulator Program.',
    }), NAMES);
    expect(a.classification).toMatch(/RESOLVABLE/);
    expect(a.resolution.canonicalAgency).toBe('Department of Transportation');
    expect(a.candidates).toEqual(['Department of Transportation']);
  });

  it('MULTI_AGENCY: FEMA + Corps — unresolved, candidates preserved', () => {
    const a = classifyDocumentAgency(doc({
      title: 'Disaster Contracting: FEMA and the Corps of Engineers Have Opportunities',
      abstract: 'The Federal Emergency Management Agency (FEMA) and the Army Corps of Engineers have key responsibilities.',
    }), NAMES);
    expect(a.classification).toBe('MULTI_AGENCY');
    expect(a.resolution.resolved).toBe(false);
    expect(a.candidates.length).toBeGreaterThanOrEqual(2);
    expect(a.candidates).toContain('Department of Homeland Security');
    expect(a.candidates).toContain('Department of Defense');
  });

  it('NO_AGENCY: exposure draft / methodology', () => {
    const a = classifyDocumentAgency(doc({
      title: 'Testing and Evaluation Guide: Best Practices for Commercial Off-the-Shelf Systems (Exposure Draft)',
      abstract: 'From September 2026 through December 2026, GAO is seeking input.',
    }), NAMES);
    expect(a.classification).toBe('NO_AGENCY');
    expect(a.resolution.resolved).toBe(false);
  });

  it('NO_AGENCY: GAO OIG about GAO itself', () => {
    const a = classifyDocumentAgency(doc({
      documentNumber: 'OIG-26-2',
      title: 'Information Technology Modernization: Enhanced Controls Could Help GAO Ensure Decisions Are Documented',
      abstract: 'What the OIG Found\nIn 2021, GAO established a 5-year IT modernization plan.',
    }), NAMES);
    expect(a.classification).toBe('NO_AGENCY');
    expect(a.resolution.resolved).toBe(false);
  });

  it('HIGH_CONFIDENCE: K-12 Education → Department of Education', () => {
    const a = classifyDocumentAgency(doc({
      title: 'K-12 Education: Facility Issues Led About One in Five Districts to Cancel School',
      abstract: 'Chronic facility issues disrupted teaching and learning.',
    }), NAMES);
    expect(a.classification).toBe('HIGH_CONFIDENCE_RESOLVABLE');
    expect(a.resolution.canonicalAgency).toBe('Department of Education');
  });

  it('UNKNOWN stays unresolved — never guessed', () => {
    const a = classifyDocumentAgency(doc({
      title: 'Selected Observations on Federal Programs',
      abstract: 'This report discusses selected topics.',
    }), NAMES);
    expect(a.classification).toBe('UNKNOWN');
    expect(a.resolution.resolved).toBe(false);
  });
});
