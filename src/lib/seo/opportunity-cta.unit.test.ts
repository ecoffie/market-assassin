/**
 * GUARD — the /opportunity/[slug] CTA must not promise a free plan that no longer exists
 * (no free plan for new users since 2026-11-12, src/proxy.ts), and an open notice's CTA must
 * land on that notice on the public map instead of the /app sign-in wall.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { opportunityCta, opportunityMapHref, TRIAL_HREF } from './opportunity-cta';

const PAGE = readFileSync(join(process.cwd(), 'src/app/opportunity/[slug]/page.tsx'), 'utf8');
const ID = 'c924e1cd0f6a4b8e9d7a1b2c3d4e5f60';

describe('opportunityCta', () => {
  it('open notice → the map deep link for this notice, then the trial', () => {
    const c = opportunityCta({ noticeId: ID }, true);
    expect(c.primaryHref).toBe(`/opportunity-map?opp=${ID}`);
    expect(c.primaryLabel).toBe('See this notice on the opportunity map →');
    expect(c.secondaryHref).toBe('/pricing');
    expect(c.secondaryLabel).toContain('14-day free trial');
  });

  it('closed notice → the trial, with the alerts offer stated truthfully', () => {
    const c = opportunityCta({ noticeId: ID }, false);
    expect(c.primaryHref).toBe(TRIAL_HREF);
    expect(c.primaryLabel).toBe('Start your 14-day free trial →');
    expect(c.offerLine).toBe('Daily alerts come with Mindy Pro, which starts with a 14-day free trial.');
  });

  it('never promises a free plan and never points at /app or /app/signup', () => {
    for (const open of [true, false]) {
      const c = opportunityCta({ noticeId: ID }, open);
      const text = [c.primaryLabel, c.secondaryLabel, c.offerLine].filter(Boolean).join(' ');
      expect(text).not.toMatch(/track this free|free alerts|free daily alerts/i);
      for (const href of [c.primaryHref, c.secondaryHref].filter(Boolean) as string[]) {
        expect(href).not.toMatch(/^\/app(\/|$|\?)/);
      }
    }
  });

  it('encodes the notice id', () => {
    expect(opportunityMapHref('a b&c')).toBe('/opportunity-map?opp=a%20b%26c');
  });
});

describe('call site — /opportunity/[slug] page wires the CTA helper', () => {
  it('uses opportunityCta for the anonymous CTA', () => {
    expect(PAGE).toContain("from '@/lib/seo/opportunity-cta'");
    expect(PAGE).toMatch(/opportunityCta\(opp, isOpen\)/);
    expect(PAGE).toContain('href={cta.primaryHref}');
    expect(PAGE).toContain('{cta.primaryLabel}');
    expect(PAGE).toContain('{cta.offerLine}');
    expect(PAGE).toContain('cta.secondaryHref');
  });

  it('no longer carries the false free-plan copy or the signup/app-wall hrefs', () => {
    expect(PAGE).not.toContain('Track this free in Mindy');
    expect(PAGE).not.toContain('Get free alerts');
    expect(PAGE).not.toContain('Free daily alerts');
    expect(PAGE).not.toContain('href="/app/signup"');
    expect(PAGE).not.toMatch(/<Link\s+href="\/app"/);
  });
});
