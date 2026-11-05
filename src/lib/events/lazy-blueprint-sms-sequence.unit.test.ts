import { describe, expect, it } from 'vitest';
import { LCB_SMS_STEPS, dueSmsSteps } from './lazy-blueprint-sms-sequence';

describe('Lazy Blueprint text sequence', () => {
  it('sends each step only inside its own window', () => {
    expect(dueSmsSteps(new Date('2026-11-20T16:00:00Z'))).toEqual([]);
    expect(dueSmsSteps(new Date('2026-11-21T16:05:00Z')).map((s) => s.id)).toEqual(['week']);
    expect(dueSmsSteps(new Date('2026-11-21T23:00:00Z'))).toEqual([]);
    expect(dueSmsSteps(new Date('2026-11-27T17:30:00Z')).map((s) => s.id)).toEqual(['day']);
    expect(dueSmsSteps(new Date('2026-11-28T15:50:00Z')).map((s) => s.id)).toEqual(['soon']);
    expect(dueSmsSteps(new Date('2026-11-28T16:02:00Z')).map((s) => s.id)).toEqual(['live']);
    expect(dueSmsSteps(new Date('2026-11-28T17:30:00Z'))).toEqual([]);
  });

  it('every text says how to opt out and uses the personal link when there is one', () => {
    for (const s of LCB_SMS_STEPS) expect(s.text('Ann', null)).toContain('Reply STOP to opt out.');
    const day = LCB_SMS_STEPS.find((s) => s.id === 'day')!;
    expect(day.text('Ann', 'https://zoom.us/w/1')).toContain('https://zoom.us/w/1');
    expect(day.text('Ann', null)).toContain('the link in your confirmation email');
  });
});
