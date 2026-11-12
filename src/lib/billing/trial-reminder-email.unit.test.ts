import { describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(), del: vi.fn() } }));
vi.mock('@/lib/send-email', () => ({ sendEmail: vi.fn() }));

import { renderTrialReminder, trialPlanLabel } from './trial-reminder-email';

describe('trial reminder email', () => {
  it('names the plan, the date and the first charge', () => {
    const m = renderTrialReminder({
      email: 'a@x.com', planLabel: 'Mindy Team', amountUsd: 4027, interval: 'year',
      trialEnd: new Date('2026-11-26T15:00:00Z'),
    });
    expect(m.subject).toBe('Your Mindy Team trial ends Thursday, November 26, 2026');
    expect(m.text).toContain('$4,027/yr');
    expect(m.html).toContain('Cancel before Thursday, November 26, 2026');
  });

  it('labels Team by tier or price, otherwise Pro', () => {
    expect(trialPlanLabel(undefined, 'team_annual')).toBe('Mindy Team');
    expect(trialPlanLabel('price_1Uaz3WK5zyiZ50PBKQY8W1WX', undefined)).toBe('Mindy Team');
    expect(trialPlanLabel('price_1TTYe9K5zyiZ50PBmJlUQuXQ', 'briefings')).toBe('Mindy Pro');
  });
});
