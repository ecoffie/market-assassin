import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { TRIAL_CTA_LABEL } from './trial-cta';
import { LOGIN_MODAL_HTML } from '@/app/opportunity-map/login-modal';
import UnifiedPricing from '@/components/public-site/pricing/UnifiedPricing';
import { PRO_TRIAL_ANNUAL, TEAM_TRIAL_ANNUAL } from '@/components/public-site/pricing/app-plan-links';
import { MindySignupForm } from '@/components/mindy/MindySignupForm';

// There is no free plan for new users: every one of these CTAs lands on /pricing or a
// Stripe trial checkout, i.e. a card-required 14-day trial. "Start for free" over-promised.
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const dom = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('remaining /pricing CTAs use the trial label', () => {
  it('Opportunity Map sign-in modal: "New to Mindy?" link says the trial label and goes to /pricing', () => {
    const a = dom(LOGIN_MODAL_HTML).querySelector('#lgmCreate');
    expect(a?.getAttribute('href')).toBe('/pricing');
    expect(text(a)).toBe(TRIAL_CTA_LABEL);
    expect(LOGIN_MODAL_HTML).not.toContain('Start for free');
  });

  it('/pricing app tab: Pro and Teams trial cards say the trial label and link to the trial checkout', () => {
    const doc = dom(renderToStaticMarkup(
      <UnifiedPricing initialTab="app" proCredits={1500} teamCredits={7000} signupCredits={100} forecastsLabel="33,000+" faqs={[]} />,
    ));
    const links = [...doc.querySelectorAll('.plan a.cta')]; // plan cards, not the hero offer
    for (const href of [PRO_TRIAL_ANNUAL, TEAM_TRIAL_ANNUAL]) {
      const cta = links.find((a) => a.getAttribute('href') === href);
      expect(text(cta ?? null)).toContain(TRIAL_CTA_LABEL);
    }
    expect(doc.body.textContent).not.toContain('Start for free');
  });

  it('/mcp/pricing: no "Start for free" anywhere (closing CTA and recommended trial card)', () => {
    const html = renderToStaticMarkup(
      <UnifiedPricing initialTab="mcp" proCredits={1500} teamCredits={7000} signupCredits={100} forecastsLabel="33,000+" faqs={[]} />,
    );
    expect(html).not.toContain('Start for free');
    const src = read('src/components/public-site/pricing/UnifiedPricing.tsx');
    expect(src).not.toContain('Start for free');
    expect(src).toContain("href: '/pricing', cta: TRIAL_CTA_LABEL,");
    expect(src).toContain('<a className="cta light" href="/pricing">{TRIAL_CTA_LABEL}</a>');
  });

  it('Mindy signup form: the /pricing tab says the trial label', () => {
    const a = [...dom(renderToStaticMarkup(<MindySignupForm />)).querySelectorAll('a')].find(
      (x) => x.getAttribute('href') === '/pricing',
    );
    expect(text(a ?? null)).toBe(TRIAL_CTA_LABEL);
  });

  // Server components that need the DB (facet, agency) or client data (shared opp) can't
  // render here, so pin the call site: the constant is imported and wired into the CTA.
  it.each([
    ['src/components/seo/FacetPage.tsx', 1],
    ['src/app/agencies/page.tsx', 1],
    ['src/app/agencies/[slug]/page.tsx', 2],
    ['src/app/shared/opp/[shareId]/SharedOpportunityClient.tsx', 2],
    ['src/components/mindy/MindySignupForm.tsx', 1],
  ])('%s wires TRIAL_CTA_LABEL into its /pricing CTA (%i)', (file, uses) => {
    const src = read(file);
    expect(src).not.toMatch(/>\s*Start for free/);
    expect(src).toContain("import { TRIAL_CTA_LABEL } from '@/lib/public-site/trial-cta';");
    expect(src.match(/\{TRIAL_CTA_LABEL\}/g)?.length).toBe(uses);
  });
});
