/**
 * FY2026 NDAA historical-claim correction (Poteto "NDAA Legislative Intelligence Live").
 *
 * 45 "FY2026 NDAA: …" pain points shipped with NO provenance. Audited against the
 * enacted FY2026 NDAA (PL 119-60, S. 1071) and S. 2296 (never law):
 *   32 enacted → citation added   6 misstated → corrected   6 proposed + 1 unverifiable → retired
 * History is never erased: every original string survives in the corrections record
 * with its classification, evidence, reason and date.
 */
import { describe, expect, it } from 'vitest';
import corrections from '@/data/ndaa-fy26-claim-corrections.json';
import painPoints from '@/data/agency-pain-points.json';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { getNDAAPainPoints } from '@/lib/utils/pain-points';

type Claim = (typeof corrections.claims)[number];
const claims = corrections.claims as Claim[];
const allPainPoints = Object.values((painPoints as { agencies: Record<string, { painPoints: string[] }> }).agencies).flatMap((a) => a.painPoints);
const ndaaNow = allPainPoints.filter((p) => p.includes('FY2026 NDAA'));

describe('the correction record preserves history', () => {
  it('accounts for all 45 original claims exactly once: 32 cited, 6 corrected, 7 retired', () => {
    expect(claims).toHaveLength(45);
    expect(new Set(claims.map((c) => `${c.agency}|${c.original_claim}`)).size).toBe(45);
    expect(corrections.summary).toEqual({ total: 45, cited_enacted: 32, corrected_misstated: 6, retired: 7 });
  });

  it('every entry carries the old claim, a classification, a reason and a correction date', () => {
    for (const c of claims) {
      expect(c.original_claim.startsWith('FY2026 NDAA: ')).toBe(true);
      expect(['A', 'B', 'C', 'D']).toContain(c.classification);
      expect(c.reason.length).toBeGreaterThan(20);
      expect(c.corrected_at).toBe('2026-09-22');
    }
  });

  it('every surviving claim cites the ENACTED vehicle with verbatim evidence; retired ones carry none', () => {
    for (const c of claims) {
      if (c.action === 'retired') {
        expect(c.corrected_claim).toBeNull();
      } else {
        expect(c.vehicle).toBe('PL 119-60');
        expect(c.source_url).toBe('https://www.congress.gov/119/plaws/publ60/PLAW-119publ60.htm');
        expect((c.evidence_quote ?? '').length).toBeGreaterThan(15);
        expect(c.corrected_claim).toMatch(/^FY2026 NDAA \(enacted, PL 119-60 (§\d+|Title LXXXV)\): /);
      }
    }
  });

  it('S. 2296 provisions that were never enacted (SkyFoundry) are retired, never cited as law', () => {
    const sky = claims.filter((c) => /SkyFoundry/.test(c.original_claim));
    expect(sky).toHaveLength(6);
    for (const c of sky) expect(c).toMatchObject({ classification: 'A', action: 'retired', vehicle: 'S. 2296 (ES)' });
  });
});

describe('the customer surface shows only enacted, cited NDAA requirements', () => {
  it('exactly the 38 cited/corrected claims remain, and every one cites PL 119-60', () => {
    const expected = claims.filter((c) => c.corrected_claim).map((c) => c.corrected_claim).sort();
    expect([...ndaaNow].sort()).toEqual(expected);
    for (const p of ndaaNow) expect(p).toMatch(/^FY2026 NDAA \(enacted, PL 119-60 /);
  });

  it('no original unsourced claim, proposed provision or misstated figure survives', () => {
    for (const c of claims) expect(allPainPoints).not.toContain(c.original_claim);
    const text = ndaaNow.join('\n');
    expect(text).not.toMatch(/SkyFoundry/);
    expect(text).not.toMatch(/Renewable energy integration/);
    expect(text).not.toMatch(/\$35M/);                     // enacted threshold is $100M
    expect(text).not.toMatch(/55\+ AI models/);            // figure not in §1512
    expect(text).not.toMatch(/hypersonic technology export restrictions/); // outbound INVESTMENT, not export
  });

  it('the misstated CAS threshold now matches the enacted text ($100M)', () => {
    const cas = ndaaNow.filter((p) => /Cost Accounting Standards/.test(p));
    expect(cas).toHaveLength(3);
    for (const p of cas) expect(p).toMatch(/\$100M/);
  });

  it('getNDAAPainPoints (the /api/pain-points ndaaPainPoints field) returns only cited claims', () => {
    const dod = getNDAAPainPoints('Department of Defense');
    expect(dod.length).toBeGreaterThan(0);
    for (const p of dod) expect(p).toMatch(/\(enacted, PL 119-60 /);
  });

  it('the public SEO copies carry the same correction', () => {
    const seo = JSON.stringify(AGENCIES_SEO);
    expect(seo).not.toMatch(/FY2026 NDAA: /);
    expect((seo.match(/FY2026 NDAA \(enacted, PL 119-60/g) ?? []).length).toBe(2);
  });
});
