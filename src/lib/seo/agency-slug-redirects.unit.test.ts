import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPublicAgencyBySlug } from './public-agency-pages';
import {
  AGENCY_SHORT_SLUGS,
  agencySlugRedirects,
  canonicalAgencySlug,
} from './agency-slug-redirects';

describe('short agency slugs redirect to the canonical page', () => {
  it('maps the four abbreviations customers type', () => {
    expect(canonicalAgencySlug('va')).toBe('department-of-veterans-affairs');
    expect(canonicalAgencySlug('VA')).toBe('department-of-veterans-affairs');
    expect(canonicalAgencySlug('cpsc')).toBe('consumer-product-safety-commission');
    expect(canonicalAgencySlug('fdic')).toBe('federal-deposit-insurance-corporation');
    expect(canonicalAgencySlug('treasury')).toBe('department-of-the-treasury');
  });

  it('does not redirect a canonical slug or an unknown token', () => {
    expect(canonicalAgencySlug('department-of-veterans-affairs')).toBeNull();
    expect(canonicalAgencySlug('not-a-real-agency')).toBeNull();
    expect(canonicalAgencySlug('')).toBeNull();
  });

  it('emits a permanent redirect for each short slug', () => {
    const redirects = agencySlugRedirects();
    expect(redirects).toHaveLength(Object.keys(AGENCY_SHORT_SLUGS).length);
    expect(redirects.every((r) => r.permanent)).toBe(true);
    expect(redirects.map((r) => r.source)).toEqual([
      '/agencies/va',
      '/agencies/cpsc',
      '/agencies/fdic',
      '/agencies/treasury',
    ]);
    for (const canonical of Object.values(AGENCY_SHORT_SLUGS)) {
      expect(getPublicAgencyBySlug(canonical)?.slug).toBe(canonical);
    }
  });

  it('is wired into next.config and the agency page', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    const page = readFileSync(join(process.cwd(), 'src/app/agencies/[slug]/page.tsx'), 'utf8');
    expect(config).toContain('agencySlugRedirects()');
    expect(page).toContain('canonicalAgencySlug(slug)');
    expect(page).toContain('permanentRedirect(`/agencies/${canonical}`)');
  });
});
