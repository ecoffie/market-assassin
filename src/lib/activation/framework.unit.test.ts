import { describe, it, expect } from 'vitest';
import {
  accountFacts, buildActivationReport, experienceOf, eraOf, groupMetrics, activationBaselineStart,
  type AccountActivity,
} from './framework';

const NOW = new Date('2026-11-14T12:00:00Z');
const d = (day: number, hour = 12) => new Date(Date.parse('2026-09-01T00:00:00Z') + day * 86_400_000 + hour * 3_600_000).toISOString();

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
