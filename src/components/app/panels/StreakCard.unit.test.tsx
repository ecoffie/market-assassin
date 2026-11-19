// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StreakView } from './StreakCard';

const ok = (over = {}) => ({ status: 'ok' as const, streak: 6, longest: 9, countedToday: true, rewardedToday: 0, next: { inDays: 1, credits: 25 }, ...over });

describe('StreakView', () => {
  it('shows the streak and the next reward', () => {
    const html = renderToStaticMarkup(<StreakView data={ok()} />);
    expect(html).toContain('6 days in a row');
    expect(html).toContain('Come back tomorrow');
    expect(html).toContain('+25 credits');
  });
  it("shows today's reward when one was paid", () => {
    expect(renderToStaticMarkup(<StreakView data={ok({ streak: 7, rewardedToday: 25 })} />)).toContain('+25 credits added for your 7-day streak');
  });
  it('free members see the streak and that credits are a Pro reward', () => {
    const html = renderToStaticMarkup(<StreakView data={ok({ creditsEligible: false })} />);
    expect(html).toContain('6 days in a row');
    expect(html).toContain('Pro members earn');
    expect(html).not.toContain('Come back tomorrow');
  });
  it('renders nothing when the streak cannot be read', () => {
    expect(renderToStaticMarkup(<StreakView data={{ status: 'unavailable' }} />)).toBe('');
    expect(renderToStaticMarkup(<StreakView data={null} />)).toBe('');
  });
});
