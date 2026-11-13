import { describe, expect, it } from 'vitest';
import { renderLazyBlueprintConfirmation, LAZY_BLUEPRINT_CALENDAR_DATES } from './lazy-blueprint-confirmation-email';

describe('Lazy Blueprint confirmation email', () => {
  it('confirms the seat with date, time, the free credits and a calendar link', () => {
    const { subject, html, text } = renderLazyBlueprintConfirmation('Ann');
    expect(subject).toContain("The Lazy Contractor's Blueprint");
    expect(html).toContain('See you Nov 28, Ann!');
    expect(html).toContain('11:00 AM ET');
    expect(html).toContain('1,000 free Mindy credits');
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

describe('Lazy Blueprint confirmation email with a personal Zoom link', () => {
  it('shows the join button and the link in the text version', () => {
    const { html, text } = renderLazyBlueprintConfirmation('Ann', 'https://us06web.zoom.us/w/123?tk=abc');
    expect(html).toContain('href="https://us06web.zoom.us/w/123?tk=abc"');
    expect(html).toContain('Join the live event');
    expect(text).toContain('https://us06web.zoom.us/w/123?tk=abc');
    expect(renderLazyBlueprintConfirmation('Ann').html).not.toContain('Join the live event');
  });
});

describe('Lazy Blueprint confirmation email room note', () => {
  it('tells people the room size and to join early', () => {
    const { html, text } = renderLazyBlueprintConfirmation('Ann', 'https://us06web.zoom.us/w/1');
    expect(html).toContain('The room seats 500. Join 10 minutes early.');
    expect(text).toContain('join 10 minutes early');
  });
});

import { lazyBlueprintWelcomeSms } from './lazy-blueprint-confirmation-email';
describe('Lazy Blueprint welcome text', () => {
  it('names the person, the date and time, and says how to opt out, in two segments or less', () => {
    const t = lazyBlueprintWelcomeSms('Ann');
    expect(t).toContain("You're in, Ann!");
    expect(t).toContain('Sat Nov 28 at 11:00 AM ET');
    expect(t).toContain('Reply STOP to opt out.');
    expect(t.length).toBeLessThanOrEqual(306);
  });
});
