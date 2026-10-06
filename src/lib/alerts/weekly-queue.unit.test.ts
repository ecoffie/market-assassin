import { describe, it, expect } from 'vitest';
import { prioritizeExplicitWeekly } from './weekly-queue';

const u = (e: string, f: string) => ({ user_email: e, alert_frequency: f });

describe('prioritizeExplicitWeekly', () => {
  it('moves explicit weekly subscribers ahead of the fallback audience, keeping each group in order', () => {
    const pending = [u('a@x', 'daily'), u('b@x', 'weekly'), u('c@x', 'weekdays'), u('z@x', 'weekly')];
    expect(prioritizeExplicitWeekly(pending).map((x) => x.user_email)).toEqual(['b@x', 'z@x', 'a@x', 'c@x']);
  });

  it('keeps every user exactly once and does not mutate the input', () => {
    const pending = [u('a@x', 'daily'), u('b@x', 'weekly')];
    const copy = [...pending];
    const out = prioritizeExplicitWeekly(pending);
    expect(out).toHaveLength(2);
    expect(pending).toEqual(copy);
  });
});
