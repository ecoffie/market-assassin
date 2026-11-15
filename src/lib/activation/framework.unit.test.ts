import { describe, it, expect } from 'vitest';
import {
  accountFacts, buildActivationReport, experienceOf, eraOf, groupMetrics, activationBaselineStart,
  type AccountActivity,
} from './framework';

const NOW = new Date('2026-11-14T12:00:00Z');
const d = (day: number, hour = 12) => new Date(Date.parse('2026-10-01T00:00:00Z') + day * 86_400_000 + hour * 3_600_000).toISOString();

function acct(over: Partial<AccountActivity> = {}): AccountActivity {
  return {
    email: 'x@example.org', createdAt: d(0, 9), lastSignInAt: d(0, 9),
    appEvents: [], mcpCalls: [], emailClicks: [], emailOpens: [], tracked: [], watches: [], pursuitChanges: [],
    cardAnswers: [], paidAt: null, ...over,
  };
}

describe('segmentation never pools experiences or eras', () => {
  it('experience', () => {
    expect(experienceOf(acct({ appEvents: [{ at: d(0), openedOpportunity: false }] }))).toBe('native_app');
    expect(experienceOf(acct({ mcpCalls: [{ at: d(0), ok: true, rejectedNoCredits: false }] }))).toBe('mcp_only');
    expect(experienceOf(acct({ appEvents: [{ at: d(0), openedOpportunity: false }], mcpCalls: [{ at: d(0), ok: true, rejectedNoCredits: false }] }))).toBe('app_and_mcp');
    expect(experienceOf(acct({ emailOpens: [d(2)] }))).toBe('email_only');
    expect(experienceOf(acct())).toBe('no_activity');
  });

  it('era: everything is early_launch until a baseline exists', () => {
    expect(eraOf(acct(), null)).toBe('early_launch');
    expect(eraOf(acct(), new Date(d(-1)))).toBe('stabilized');
    expect(eraOf(acct(), new Date(d(5)))).toBe('early_launch');
    expect(activationBaselineStart({})).toBeNull();
    expect(activationBaselineStart({ ACTIVATION_BASELINE_START: 'not a date' })).toBeNull();
    expect(activationBaselineStart({ ACTIVATION_BASELINE_START: '2026-12-01T00:00:00Z' })?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('value stages are separate', () => {
  it('a click alone is first value only, not accumulated or return value', () => {
    const f = accountFacts(acct({ appEvents: [{ at: d(1), openedOpportunity: true }] }), NOW, null);
    expect(f.firstValue7d).toBe(true);
    expect(f.accumulated7d).toBe(false);
    expect(f.returnValue).toBe(false);
    expect(f.milestone).toBe(false);
  });

  it('a second visit alone is not value', () => {
    const f = accountFacts(acct({ appEvents: [{ at: d(0), openedOpportunity: false }, { at: d(3), openedOpportunity: false }] }), NOW, null);
    expect(f.secondDay7d).toBe(true);
    expect(f.accumulated7d).toBe(false);
    expect(f.milestone).toBe(false);
  });

  it('milestone = tracked within 7 days AND two active days within 7 days', () => {
    const f = accountFacts(acct({
      appEvents: [{ at: d(0), openedOpportunity: true }, { at: d(2), openedOpportunity: false }],
      tracked: [d(0, 10)],
    }), NOW, null);
    expect(f.tracked7d).toBe(true);
    expect(f.milestone).toBe(true);
    expect(f.hoursToFirstTracked).toBe(1);
  });

  it('tracking on day 9 does not count for the 7-day milestone', () => {
    const f = accountFacts(acct({ appEvents: [{ at: d(0), openedOpportunity: false }, { at: d(9), openedOpportunity: false }], tracked: [d(9)] }), NOW, null);
    expect(f.tracked7d).toBe(false);
    expect(f.everTracked).toBe(true);
  });

  it('return value needs a detected change AND a visit within 7 days after it', () => {
    const changed = { tracked: [d(0)], pursuitChanges: [d(10)] };
    expect(accountFacts(acct({ ...changed, emailClicks: [d(12)] }), NOW, null).returnValue).toBe(true);
    expect(accountFacts(acct({ ...changed, emailClicks: [d(20)] }), NOW, null).returnValue).toBe(false);
    expect(accountFacts(acct({ ...changed, emailClicks: [d(9)] }), NOW, null).returnValue).toBe(false);
    expect(accountFacts(acct({ tracked: [d(0)], emailClicks: [d(12)] }), NOW, null).returnValue).toBe(false);
  });

  it('a saved card answer is accumulated value; an unavailable source is unknown, not false', () => {
    expect(accountFacts(acct({ cardAnswers: [d(1)] }), NOW, null).accumulated7d).toBe(true);
    expect(accountFacts(acct({ cardAnswers: null }), NOW, null).cardAnswer7d).toBeNull();
  });
});

describe('honest denominators', () => {
  it('days 15-30 retention excludes accounts observed under 30 days', () => {
    const young = acct({ createdAt: '2026-11-01T09:00:00Z', appEvents: [{ at: '2026-11-03T00:00:00Z', openedOpportunity: false }] });
    const old = acct({ appEvents: [{ at: d(20), openedOpportunity: false }] });
    const g = groupMetrics([young, old].map((a) => accountFacts(a, NOW, null)));
    expect(g.retained15to30).toEqual({ n: 1, of: 1, rate: 100 });
  });

  it('accounts paying on day one are never counted as conversions', () => {
    const g = groupMetrics([
      accountFacts(acct({ paidAt: d(0, 10) }), NOW, null),
      accountFacts(acct({ paidAt: d(20) }), NOW, null),
      accountFacts(acct(), NOW, null),
    ]);
    expect(g.paidAtSignup).toBe(1);
    expect(g.paidAfterSignup).toEqual({ n: 1, of: 2, rate: 50 });
  });

  it('an empty group reports null rates, never 0%', () => {
    const g = groupMetrics([]);
    expect(g.milestone.rate).toBeNull();
    expect(g.retained15to30.rate).toBeNull();
    expect(g.medianHoursToFirstTracked).toBeNull();
  });

  it('card-chat rate is null when the source is unavailable', () => {
    expect(groupMetrics([accountFacts(acct({ cardAnswers: null }), NOW, null)]).cardAnswer7d).toBeNull();
  });

  it('credit wall: activity 7+ days after the first refusal', () => {
    const f = accountFacts(acct({ mcpCalls: [
      { at: d(2), ok: false, rejectedNoCredits: true },
      { at: d(12), ok: false, rejectedNoCredits: true },
    ] }), NOW, null);
    expect(f.hitCreditWall).toBe(true);
    expect(f.activeAfterWall7d).toBe(true);
  });
});

describe('report', () => {
  it('flags the missing baseline and keeps the stabilized era empty', () => {
    const r = buildActivationReport([acct(), acct({ email: 'y@example.org' })], { now: NOW, from: new Date(d(-10)), to: NOW, baselineStart: null });
    expect(r.baselineNotStarted).toBe(true);
    expect(r.byEra.early_launch.all.accounts).toBe(2);
    expect(r.byEra.stabilized.all.accounts).toBe(0);
    expect(r.byEra.early_launch.byExperience.no_activity.accounts).toBe(2);
  });
});

describe('mature windows (item 1)', () => {
  it('7-day rates exclude accounts younger than 7×24h and report them as immature', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    const young = acct({ createdAt: '2026-11-10T09:00:00Z', appEvents: [{ at: '2026-11-10T10:00:00Z', openedOpportunity: false }] });
    const oldOpened = acct({ appEvents: [{ at: d(1), openedOpportunity: true }], tracked: [d(1)] });
    const g = groupMetrics([young, oldOpened].map((a) => accountFacts(a, now, null)));
    expect(g.cohort.immature7d).toBe(1);
    expect(g.firstValue7d).toEqual({ n: 1, of: 1, rate: 100 });
    expect(g.tracked7d).toEqual({ n: 1, of: 1, rate: 100 });
    expect(g.signedIn.of).toBe(2); // not a windowed metric: every account
  });

  it('an account is mature at exactly 7×24h, not before', () => {
    const created = '2026-11-01T23:30:00Z';
    expect(accountFacts(acct({ createdAt: created }), new Date('2026-11-08T23:29:59Z'), null).mature7d).toBe(false);
    expect(accountFacts(acct({ createdAt: created }), new Date('2026-11-08T23:30:00Z'), null).mature7d).toBe(true);
  });

  it('the 7-day window is 7×24h from createdAt, not from UTC midnight (a late-evening signup gets no extra day)', () => {
    const created = '2026-10-01T23:30:00Z';
    // 7d 1h after signup: inside the old UTC-day window (day index 7), outside the exact one.
    const f = accountFacts(acct({ createdAt: created, tracked: ['2026-10-09T00:30:00Z'] }), NOW, null);
    expect(f.tracked7d).toBe(false);
    expect(accountFacts(acct({ createdAt: created, tracked: ['2026-10-08T23:29:00Z'] }), NOW, null).tracked7d).toBe(true);
    // Two events on two different UTC days but within the first 24h are ONE active day.
    const s = accountFacts(acct({ createdAt: created, appEvents: [{ at: '2026-10-01T23:40:00Z', openedOpportunity: false }, { at: '2026-10-02T10:00:00Z', openedOpportunity: false }] }), NOW, null);
    expect(s.secondDay7d).toBe(false);
  });

  it('days 15-30 need the whole window observed (31×24h)', () => {
    const created = '2026-10-14T13:00:00Z';
    expect(accountFacts(acct({ createdAt: created }), new Date('2026-11-14T12:59:00Z'), null).retained15to30).toBeNull();
    expect(accountFacts(acct({ createdAt: created }), new Date('2026-11-14T13:00:00Z'), null).retained15to30).toBe(false);
  });
});

describe('telemetry outage (item 7)', () => {
  it('a window overlapping 2026-08-21 → 2026-09-27T00:42:12Z is partial: excluded from engagement rates, counted', () => {
    const inOutage = acct({ createdAt: '2026-09-20T10:00:00Z' }); // 7d window ends 09-27T10:00, after outage end
    const after = acct({ createdAt: '2026-09-27T01:00:00Z', appEvents: [{ at: '2026-09-28T00:00:00Z', openedOpportunity: true }] });
    const fIn = accountFacts(inOutage, NOW, null);
    expect(fIn.telemetryGap7d).toBe(true);
    expect(fIn.telemetryCompleteSinceSignup).toBe(false);
    expect(accountFacts(after, NOW, null).telemetryGap7d).toBe(false);
    const g = groupMetrics([fIn, accountFacts(after, NOW, null)]);
    expect(g.cohort.telemetryGap7d).toBe(1);
    expect(g.firstValue7d).toEqual({ n: 1, of: 1, rate: 100 }); // not 50%
    expect(g.milestone.of).toBe(1);
    expect(g.tracked7d.of).toBe(2); // table-based: unaffected by the outage
    expect(g.returnValue.of).toBe(1);
  });

  it('days 15-30 overlapping the outage are left out of retention', () => {
    const f = accountFacts(acct({ createdAt: '2026-09-01T00:00:00Z', appEvents: [{ at: '2026-09-20T00:00:00Z', openedOpportunity: false }] }), NOW, null);
    expect(f.telemetryGap15to30).toBe(true);
    const g = groupMetrics([f]);
    expect(g.retained15to30.rate).toBeNull();
    expect(g.cohort.telemetryGap15to30).toBe(1);
  });
});

describe('tracking durability (item 7)', () => {
  it('a track event counts for ever/7-day tracked when the pipeline row was deleted, but never inflates counts', () => {
    const f = accountFacts(acct({ trackedEvents: [d(1)], appEvents: [{ at: d(1), openedOpportunity: false }, { at: d(3), openedOpportunity: false }] }), NOW, null);
    expect(f.everTracked).toBe(true);
    expect(f.tracked7d).toBe(true);
    expect(f.trackedCount7d).toBe(0);
    expect(f.milestone).toBe(true);
  });
});

describe('first meaningful search (item 5)', () => {
  const since = new Date(d(-1));
  it('results > 0 within 7 days; unknown before the count existed', () => {
    const hit = acct({ searches: [{ at: d(2), results: 12 }] });
    const zero = acct({ searches: [{ at: d(2), results: 0 }, { at: d(3), results: null }] });
    expect(accountFacts(hit, NOW, null, { searchMeasuredSince: since }).meaningfulSearch7d).toBe(true);
    expect(accountFacts(zero, NOW, null, { searchMeasuredSince: since }).meaningfulSearch7d).toBe(false);
    expect(accountFacts(hit, NOW, null, { searchMeasuredSince: new Date(d(5)) }).meaningfulSearch7d).toBeNull();
    expect(accountFacts(hit, NOW, null).meaningfulSearch7d).toBeNull();
    const g = groupMetrics([accountFacts(acct(), NOW, null)]);
    expect(g.meaningfulSearch7d).toBeNull(); // never 0% when nothing is measurable
  });
});

describe('Ask Mindy success (item 6)', () => {
  it('card or main chat; unknown when a source is unavailable and nothing was seen', () => {
    expect(accountFacts(acct({ mainChatAnswers: [d(1)] }), NOW, null).askMindy7d).toBe(true);
    expect(accountFacts(acct({ cardAnswers: null, mainChatAnswers: [d(1)] }), NOW, null).askMindy7d).toBe(true);
    expect(accountFacts(acct({ cardAnswers: [], mainChatAnswers: null }), NOW, null).askMindy7d).toBeNull();
    expect(accountFacts(acct({ cardAnswers: [], mainChatAnswers: [] }), NOW, null).askMindy7d).toBe(false);
    const g = groupMetrics([
      accountFacts(acct({ mainChatAnswers: [d(1)] }), NOW, null),
      accountFacts(acct({ mainChatAnswers: null }), NOW, null),
    ]);
    expect(g.askMindy7d).toEqual({ n: 1, of: 1, rate: 100 });
    expect(g.mainChatAnswer7d).toEqual({ n: 1, of: 1, rate: 100 });
  });
});
