/** The page's calendar buttons must match the confirmation email: Nov 28, 11 AM–3 PM ET (16:00–20:00 UTC). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAZY_BLUEPRINT_CALENDAR_DATES } from '@/lib/events/lazy-blueprint-confirmation-email';

describe('Mindy Day calendar window', () => {
  const form = readFileSync('src/app/lazy-contractors-blueprint/RegistrationForm.tsx', 'utf8');
  it('Google Calendar button uses the same window as the email', () => {
    expect(LAZY_BLUEPRINT_CALENDAR_DATES).toBe('20261128T160000Z/20261128T200000Z');
    expect(form).toContain(`&dates=${LAZY_BLUEPRINT_CALENDAR_DATES}&`);
  });
  it('Outlook / Apple (.ics) ends at 3 PM ET', () => {
    expect(form).toContain("'DTSTART:20261128T160000Z', 'DTEND:20261128T200000Z'");
    expect(form).not.toContain('T180000Z');
  });
});
