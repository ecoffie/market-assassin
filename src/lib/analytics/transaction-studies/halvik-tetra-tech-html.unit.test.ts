import { describe, expect, it } from 'vitest';
import data from './halvik-tetra-tech.data.json';
import { renderHalvikStudyHtml, HALVIK_STUDY_SLUG } from './halvik-tetra-tech-html';
import { publishedBySlug } from '@/lib/analytics/research-publications';

const html = renderHalvikStudyHtml({ canonical: 'https://getmindy.ai/research/halvik-tetra-tech', draft: false });
// Visible text only: tags and attribute values removed.
const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
const text = article.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Transaction Study 001 — frozen data', () => {
  it('matches the independently recomputed register', () => {
    expect(data.as_of).toBe('2026-01-21');
    expect(data.obligations_through_cutoff).toBe(724711413.15);
    expect(data.counts.awards_admissible).toBe(245);
    expect(data.counts.contracts_admissible).toBe(215);
    expect(data.counts.vehicles_admissible).toBe(30);
    expect(data.counts.actions_after_cutoff).toBe(148);
  });

  it('annual obligations sum to the cumulative total (no year double-counted or dropped)', () => {
    const sum = data.annual_obligations.reduce((s, r) => s + r.obligations, 0);
    expect(Math.abs(sum - data.obligations_through_cutoff)).toBeLessThan(0.1);
  });

  it('set-aside families partition the total', () => {
    const sum = data.set_aside_family.reduce((s, r) => s + r.obligations, 0) + data.vehicle_level_obligations.amount;
    expect(Math.abs(sum - data.obligations_through_cutoff)).toBeLessThan(0.1);
    expect(data.set_aside_family.reduce((s, r) => s + r.contracts, 0)).toBe(215);
  });
});

describe('Transaction Study 001 — publication rules', () => {
  it('never calls obligations revenue: every "revenue" is negated or attributed', () => {
    const hits = [...text.matchAll(/[^.]*\brevenue\b[^.]*\./gi)].map((m) => m[0]);
    expect(hits.length).toBeGreaterThan(0);
    for (const s of hits) expect(s).toMatch(/\b(not|no|does not|cannot|discloses no|Recognized revenue|Commercial or non-federal revenue|Complete subcontract revenue|Washington Technology|estimate|unclassified prime contract revenue)\b/i);
  });

  it('never presents ceiling as backlog', () => {
    for (const m of text.matchAll(/[^.]*\bbacklog\b[^.]*\./gi)) expect(m[0]).toMatch(/\b(not|no|nothing|discloses no)\b|Financial backlog/i);
  });

  it('asserts no eligibility or loss consequence', () => {
    expect(text).not.toMatch(/\b(lost|will be terminated|no longer eligible|ineligible|forfeit)/i);
    expect(text).toContain('does not determine the post-acquisition eligibility consequence');
  });

  it('keeps acquirer disclosures in a separately labeled block', () => {
    expect(text).toContain('Subsequently reported');
    const later = html.indexOf('Subsequently reported');
    expect(html.indexOf('$160 million to goodwill')).toBeGreaterThan(later);
  });

  it('does not state unverified 8(a) program dates', () => {
    expect(text).not.toMatch(/2015-03-27|March 27, 2015|2024-01-23|January 23, 2024|graduated (in|on)/i);
  });

  it('does not fold SP Systems into Halvik totals', () => {
    expect(text).toContain('$724.7M');
    expect(text).not.toContain('$776.5M'); // Halvik + SP Systems combined
  });
});

describe('Transaction Study 001 — not published', () => {
  it('is not served publicly until a registry entry marks it published', () => {
    expect(publishedBySlug(HALVIK_STUDY_SLUG)).toBeNull();
  });
});
