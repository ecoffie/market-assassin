import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import data from './halvik-tetra-tech.data.json';
import { renderHalvikStudyHtml, HALVIK_STUDY_SLUG } from './halvik-tetra-tech-html';
import { RECONCILIATION } from './halvik-tetra-tech.facts';
import { publishedBySlug } from '@/lib/analytics/research-publications';

const CANONICAL = 'https://getmindy.ai/research/halvik-tetra-tech';
const html = renderHalvikStudyHtml({ canonical: CANONICAL, draft: false });
const draftHtml = renderHalvikStudyHtml({ canonical: CANONICAL, draft: true });
// Visible article text only (site chrome and scripts excluded).
const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
const text = article.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('Transaction Study 001 — frozen data and historical cutoff', () => {
  it('matches the independently recomputed register', () => {
    expect(data.as_of).toBe('2026-01-21');
    expect(data.obligations_through_cutoff).toBe(724711413.15);
    expect(data.counts.awards_admissible).toBe(245);
    expect(data.counts.contracts_admissible).toBe(215);
    expect(data.counts.vehicles_admissible).toBe(30);
  });

  it('admits nothing dated or reported after the cutoff', () => {
    expect(data.leakage.max_included_action_date <= data.as_of).toBe(true);
    expect(data.leakage.max_included_report_date <= data.as_of).toBe(true);
    expect(data.counts.actions_after_cutoff).toBe(148);
    expect(data.counts.actions_reported_after_cutoff).toBe(1);
    expect(data.leakage.excluded_actions).toBe(149);
    for (const a of data.top_awards) expect(a.first <= data.as_of).toBe(true);
    expect(Math.max(...data.annual_obligations.map((r) => r.fy))).toBe(2026);
    expect(data.annual_obligations.find((r) => r.fy === 2026)!.partial).toBe(true);
  });

  it('the acquisition-to-cutoff window holds only $0 actions (disclosed on the page)', () => {
    expect(data.leakage.actions_between_acquisition_and_cutoff).toBe(2);
    expect(data.leakage.obligations_between_acquisition_and_cutoff).toBe(0);
    expect(text).toContain('Both are $0 administrative modifications');
  });

  it('annual obligations sum to the cumulative total', () => {
    const sum = data.annual_obligations.reduce((s, r) => s + r.obligations, 0);
    expect(Math.abs(sum - data.obligations_through_cutoff)).toBeLessThan(0.1);
  });

  it('set-aside families + the vehicle-level obligation partition the total', () => {
    const sum = data.set_aside_family.reduce((s, r) => s + r.obligations, 0) + data.vehicle_level_obligations.amount;
    expect(Math.abs(sum - data.obligations_through_cutoff)).toBeLessThan(0.1);
    expect(data.set_aside_family.reduce((s, r) => s + r.contracts, 0)).toBe(215);
  });
});

describe('Transaction Study 001 — material figures on the page', () => {
  it.each([
    ['awards', '245 prime awards and contract vehicles'],
    ['obligations', '$724,711,413.15'],
    ['FY2017', '$3.1M in FY2017'],
    ['FY2025', '$186.7M in FY2025'],
    ['set-aside share', "92.6% of Halvik's cumulative public federal obligations through the cutoff were associated with awards recorded under small-business, 8(a) or WOSB set-aside classifications"],
    ['departments', '94.1%'],
    ['vehicles', 'orders under the five largest vehicles for 78.0%'],
    ['largest order', 'the single largest order (NASA) for 15.8%'],
    ['vehicles named', '17 of 17'],
    ['NASA reconciliation', 'within 0.03%'],
    ['acquisition date', 'Acquisition date: January 16, 2026'],
    ['announcement date', 'Public announcement date: January 22, 2026'],
    ['cutoff', 'historical cutoff: January 21, 2026'],
  ])('%s', (_label, needle) => {
    expect(text).toContain(needle);
  });

  it('the headline share is computed, not typed', () => {
    const reserved = data.set_aside_family
      .filter((r) => !['No set-aside', 'Not recorded'].includes(r.family))
      .reduce((s, r) => s + r.share, 0);
    expect((reserved * 100).toFixed(1)).toBe('92.6');
  });
});

describe('Transaction Study 001 — publication rules', () => {
  it('never calls obligations revenue: every "revenue" sentence is negated, listed as unknowable, or attributed', () => {
    const hits = [...text.matchAll(/[^.]*\brevenue\b[^.]*\./gi)].map((m) => m[0]);
    expect(hits.length).toBeGreaterThan(0);
    for (const s of hits) expect(s).toMatch(/\b(not|no|does not|cannot|discloses no|Recognized revenue|Complete subcontract revenue|Washington Technology|estimate|unclassified prime contract revenue)\b/i);
  });

  it('never presents ceiling as backlog', () => {
    for (const m of text.matchAll(/[^.]*\bbacklog\b[^.]*\./gi)) expect(m[0]).toMatch(/\b(not|no|nothing|discloses no|cannot)\b|Financial backlog/i);
  });

  it('never says the business "came from" set-asides', () => {
    expect(text).not.toMatch(/business came from set-asides|of Halvik's business/i);
  });

  it('asserts no loss, overpayment or eligibility conclusion', () => {
    expect(text).not.toMatch(/\b(lost the|were lost|disappeared|destroyed|overpaid|underpaid|became ineligible|no longer eligible|will be terminated|forfeit)/i);
    expect(text).toContain('This study does not determine those consequences.');
  });

  it('keeps acquirer price disclosures in the subsequently-reported block only', () => {
    const later = html.indexOf('Subsequently reported');
    const laterEnd = html.indexOf('</div>', html.indexOf('Published after the cutoff'));
    expect(later).toBeGreaterThan(0);
    for (const fig of ['$150 million', '$25 million', '$35 million', '$97 million', '$160 million to goodwill']) {
      const i = html.indexOf(fig);
      expect(i).toBeGreaterThan(later);
      expect(i).toBeLessThan(laterEnd);
    }
  });

  it('does not state unverified 8(a) program dates', () => {
    expect(text).not.toMatch(/2015-03-27|March 27, 2015|2024-01-23|January 23, 2024|graduated (in|on)/i);
  });

  it('does not fold SP Systems into Halvik totals', () => {
    expect(text).not.toContain('$776.5M'); // Halvik + SP Systems combined
    expect(text).toContain('not included in any Halvik figure');
  });

  it('never reads the stale potential-total-value snapshot', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/analytics/transaction-studies/halvik-tetra-tech-html.ts'), 'utf8');
    expect(src).not.toMatch(/potential_total_value|potential_award_value/);
  });

  it('unresolved assertions stay visibly unresolved', () => {
    const unresolved = RECONCILIATION.filter((r) => r.status === 'unresolved').map((r) => r.claim).join(' ');
    expect(RECONCILIATION.filter((r) => r.status === 'unresolved')).toHaveLength(3);
    expect(unresolved).toMatch(/G-4/);
    expect(unresolved).toMatch(/Command and Control/);
    expect(unresolved).toMatch(/USPTO/);
    expect((text.match(/Unresolved/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('has the can / cannot establish box before the findings', () => {
    const box = text.indexOf('What the public record can establish');
    expect(box).toBeGreaterThan(0);
    expect(box).toBeLessThan(text.indexOf('Executive finding'));
    for (const item of ['Recognized revenue', 'Financial backlog', 'EBITDA', 'Transaction-specific eligibility consequences']) expect(text).toContain(item);
  });

  it('labels federal fact, derived measure, interpretation and company filing', () => {
    for (const label of ['Federal fact', 'Derived measure', 'Interpretation', 'Company filing']) expect(text).toContain(label);
  });

  it('references Research Standard v1', () => {
    expect(article).toContain('href="/research/standard"');
    expect(text).toContain('Research Standard v1');
  });
});

describe('Transaction Study 001 — indexing and layout', () => {
  it('a draft render is never indexable; the published render is', () => {
    expect(draftHtml).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(draftHtml).toContain('Draft for internal review');
    expect(html).toContain('<meta name="robots" content="index,follow">');
    expect(html).not.toContain('Draft for internal review');
    const preview = readFileSync(join(process.cwd(), 'scripts/render-halvik-study-preview.ts'), 'utf8');
    expect(preview).toContain('draft: true');
  });

  it('is built for phone width: viewport meta, scrollable tables, single-column breakpoints', () => {
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toMatch(/\.ts \.tablewrap\{overflow-x:auto/);
    const tables = article.match(/<table/g)?.length ?? 0;
    const wrapped = article.match(/<div class="tablewrap"><table/g)?.length ?? 0;
    expect(tables).toBeGreaterThan(0);
    expect(wrapped).toBe(tables);
    expect(html).toMatch(/@media \(max-width:600px\)\{[^}]*\.ts \.know\{grid-template-columns:1fr\}/);
  });

  it('canonical points at the permanent URL, which the registry serves', () => {
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL}">`);
    expect(publishedBySlug(HALVIK_STUDY_SLUG)?.url).toBe('/research/halvik-tetra-tech');
  });
});
