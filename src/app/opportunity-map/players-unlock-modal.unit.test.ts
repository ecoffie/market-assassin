/**
 * The Players gate is the FIRST PAYWALL MOMENT in the product, and first paywall moments are
 * remembered (Eric 2026-08-16). It must read as "here is what you are about to unlock", never
 * "you cannot have this".
 *
 * The gate SEQUENCE already shipped (#1153): the click is intercepted before any mode change, so
 * the visitor never sees a half-switched map or a 401. This is the VISUAL half — the part that
 * decides whether someone is just looking or joining.
 *
 * WHAT IT SHOWS: the seven things behind the wall, named as outcomes — Buying Offices,
 * Contracting Officers, Incumbents, Teaming Partners, Small Business Offices, Buyer DNA,
 * Industry Events — over a BLURRED preview, so the value is visible rather than described.
 *
 * OAUTH WITHOUT A SUPABASE CLIENT: the map is a hand-written HTML string with inline scripts, so
 * it cannot import signInWithGoogle/Microsoft. It does not need to — /app already reads ?next=,
 * threads it through OAuth to /app/onboarding?next=…, and onboarding routes back (its own comment
 * cites /opportunity-map). So the buttons are links into the EXISTING, working flow carrying the
 * full map URL. That is what makes "your current map will be waiting" literally true — filters,
 * lens and viewport all survive because the URL does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// login-modal.ts included: the sign-in modal moved out of route.ts (2026-08-23) so all
// eight Maps sub-routes could share one copy. The unlock contract is unchanged.
const map = [
  readFileSync(join(__dirname, 'route.ts'), 'utf8'),
  readFileSync(join(__dirname, 'login-modal.ts'), 'utf8'),
].join('\n');

describe('the unlock modal shows what is behind the wall', () => {
  it('names all seven unlocks as outcomes', () => {
    for (const f of ['Buying Offices', 'Contracting Officers', 'Incumbents', 'Teaming Partners',
                     'Small Business Offices', 'Buyer DNA', 'Industry Events']) {
      expect(map, `missing unlock: ${f}`).toContain(f);
    }
  });

  it('leads with the outcome, not the restriction', () => {
    expect(map).toContain('Meet the Buyers');
    // Nothing in the panel may read as a refusal.
    const panel = map.slice(map.indexOf('__playersUnlockHtml'), map.indexOf('__playersUnlockHtml') + 3000);
    expect(panel).not.toMatch(/you can(no|')t|not available|upgrade required/i);
  });

  it('blurs a real preview rather than describing one', () => {
    // Two halves, and both must be present: the CSS defines the blur, the HTML uses the class.
    // (An earlier version of this test looked for blur() INSIDE __playersUnlockHtml and failed —
    // the blur was always real, the assertion was in the wrong region.)
    expect(map).toMatch(/\.pu-blur\{[^}]*filter:blur\(/);
    const panel = map.slice(map.indexOf('window.__playersUnlockHtml'), map.indexOf('window.__playersUnlockHtml') + 3000);
    expect(panel).toContain('pu-blur');
    // It previews the SHAPE of a real record, not lorem text.
    expect(panel).toContain('Contracting Officer');
    // And it is decorative: hidden from assistive tech, not selectable or clickable.
    expect(panel).toContain('aria-hidden');
    expect(map).toMatch(/\.pu-blur\{[^}]*pointer-events:none/);
  });

  it('offers Google, Microsoft and Email', () => {
    const panel = map.slice(map.indexOf('__playersUnlockHtml'), map.indexOf('__playersUnlockHtml') + 3000);
    expect(panel).toContain('Continue with Google');
    expect(panel).toContain('Continue with Microsoft');
    expect(panel).toContain('Continue with Email');
  });

  it('carries the CURRENT map url through ?next= so the map really is waiting', () => {
    // The whole promise. A bare /app would drop filters, lens and viewport.
    const panel = map.slice(map.indexOf('window.__playersUnlockHtml'), map.indexOf('window.__playersUnlockHtml') + 3000);
    expect(panel).toMatch(/location\.pathname\s*\+\s*location\.search/);
    expect(panel).toContain('next=');
  });

  it('promises the map will be waiting', () => {
    expect(map).toContain('waiting when you return');
  });

  it('still never switches mode before auth (the #1153 invariant holds)', () => {
    const gate = map.slice(map.indexOf('window.__playersGate'), map.indexOf('window.__playersGate') + 2600);
    const afterLive = gate.slice(gate.indexOf('if(live)') + 'if(live)'.length);
    const signedOut = afterLive.slice(afterLive.indexOf('}') + 1);
    expect(signedOut.indexOf('openSignInModal')).toBeLessThan(signedOut.indexOf('setMapMode'));
  });
});
