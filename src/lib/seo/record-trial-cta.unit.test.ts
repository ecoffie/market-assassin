/**
 * GUARD — the office, recompete and forecast record pages must not promise a free account
 * (no free plan for new users since 2026-11-12, src/proxy.ts) and their buttons must link to the
 * trial on /pricing, not to /signup or /app/signup (which only redirect there).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordTrialHref, TRIAL_CTA_LABEL, TRIAL_HREF } from './record-trial-cta';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PAGES = {
  office: read('src/app/offices/[dodaac]/page.tsx'),
  recompete: read('src/app/recompetes/[slug]/page.tsx'),
  forecast: read('src/app/forecasts/[id]/page.tsx'),
};
/** Rendered strings only: drop block and line comments so doc comments may describe history. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('recordTrialHref', () => {
  it('points at /pricing with the attribution tags kept', () => {
    expect(TRIAL_HREF).toBe('/pricing');
    expect(recordTrialHref('seo_office', { office: 'FA2518' })).toBe('/pricing?src=seo_office&office=FA2518');
    expect(recordTrialHref('seo_forecast')).toBe('/pricing?src=seo_forecast');
  });
  it('the label names the real offer', () => {
    expect(TRIAL_CTA_LABEL).toBe('Start your 14-day free trial →');
  });
});

describe.each(Object.entries(PAGES))('%s page copy and wiring', (_name, src) => {
  const body = code(src);
  it('makes no free-account promise', () => {
    expect(body).not.toMatch(/free Mindy account/i);
    expect(body).not.toMatch(/sign up free/i);
    expect(body).not.toMatch(/free alerts/i);
    expect(body).not.toMatch(/\. Free\./);
    expect(body).not.toMatch(/ — free</);
    expect(body).not.toMatch(/recompete free/i);
  });
  it('never links to a sign-up URL that redirects to /pricing', () => {
    expect(body).not.toMatch(/href="\/(app\/)?signup"/);
    expect(body).not.toMatch(/`\/app\/signup/);
  });
  it('wires the shared trial link and label into the button', () => {
    expect(body).toContain("from '@/lib/seo/record-trial-cta'");
    expect(body).toMatch(/href=\{recordTrialHref\(/);
    expect(body).toContain('{TRIAL_CTA_LABEL}');
  });
});
