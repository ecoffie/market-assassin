import { describe, it, expect } from 'vitest';
import {
  sessionise, deriveVisitWindow, describeGap,
  SESSION_GAP_MS, MIN_RETURN_GAP_MS,
} from './last-visit';

const T0 = Date.parse('2026-09-15T12:00:00.000Z');
const at = (ms: number) => ({ created_at: new Date(T0 + ms).toISOString() });
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('sessionise', () => {
  it('groups events inside the gap into ONE visit', () => {
    const s = sessionise([at(0), at(5 * MIN), at(20 * MIN)]);
    expect(s).toHaveLength(1);
    expect(s[0].count).toBe(3);
  });

  it('splits on a gap LONGER than the threshold', () => {
    const s = sessionise([at(0), at(SESSION_GAP_MS + 1), at(SESSION_GAP_MS + MIN)]);
    expect(s).toHaveLength(2);
    expect(s[0].count).toBe(1);
    expect(s[1].count).toBe(2);
  });

  it('a gap EXACTLY at the threshold stays in the same visit (boundary is >)', () => {
    expect(sessionise([at(0), at(SESSION_GAP_MS)])).toHaveLength(1);
  });

  it('does not trust the caller to have sorted the rows', () => {
    const s = sessionise([at(2 * DAY), at(0), at(DAY)]);
    expect(s).toHaveLength(3);
    expect(Date.parse(s[0].startedAt)).toBeLessThan(Date.parse(s[1].startedAt));
  });

  it('DROPS an unparseable timestamp rather than coercing it to epoch 0', () => {
    // A single bad row coerced to 1970 would fabricate a 56-year-old "last visit" and
    // make the entire corpus look new.
    const s = sessionise([{ created_at: 'not-a-date' }, at(0), at(MIN)]);
    expect(s).toHaveLength(1);
    expect(s[0].count).toBe(2);
  });

  it('returns [] for no events (never a phantom session)', () => {
    expect(sessionise([])).toEqual([]);
  });
});

describe('deriveVisitWindow', () => {
  it('a genuine return: window spans the previous visit end to the current visit start', () => {
    const now = T0 + 2 * DAY;
    const w = deriveVisitWindow(
      [at(0), at(10 * MIN), at(2 * DAY - MIN), at(2 * DAY)],
      now,
    );
    expect(w.isReturn).toBe(true);
    expect(w.lastVisitAt).toBe(new Date(T0 + 10 * MIN).toISOString());
    expect(w.returnStartedAt).toBe(new Date(T0 + 2 * DAY - MIN).toISOString());
    expect(w.reason).toBe('return');
  });

  it('a FIRST visit is not a return', () => {
    const w = deriveVisitWindow([at(0), at(MIN)], T0 + 2 * MIN);
    expect(w.isReturn).toBe(false);
    expect(w.reason).toBe('first_visit');
    expect(w.lastVisitAt).toBeNull();
  });

  it('no events at all is not a return', () => {
    expect(deriveVisitWindow([], T0).reason).toBe('no_events');
  });

  it('a SHORT gap is refused — "since your last visit" must mean time passed', () => {
    const now = T0 + 2 * HOUR;
    const w = deriveVisitWindow([at(0), at(2 * HOUR - MIN), at(2 * HOUR)], now);
    expect(w.isReturn).toBe(false);
    expect(w.reason).toBe('gap_too_short');
    // and critically: it does NOT hand back a window with nothing in it, which would
    // render "nothing changed" for a 2-hour coffee break.
    expect(w.lastVisitAt).toBeNull();
  });

  it('a gap exactly at MIN_RETURN_GAP_MS qualifies', () => {
    const t1 = MIN_RETURN_GAP_MS;
    const w = deriveVisitWindow([at(0), at(t1), at(t1 + MIN)], T0 + t1 + 2 * MIN);
    expect(w.isReturn).toBe(true);
    expect(w.gapMs).toBe(MIN_RETURN_GAP_MS);
  });

  it('a visitor whose page has NOT yet written an event still gets a window', () => {
    // The map calls this on load, often before its own first telemetry row lands. The
    // last stored session is then the PREVIOUS visit and `now` opens the current one.
    const now = T0 + 3 * DAY;
    const w = deriveVisitWindow([at(0), at(5 * MIN)], now);
    expect(w.isReturn).toBe(true);
    expect(w.lastVisitAt).toBe(new Date(T0 + 5 * MIN).toISOString());
    expect(w.returnStartedAt).toBe(new Date(now).toISOString());
  });

  it('ignores events stamped in the FUTURE (a window may not start after it ends)', () => {
    const now = T0 + DAY;
    const w = deriveVisitWindow([at(0), at(DAY), at(DAY + HOUR)], now);
    expect(w.isReturn).toBe(true);
    expect(Date.parse(w.lastVisitAt!)).toBeLessThanOrEqual(now);
    expect(Date.parse(w.returnStartedAt!)).toBeLessThanOrEqual(now);
  });

  it('three visits: the window is the MOST RECENT gap, not the oldest', () => {
    const now = T0 + 10 * DAY;
    const w = deriveVisitWindow([at(0), at(4 * DAY), at(10 * DAY)], now);
    expect(w.lastVisitAt).toBe(new Date(T0 + 4 * DAY).toISOString());
  });
});

describe('describeGap', () => {
  it.each([
    [3 * HOUR, 'earlier today'],
    [30 * HOUR, 'yesterday'],
    [3 * DAY, '3 days ago'],
    [10 * DAY, 'last week'],
    [20 * DAY, '2 weeks ago'],
    [70 * DAY, '2 months ago'],
  ])('%s ms -> %s', (ms, label) => {
    expect(describeGap(ms as number)).toBe(label);
  });

  it('is empty for an absent or nonsensical gap — never "0 days ago"', () => {
    expect(describeGap(null)).toBe('');
    expect(describeGap(-1)).toBe('');
    expect(describeGap(Number.NaN)).toBe('');
  });
});
