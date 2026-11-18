// @vitest-environment jsdom
/** Free-member trial banner (owner, 2026-11-17): whole strip is one link, no close button. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import TrialOfferBanner, { TRIAL_BANNER_HREF } from './TrialOfferBanner';
import { CHECKOUT_PRODUCTS } from '@/lib/purchase-attribution';

const doc = new DOMParser().parseFromString(renderToStaticMarkup(<TrialOfferBanner />), 'text/html');
const page = readFileSync(join(__dirname, '..', '..', 'app', 'app', 'page.tsx'), 'utf8');

describe('trial banner', () => {
  it('the whole strip is one link to the existing Pro trial checkout', () => {
    const root = doc.body.firstElementChild!;
    expect(root.tagName).toBe('A');
    expect(root.getAttribute('href')).toBe(TRIAL_BANNER_HREF);
    expect(TRIAL_BANNER_HREF.startsWith('/checkout/mindy-pro-monthly?')).toBe(true);
    expect(CHECKOUT_PRODUCTS['mindy-pro-monthly']).toBeTruthy();
  });
  it('cannot be dismissed', () => {
    expect(doc.querySelector('button')).toBeNull();
  });
  it('shows only to free members once the tier is known, never to staff, above the top bar', () => {
    // Also never inside the Mindy phone app (src/app/app/phone).
    expect(page).toContain("{tierResolved && tier === 'free' && !isStaff && !inPhoneShell && <TrialOfferBanner />}");
    expect(page.indexOf('<TrialOfferBanner />')).toBeLessThan(page.indexOf('{/* Top Bar */}'));
  });
});
