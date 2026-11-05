import { describe, expect, it } from 'vitest';
import { renderLazyBlueprintConfirmation, LAZY_BLUEPRINT_CALENDAR_DATES } from './lazy-blueprint-confirmation-email';

describe('Lazy Blueprint confirmation email', () => {
  it('confirms the seat with date, time, $50 and a calendar link', () => {
    const { subject, html, text } = renderLazyBlueprintConfirmation('Ann');
    expect(subject).toContain("The Lazy Contractor's Blueprint");
    expect(html).toContain('See you Nov 28, Ann!');
    expect(html).toContain('11:00 AM ET');
    expect(html).toContain('$50 in free Mindy credits');
    expect(html).toContain(LAZY_BLUEPRINT_CALENDAR_DATES);
    expect(text).toContain('Saturday, November 28, 2026 at 11:00 AM ET');
  });

  it('11 AM ET on Nov 28 (EST) is 16:00 UTC', () => {
    expect(LAZY_BLUEPRINT_CALENDAR_DATES.startsWith('20261128T160000Z')).toBe(true);
  });

  it('escapes the name', () => {
    expect(renderLazyBlueprintConfirmation('<b>x</b>').html).not.toContain('<b>x</b>');
  });
});
