import { describe, expect, it } from 'vitest';
import { eventPopupScript } from './event-popup';

describe('event pop-up script', () => {
  it('is empty after the event', () => {
    expect(eventPopupScript(new Date('2026-11-29T06:00:00Z'))).toBe('/* event over */');
  });
  it('before the event: parses, shows once per session (session cookie), links to the event page', () => {
    const src = eventPopupScript(new Date('2026-11-06T12:00:00Z'));
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('mindy_lcb_popup_s');
    expect(src).toContain('/lazy-contractors-blueprint');
    expect(src).toContain('Register free');
  });
});

describe('once per browsing session (2026-11-13)', () => {
  it('uses a session cookie (no expiry), not localStorage', () => {
    const src = eventPopupScript(new Date('2026-11-13T12:00:00Z'));
    expect(src).toContain('path=/; SameSite=Lax');
    expect(src).not.toMatch(/max-age|expires/i);
    expect(src).not.toContain('localStorage');
  });
});
