/**
 * Activation framework: pure computation (activation Phase 1, approved by Eric 2026-11-14).
 *
 * Working hypothesis, NOT a proven cause: "track at least one real opportunity in the first seven days and
 * return on a second day". Three value stages are measured separately, and every one is a PROXY because Mindy
 * cannot yet observe whether a result was genuinely relevant:
 *   - FIRST VALUE (proxy)        opened at least one opportunity within 7 days. Opening is not proof of relevance.
 *   - ACCUMULATED VALUE (proxy)  kept work in Mindy within 7 days: tracked/saved an opportunity, created a watch,
 *                                or received a saved card-chat answer.
 *   - RETURN VALUE (proxy)       Mindy detected a change on something the customer tracks AND the customer came
 *                                back (in the app or through a Mindy email) within 7 days of that change.
 * A second-day return is reported on its own and is never treated as value or as durable retention.
 *
 * Cohorts are never pooled across product eras or experiences:
 *   - era:        'early_launch' (created before the stabilization baseline) vs 'stabilized' (on/after it).
 *                 The baseline is unset until Eric declares "Mindy Stabilization Complete", so every account is
 *                 early_launch today and no stabilized number exists yet.
 *   - experience: mcp_only · native_app · app_and_mcp · email_only (registered, only reads Mindy email) · no_activity.
 *
 * Honesty rules: a rate with a zero denominator is null ("no data"), never 0%. Day 15-30 retention is computed
 * only for accounts observed for at least 30 days. A source that could not be read is passed as null and its
 * metric is reported unknown (null), never 0.
 */

export const DAY_MS = 86_400_000;

export type Experience = 'mcp_only' | 'native_app' | 'app_and_mcp' | 'email_only' | 'no_activity';
export type Era = 'early_launch' | 'stabilized';

export interface AccountActivity {
  email: string;
  createdAt: string;
  /** First verified sign-in, if known. Null = never signed in (or unknown). */
  lastSignInAt: string | null;
  /** In-app events (user_engagement, excluding email opens/clicks). openedOpportunity marks listing/detail opens. */
  appEvents: { at: string; openedOpportunity: boolean }[];
  /** MCP calls. rejectedNoCredits = refused because the balance was too low. */
  mcpCalls: { at: string; ok: boolean; rejectedNoCredits: boolean }[];
  emailClicks: string[];
  emailOpens: string[];
  /** Opportunities tracked or saved (user_pipeline + user_saved_opportunities), creation times. */
  tracked: string[];
  /** Saved searches / watches created. */
  watches: string[];
  /** Changes Mindy detected on this customer's tracked opportunities (pursuit_change_log.detected_at). */
  pursuitChanges: string[];
  /** Completed card-chat answers. Null = the source is unavailable (table not deployed or unreadable). */
  cardAnswers: string[] | null;
  /** First paid credit grant (Pro allowance, MCP subscription or top-up). */
  paidAt: string | null;
}

export interface Rate { n: number; of: number; rate: number | null }
const rate = (n: number, of: number): Rate => ({ n, of, rate: of > 0 ? Math.round((n / of) * 1000) / 10 : null });

const t = (iso: string) => Date.parse(iso);
const dayIndex = (iso: string, startMs: number) => Math.floor((t(iso) - startMs) / DAY_MS);

export function experienceOf(a: AccountActivity): Experience {
  const app = a.appEvents.length > 0;
  const mcp = a.mcpCalls.length > 0;
  if (app && mcp) return 'app_and_mcp';
  if (app) return 'native_app';
  if (mcp) return 'mcp_only';
  if (a.emailOpens.length > 0 || a.emailClicks.length > 0) return 'email_only';
  return 'no_activity';
}

export function eraOf(a: AccountActivity, baselineStart: Date | null): Era {
  return baselineStart && t(a.createdAt) >= baselineStart.getTime() ? 'stabilized' : 'early_launch';
}

/** Active days relative to account creation (0 = signup day). App events + successful MCP calls only. */
function activeDayIndexes(a: AccountActivity, startMs: number): Set<number> {
  const s = new Set<number>();
  for (const e of a.appEvents) s.add(dayIndex(e.at, startMs));
  for (const c of a.mcpCalls) if (c.ok) s.add(dayIndex(c.at, startMs));
  return s;
}

export interface AccountFacts {
  experience: Experience;
  era: Era;
  observedDays: number;
  signedIn: boolean;
  firstValue7d: boolean;
  tracked7d: boolean;
  trackedCount7d: number;
  accumulated7d: boolean;
  cardAnswer7d: boolean | null;
  everTracked: boolean;
  hoursToFirstTracked: number | null;
  secondDay7d: boolean;
  milestone: boolean;
  returnValue: boolean;
  retained15to30: boolean | null;
  paidAtSignup: boolean;
  paidAfterSignup: boolean;
  hitCreditWall: boolean;
  activeAfterWall7d: boolean;
}

export function accountFacts(a: AccountActivity, now: Date, baselineStart: Date | null): AccountFacts {
  const start = t(a.createdAt);
  const startDay = start - (start % DAY_MS); // UTC day boundary of signup
  const within = (iso: string, from: number, to: number) => { const d = dayIndex(iso, startDay); return d >= from && d <= to; };
  const days = activeDayIndexes(a, startDay);
  const observedDays = Math.floor((now.getTime() - startDay) / DAY_MS);

  const tracked7 = a.tracked.filter((x) => within(x, 0, 7));
  const firstTracked = a.tracked.map(t).filter((x) => x >= start).sort((p, q) => p - q)[0];
  const cardAnswer7d = a.cardAnswers === null ? null : a.cardAnswers.some((x) => within(x, 0, 7));
  const secondDay7d = [...days].filter((d) => d >= 0 && d <= 7).length >= 2;

  // Return value: a detected change on tracked work, followed by a visit (app day or email click) within 7 days.
  const visits = [...a.appEvents.map((e) => t(e.at)), ...a.emailClicks.map(t), ...a.mcpCalls.filter((c) => c.ok).map((c) => t(c.at))];
  const returnValue = a.pursuitChanges.some((c) => {
    const cm = t(c);
    return visits.some((v) => v >= cm && v - cm <= 7 * DAY_MS);
  });

  const paidMs = a.paidAt ? t(a.paidAt) : null;
  const paidAtSignup = paidMs !== null && paidMs - start <= DAY_MS;
  const rejections = a.mcpCalls.filter((c) => c.rejectedNoCredits).map((c) => t(c.at)).sort((p, q) => p - q);
  const firstWall = rejections[0];
  const lastActivity = Math.max(...visits, ...a.mcpCalls.map((c) => t(c.at)), -Infinity);

  return {
    experience: experienceOf(a),
    era: eraOf(a, baselineStart),
    observedDays,
    signedIn: a.lastSignInAt !== null,
    firstValue7d: a.appEvents.some((e) => e.openedOpportunity && within(e.at, 0, 7)),
    tracked7d: tracked7.length > 0,
    trackedCount7d: tracked7.length,
    accumulated7d: tracked7.length > 0 || a.watches.some((x) => within(x, 0, 7)) || cardAnswer7d === true,
    cardAnswer7d,
    everTracked: firstTracked !== undefined,
    hoursToFirstTracked: firstTracked !== undefined ? Math.round(((firstTracked - start) / 3_600_000) * 10) / 10 : null,
    secondDay7d,
    milestone: tracked7.length > 0 && secondDay7d,
    returnValue,
    retained15to30: observedDays >= 30 ? [...days].some((d) => d >= 15 && d <= 30) : null,
    paidAtSignup,
    paidAfterSignup: paidMs !== null && !paidAtSignup,
    hitCreditWall: firstWall !== undefined,
    activeAfterWall7d: firstWall !== undefined && lastActivity >= firstWall + 7 * DAY_MS,
  };
}

export interface GroupMetrics {
  accounts: number;
  signedIn: Rate;
  firstValue7d: Rate;
  accumulated7d: Rate;
  tracked7d: Rate;
  tracked3plus7d: Rate;
  /** Null when the card-chat source is unavailable. */
  cardAnswer7d: Rate | null;
  everTracked: Rate;
  medianHoursToFirstTracked: number | null;
  secondDay7d: Rate;
  milestone: Rate;
  returnValue: Rate;
  /** Only accounts observed 30+ days are in the denominator. */
  retained15to30: Rate;
  retained15to30Milestone: Rate;
  retained15to30NoMilestone: Rate;
  paidAtSignup: number;
  /** Excludes accounts that were already paying on day one (those cannot be conversions). */
  paidAfterSignup: Rate;
  hitCreditWall: Rate;
  activeAfterWall7d: Rate;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}

export function groupMetrics(facts: AccountFacts[]): GroupMetrics {
  const n = facts.length;
  const count = (f: (x: AccountFacts) => boolean, src = facts) => src.filter(f).length;
  const observed30 = facts.filter((f) => f.retained15to30 !== null);
  const obsMilestone = observed30.filter((f) => f.milestone);
  const obsNoMilestone = observed30.filter((f) => !f.milestone);
  const cardKnown = facts.filter((f) => f.cardAnswer7d !== null);
  const notPaidDay1 = facts.filter((f) => !f.paidAtSignup);
  const walled = facts.filter((f) => f.hitCreditWall);
  return {
    accounts: n,
    signedIn: rate(count((f) => f.signedIn), n),
    firstValue7d: rate(count((f) => f.firstValue7d), n),
    accumulated7d: rate(count((f) => f.accumulated7d), n),
    tracked7d: rate(count((f) => f.tracked7d), n),
    tracked3plus7d: rate(count((f) => f.trackedCount7d >= 3), n),
    cardAnswer7d: cardKnown.length === 0 && n > 0 ? null : rate(count((f) => f.cardAnswer7d === true, cardKnown), cardKnown.length),
    everTracked: rate(count((f) => f.everTracked), n),
    medianHoursToFirstTracked: median(facts.map((f) => f.hoursToFirstTracked).filter((x): x is number => x !== null)),
    secondDay7d: rate(count((f) => f.secondDay7d), n),
    milestone: rate(count((f) => f.milestone), n),
    returnValue: rate(count((f) => f.returnValue), n),
    retained15to30: rate(count((f) => f.retained15to30 === true, observed30), observed30.length),
    retained15to30Milestone: rate(count((f) => f.retained15to30 === true, obsMilestone), obsMilestone.length),
    retained15to30NoMilestone: rate(count((f) => f.retained15to30 === true, obsNoMilestone), obsNoMilestone.length),
    paidAtSignup: count((f) => f.paidAtSignup),
    paidAfterSignup: rate(count((f) => f.paidAfterSignup, notPaidDay1), notPaidDay1.length),
    hitCreditWall: rate(walled.length, n),
    activeAfterWall7d: rate(count((f) => f.activeAfterWall7d, walled), walled.length),
  };
}

export interface ActivationReport {
  generatedAt: string;
  window: { from: string; to: string };
  baselineStart: string | null;
  /** True until a baseline is set: no stabilized cohort exists and none may be reported. */
  baselineNotStarted: boolean;
  byEra: Record<Era, { all: GroupMetrics; byExperience: Record<Experience, GroupMetrics> }>;
}

const EXPERIENCES: Experience[] = ['native_app', 'app_and_mcp', 'mcp_only', 'email_only', 'no_activity'];

export function buildActivationReport(
  accounts: AccountActivity[],
  opts: { now: Date; from: Date; to: Date; baselineStart: Date | null },
): ActivationReport {
  const facts = accounts.map((a) => accountFacts(a, opts.now, opts.baselineStart));
  const byEra = {} as ActivationReport['byEra'];
  for (const era of ['early_launch', 'stabilized'] as Era[]) {
    const inEra = facts.filter((f) => f.era === era);
    const byExperience = {} as Record<Experience, GroupMetrics>;
    for (const x of EXPERIENCES) byExperience[x] = groupMetrics(inEra.filter((f) => f.experience === x));
    byEra[era] = { all: groupMetrics(inEra), byExperience };
  }
  return {
    generatedAt: opts.now.toISOString(),
    window: { from: opts.from.toISOString(), to: opts.to.toISOString() },
    baselineStart: opts.baselineStart ? opts.baselineStart.toISOString() : null,
    baselineNotStarted: opts.baselineStart === null,
    byEra,
  };
}

/** The stabilization baseline from the environment. Unset or invalid = not started. */
export function activationBaselineStart(env: Record<string, string | undefined> = process.env): Date | null {
  const raw = (env.ACTIVATION_BASELINE_START || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms) : null;
}
