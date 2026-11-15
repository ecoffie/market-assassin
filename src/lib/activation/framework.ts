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
 * Honesty rules: a rate with a zero denominator is null ("no data"), never 0%. A source that could not be read is
 * passed as null and its metric is reported unknown (null), never 0. Windows are measured from the account's own
 * createdAt in exact 24-hour steps (the "first 7 days" is [createdAt, createdAt + 7×24h), never a UTC calendar day),
 * and an account is only in a window's denominator once that window is FULLY observed:
 *   - 7-day metrics: only accounts at least 7×24h old (younger accounts are reported as `immature7d`).
 *   - Days 15-30: only accounts at least 31×24h old.
 * Telemetry outage: browser engagement events were dropped from 2026-08-21 to TELEMETRY_OUTAGE_END (beacon
 * transport lost auth, fixed by #1719). An account whose window overlaps the outage has an INCOMPLETE record, so it
 * is left out of every metric that reads engagement events and counted in `telemetryGap*` instead: its rate would
 * be a partial number, and a partial number reads as a low one.
 */

export const DAY_MS = 86_400_000;

/** Browser engagement telemetry was incomplete in this interval (see beacon-telemetry incident, fix #1719). */
export const TELEMETRY_OUTAGE_START = '2026-08-21T00:00:00Z';
export const TELEMETRY_OUTAGE_END = '2026-09-27T00:42:12Z';
const OUTAGE_START_MS = Date.parse(TELEMETRY_OUTAGE_START);
const OUTAGE_END_MS = Date.parse(TELEMETRY_OUTAGE_END);

export type Experience = 'mcp_only' | 'native_app' | 'app_and_mcp' | 'email_only' | 'no_activity';
export type Era = 'early_launch' | 'stabilized';

export interface AccountActivity {
  email: string;
  createdAt: string;
  /** First verified sign-in, if known. Null = never signed in (or unknown). */
  lastSignInAt: string | null;
  /**
   * In-app activity: user_engagement events that are not email opens/clicks (including in-app link clicks), plus
   * successful tool calls made by in-app Ask Mindy (mcp_call_log channel 'app_chat').
   * openedOpportunity marks listing/detail/card opens.
   */
  appEvents: { at: string; openedOpportunity: boolean }[];
  /** External MCP calls (Claude or ChatGPT; never in-app chat). rejectedNoCredits = refused for low balance. */
  mcpCalls: { at: string; ok: boolean; rejectedNoCredits: boolean; channel?: 'chatgpt' | 'claude' }[];
  /** Clicks on links in Mindy emails (tracked-link redirects only). */
  emailClicks: string[];
  emailOpens: string[];
  /**
   * Submitted Map searches that carry a result count (map_search with metadata.via). results null = unknown.
   * Searches recorded before the count existed are not here (see searchMeasuredSince).
   */
  searches?: { at: string; results: number | null }[];
  /** Opportunities tracked or saved (user_pipeline minus bulk imports + user_saved_opportunities), creation times. */
  tracked: string[];
  /**
   * Durable record of a track/save from engagement events (pursuit_started, save_to_pipeline). Survives a later
   * hard delete of the user_pipeline row. Used for "ever tracked" / "tracked within 7 days", never for counts
   * (the same act usually also has a table row).
   */
  trackedEvents?: string[];
  /** Saved searches / watches created. */
  watches: string[];
  /** Changes Mindy detected on this customer's tracked opportunities (pursuit_change_log.detected_at). */
  pursuitChanges: string[];
  /** Completed card-chat answers. Null = the source is unavailable (table not deployed or unreadable). */
  cardAnswers: string[] | null;
  /**
   * Successful main Ask Mindy answers (mindy_chat_messages: non-empty, finish_reason 'stop', not truncated, no
   * failed-tool notice). Null = the source is unavailable. Undefined is treated as unavailable.
   */
  mainChatAnswers?: string[] | null;
  /** First paid credit grant (Pro allowance, MCP subscription or top-up). */
  paidAt: string | null;
}

export interface Rate { n: number; of: number; rate: number | null }
const rate = (n: number, of: number): Rate => ({ n, of, rate: of > 0 ? Math.round((n / of) * 1000) / 10 : null });

const t = (iso: string) => Date.parse(iso);
/** 24-hour period since createdAt (0 = the first 24 hours). */
const dayIndex = (iso: string, startMs: number) => Math.floor((t(iso) - startMs) / DAY_MS);
/** Does [startMs + fromDay·24h, startMs + toDayExclusive·24h) overlap the telemetry outage? */
function overlapsOutage(startMs: number, fromDay: number, toDayExclusive: number): boolean {
  const a = startMs + fromDay * DAY_MS, b = startMs + toDayExclusive * DAY_MS;
  return a < OUTAGE_END_MS && b > OUTAGE_START_MS;
}

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

/** Active 24-hour periods relative to account creation (0 = first 24h). App events + successful MCP calls only. */
function activeDayIndexes(a: AccountActivity, startMs: number): Set<number> {
  const s = new Set<number>();
  for (const e of a.appEvents) s.add(dayIndex(e.at, startMs));
  for (const c of a.mcpCalls) if (c.ok) s.add(dayIndex(c.at, startMs));
  return s;
}

export interface AccountFacts {
  experience: Experience;
  era: Era;
  /** Whole 24-hour periods since createdAt. */
  observedDays: number;
  /** The first 7×24h are fully observed. */
  mature7d: boolean;
  /** The first 7×24h overlap the telemetry outage: engagement-based 7-day facts are incomplete. */
  telemetryGap7d: boolean;
  /** Days 15-30 overlap the telemetry outage. */
  telemetryGap15to30: boolean;
  /** Created after the outage ended: every engagement event since signup is on record. */
  telemetryCompleteSinceSignup: boolean;
  signedIn: boolean;
  firstValue7d: boolean;
  /** A submitted Map search with results > 0 within 7 days. Null = not measurable for this account. */
  meaningfulSearch7d: boolean | null;
  tracked7d: boolean;
  trackedCount7d: number;
  accumulated7d: boolean;
  cardAnswer7d: boolean | null;
  mainChatAnswer7d: boolean | null;
  /** A successful Ask Mindy answer (card or main chat) within 7 days. Null = unknown (a source unavailable, none seen). */
  askMindy7d: boolean | null;
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

export interface FactOptions {
  /** Earliest map_search that carries a result count. Accounts created before it cannot have a measured search. */
  searchMeasuredSince?: Date | null;
}

export function accountFacts(a: AccountActivity, now: Date, baselineStart: Date | null, opts: FactOptions = {}): AccountFacts {
  const start = t(a.createdAt);
  // Exact 24-hour windows from createdAt: [start + from·24h, start + (to+1)·24h).
  const within = (iso: string, from: number, to: number) => { const d = dayIndex(iso, start); return d >= from && d <= to; };
  const days = activeDayIndexes(a, start);
  const elapsed = now.getTime() - start;
  const observedDays = Math.floor(elapsed / DAY_MS);

  const tracked7 = a.tracked.filter((x) => within(x, 0, 6));
  const trackedEvents = a.trackedEvents ?? [];
  const trackedAny7 = tracked7.length > 0 || trackedEvents.some((x) => within(x, 0, 6));
  const firstTracked = [...a.tracked, ...trackedEvents].map(t).filter((x) => x >= start).sort((p, q) => p - q)[0];
  const cardAnswer7d = a.cardAnswers === null ? null : a.cardAnswers.some((x) => within(x, 0, 6));
  const mainChatAnswer7d = a.mainChatAnswers == null ? null : a.mainChatAnswers.some((x) => within(x, 0, 6));
  const askMindy7d = cardAnswer7d === true || mainChatAnswer7d === true ? true
    : cardAnswer7d === null || mainChatAnswer7d === null ? null : false;
  const secondDay7d = [...days].filter((d) => d >= 0 && d <= 6).length >= 2;

  const since = opts.searchMeasuredSince ?? null;
  const meaningfulSearch7d = since === null || start < since.getTime() ? null
    : (a.searches ?? []).some((x) => typeof x.results === 'number' && x.results > 0 && within(x.at, 0, 6));

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
    mature7d: elapsed >= 7 * DAY_MS,
    telemetryGap7d: overlapsOutage(start, 0, 7),
    telemetryGap15to30: overlapsOutage(start, 15, 31),
    telemetryCompleteSinceSignup: start >= OUTAGE_END_MS,
    signedIn: a.lastSignInAt !== null,
    firstValue7d: a.appEvents.some((e) => e.openedOpportunity && within(e.at, 0, 6)),
    meaningfulSearch7d,
    tracked7d: trackedAny7,
    trackedCount7d: tracked7.length,
    accumulated7d: trackedAny7 || a.watches.some((x) => within(x, 0, 6)) || cardAnswer7d === true,
    cardAnswer7d,
    mainChatAnswer7d,
    askMindy7d,
    everTracked: firstTracked !== undefined,
    hoursToFirstTracked: firstTracked !== undefined ? Math.round(((firstTracked - start) / 3_600_000) * 10) / 10 : null,
    secondDay7d,
    milestone: trackedAny7 && secondDay7d,
    returnValue,
    retained15to30: elapsed >= 31 * DAY_MS ? [...days].some((d) => d >= 15 && d <= 30) : null,
    paidAtSignup,
    paidAfterSignup: paidMs !== null && !paidAtSignup,
    hitCreditWall: firstWall !== undefined,
    activeAfterWall7d: firstWall !== undefined && lastActivity >= firstWall + 7 * DAY_MS,
  };
}

/**
 * Who is in which denominator. Every rate's `of` is one of these populations:
 *   all accounts ............. signedIn, everTracked, median hours, paid, credit wall
 *   mature7d ................. tracked7d, tracked3plus7d, accumulated7d, cardAnswer7d, mainChatAnswer7d, askMindy7d
 *   mature7d − telemetryGap7d  firstValue7d, secondDay7d, milestone, meaningfulSearch7d (when measurable)
 *   telemetryCompleteSinceSignup  returnValue
 *   observed30 − telemetryGap15to30  retained15to30 (milestone splits also exclude telemetryGap7d)
 */
export interface Cohort {
  accounts: number;
  /** Younger than 7×24h: no 7-day metric includes them yet. */
  immature7d: number;
  mature7d: number;
  /** Mature, but the first 7 days overlap the telemetry outage: left out of engagement-based 7-day rates. */
  telemetryGap7d: number;
  /** At least 31×24h old. */
  observed30: number;
  /** Observed 30+ days, but days 15-30 overlap the outage: left out of retention. */
  telemetryGap15to30: number;
  /** Created before the outage ended: left out of return value. */
  telemetryGapSinceSignup: number;
}

export interface GroupMetrics {
  accounts: number;
  cohort: Cohort;
  signedIn: Rate;
  firstValue7d: Rate;
  /** Submitted a Map search with results > 0 within 7 days. Null = no account in the group is measurable yet. */
  meaningfulSearch7d: Rate | null;
  accumulated7d: Rate;
  tracked7d: Rate;
  tracked3plus7d: Rate;
  /** Null when the card-chat source is unavailable. */
  cardAnswer7d: Rate | null;
  /** Null when the main-chat source is unavailable. */
  mainChatAnswer7d: Rate | null;
  /** Card or main chat. Accounts whose answer is unknown (a source unavailable, none seen) are left out. */
  askMindy7d: Rate | null;
  everTracked: Rate;
  medianHoursToFirstTracked: number | null;
  secondDay7d: Rate;
  milestone: Rate;
  returnValue: Rate;
  /** Only accounts fully observed through day 30, outside the outage, are in the denominator. */
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

/** Rate over the accounts whose value is known; null when the source is unavailable for every account. */
function knownRate(src: AccountFacts[], get: (f: AccountFacts) => boolean | null): Rate | null {
  const known = src.filter((f) => get(f) !== null);
  if (known.length === 0 && src.length > 0) return null;
  return rate(known.filter((f) => get(f) === true).length, known.length);
}

export function groupMetrics(facts: AccountFacts[]): GroupMetrics {
  const n = facts.length;
  const count = (f: (x: AccountFacts) => boolean, src = facts) => src.filter(f).length;
  const mature = facts.filter((f) => f.mature7d);
  const mature7Complete = mature.filter((f) => !f.telemetryGap7d);
  const observed30All = facts.filter((f) => f.retained15to30 !== null);
  const observed30 = observed30All.filter((f) => !f.telemetryGap15to30);
  const obsSplit = observed30.filter((f) => !f.telemetryGap7d);
  const obsMilestone = obsSplit.filter((f) => f.milestone);
  const obsNoMilestone = obsSplit.filter((f) => !f.milestone);
  const returnPop = facts.filter((f) => f.telemetryCompleteSinceSignup);
  const notPaidDay1 = facts.filter((f) => !f.paidAtSignup);
  const walled = facts.filter((f) => f.hitCreditWall);
  const searchKnown = mature7Complete.filter((f) => f.meaningfulSearch7d !== null);
  return {
    accounts: n,
    cohort: {
      accounts: n,
      immature7d: n - mature.length,
      mature7d: mature.length,
      telemetryGap7d: mature.length - mature7Complete.length,
      observed30: observed30All.length,
      telemetryGap15to30: observed30All.length - observed30.length,
      telemetryGapSinceSignup: n - returnPop.length,
    },
    signedIn: rate(count((f) => f.signedIn), n),
    firstValue7d: rate(count((f) => f.firstValue7d, mature7Complete), mature7Complete.length),
    meaningfulSearch7d: searchKnown.length === 0 ? null : rate(count((f) => f.meaningfulSearch7d === true, searchKnown), searchKnown.length),
    accumulated7d: rate(count((f) => f.accumulated7d, mature), mature.length),
    tracked7d: rate(count((f) => f.tracked7d, mature), mature.length),
    tracked3plus7d: rate(count((f) => f.trackedCount7d >= 3, mature), mature.length),
    cardAnswer7d: knownRate(mature, (f) => f.cardAnswer7d),
    mainChatAnswer7d: knownRate(mature, (f) => f.mainChatAnswer7d),
    askMindy7d: knownRate(mature, (f) => f.askMindy7d),
    everTracked: rate(count((f) => f.everTracked), n),
    medianHoursToFirstTracked: median(facts.map((f) => f.hoursToFirstTracked).filter((x): x is number => x !== null)),
    secondDay7d: rate(count((f) => f.secondDay7d, mature7Complete), mature7Complete.length),
    milestone: rate(count((f) => f.milestone, mature7Complete), mature7Complete.length),
    returnValue: rate(count((f) => f.returnValue, returnPop), returnPop.length),
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
  /** Earliest Map search carrying a result count; meaningful-search rates cover only accounts created after it. */
  searchMeasuredSince: string | null;
  telemetryOutage: { from: string; to: string };
  /** True until a baseline is set: no stabilized cohort exists and none may be reported. */
  baselineNotStarted: boolean;
  byEra: Record<Era, { all: GroupMetrics; byExperience: Record<Experience, GroupMetrics> }>;
}

const EXPERIENCES: Experience[] = ['native_app', 'app_and_mcp', 'mcp_only', 'email_only', 'no_activity'];

export function buildActivationReport(
  accounts: AccountActivity[],
  opts: { now: Date; from: Date; to: Date; baselineStart: Date | null; searchMeasuredSince?: Date | null },
): ActivationReport {
  const facts = accounts.map((a) => accountFacts(a, opts.now, opts.baselineStart, { searchMeasuredSince: opts.searchMeasuredSince ?? null }));
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
    searchMeasuredSince: opts.searchMeasuredSince ? opts.searchMeasuredSince.toISOString() : null,
    telemetryOutage: { from: TELEMETRY_OUTAGE_START, to: TELEMETRY_OUTAGE_END },
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
