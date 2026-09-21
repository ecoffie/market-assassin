/**
 * Deterministic beginner dictionaries.
 *
 * One module — do not scatter set-aside / notice / date / dollar mappings
 * across React components. Expert views keep using classifyNoticeType /
 * SET_GROUPS; this layer is the beginner-safe overlay on the SAME source values.
 *
 * SAM set-aside codes actually seen on sam_opportunities (tier1-tools.ts,
 * measured live 2026-07-17):
 *   SBA, SBP, NONE, SDVOSBC, SDVOSBS, WOSB, WOSBSS, EDWOSB,
 *   8A, 8AN, HZC, HZS, VSA, VSS, ISBEE, IEE, BICiv, LAS
 *
 * SAM notice_type values (SAM dropdown + classifyNoticeType):
 *   Special Notice · Sources Sought · Presolicitation ·
 *   Consolidate/(Substantially) Bundle · Solicitation ·
 *   Combined Synopsis/Solicitation · Award Notice · Justification ·
 *   Sale of Surplus Property · Intent to Bundle Requirements (DoD-Funded)
 *
 * search_sam_opportunities returns `set_aside` = set_aside_description
 * (e.g. "8a Competed", "Total Small Business Set-Aside (FAR 19.5)",
 * "No Set aside used") and `type` = notice_type. It does NOT return
 * amount, PSC, or set_aside_code.
 */

import { classifyNoticeType } from '@/lib/utils/notice-type';
import type { EligibilityEvidence, EligibilityProgram } from './types';

export type SetAsideKind =
  | 'not_stated'
  | 'open'
  | 'sb'
  | '8a'
  | 'wosb'
  | 'edwosb'
  | 'sdvosb'
  | 'hubzone'
  | 'vosb'
  | 'other'
  | 'unknown';

export interface SetAsideCopy {
  kind: SetAsideKind;
  /** Short beginner label, or null when we should omit the row. */
  label: string | null;
  explanation: string | null;
  audience: string | null;
  /** Program this reservation corresponds to, if any. */
  program: EligibilityProgram | null;
}

const SET_ASIDE_COPY: Record<Exclude<SetAsideKind, 'unknown' | 'other'>, SetAsideCopy> = {
  /**
   * The record says nothing. MEASURED 2026-09-21: 4,261 of 9,030 active open
   * notices (47.2%) have NO set_aside_description AND no set_aside_code — and
   * every one of them used to render "Any business that can do the work".
   * That is a confident eligibility read produced from an absent field, on
   * nearly half the corpus. Absent is not unrestricted.
   */
  not_stated: {
    kind: 'not_stated',
    label: 'Set-aside not listed',
    explanation: 'This notice does not say whether the work is set aside. Check the SAM listing.',
    audience: "Who it's for: Not listed on this notice — check the SAM listing",
    program: null,
  },
  open: {
    kind: 'open',
    label: 'Open competition',
    explanation: 'The notice states there is no set-aside.',
    audience: "Who it's for: Any business that can do the work",
    program: null,
  },
  sb: {
    kind: 'sb',
    label: 'Small Business set-aside',
    explanation: 'Reserved for small businesses.',
    audience: "Who it's for: Small businesses",
    program: 'small',
  },
  '8a': {
    kind: '8a',
    label: '8(a) set-aside',
    explanation: 'For businesses currently eligible for the 8(a) program.',
    audience: "Who it's for: 8(a) program participants",
    program: '8a',
  },
  wosb: {
    kind: 'wosb',
    label: 'Women-Owned set-aside',
    explanation: 'For eligible women-owned small businesses.',
    audience: "Who it's for: Eligible women-owned small businesses",
    program: 'wosb',
  },
  edwosb: {
    kind: 'edwosb',
    label: 'Women-Owned set-aside',
    explanation: 'For eligible economically disadvantaged women-owned small businesses.',
    audience: "Who it's for: Eligible women-owned small businesses",
    program: 'edwosb',
  },
  sdvosb: {
    kind: 'sdvosb',
    label: 'Service-Disabled Veteran-Owned set-aside',
    explanation: 'For eligible service-disabled veteran-owned small businesses.',
    audience: "Who it's for: Eligible service-disabled veteran-owned small businesses",
    program: 'sdvosb',
  },
  hubzone: {
    kind: 'hubzone',
    label: 'HUBZone set-aside',
    explanation: 'For eligible HUBZone small businesses.',
    audience: "Who it's for: Eligible HUBZone small businesses",
    program: 'hubzone',
  },
  vosb: {
    kind: 'vosb',
    label: 'Veteran-Owned set-aside',
    explanation: 'For eligible veteran-owned small businesses.',
    audience: "Who it's for: Eligible veteran-owned small businesses",
    program: 'vosb',
  },
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Classify a SAM set-aside description OR code.
 *
 * ⚠️ Null/empty is `not_stated`, NOT `open`. The map's filter layer treats a
 * NULL set_aside_code as Full & Open because that is the right default for a
 * FILTER (it decides which rows a query returns). It is the wrong default for
 * a CLAIM shown to a beginner: "Any business that can do the work" told 47.2%
 * of open notices' readers something the record never said. A filter may
 * assume; a sentence on a card may not.
 */
export function classifySetAside(raw: string | null | undefined): SetAsideKind {
  const t = (raw || '').trim();
  if (!t) return 'not_stated';
  const n = norm(t);
  if (
    n === 'none' ||
    n === 'nosetaside' ||
    n === 'nosetasideused' ||
    n.startsWith('nosetaside') ||
    n.includes('unrestricted') ||
    n.includes('fullandopen') ||
    n.includes('opencompetition')
  ) {
    return 'open';
  }
  if (n.includes('edwosb')) return 'edwosb';
  if (n.includes('wosb') || n.includes('womenowned')) return 'wosb';
  if (n.includes('sdvosb') || n.includes('servicedisabled')) return 'sdvosb';
  if (n.includes('hubzone') || n === 'hzc' || n === 'hzs' || n === 'hz') return 'hubzone';
  if (n === '8a' || n === '8an' || n.startsWith('8a') || n.includes('8a')) return '8a';
  // Programme-specific reservations that CONTAIN "small business" but are not
  // open to every small business. Checked BEFORE the small-business catch-all,
  // or "Indian Small Business Economic Enterprise" reads as "Small businesses"
  // and overstates a beginner's eligibility.
  if (
    n.includes('indiansmallbusiness') ||
    n.includes('indianeconomicenterprise') ||
    n.includes('buyindian') ||
    n.includes('emergingsmallbusiness')
  ) {
    return 'other';
  }
  if (n === 'sba' || n === 'sbp' || n === 'sb' || n.includes('smallbusiness') || n.includes('totalsmall')) {
    return 'sb';
  }
  if (n === 'vsa' || n === 'vss' || n.includes('veteran')) return 'vosb';
  if (n === 'isbee' || n === 'iee' || n === 'biciv' || n === 'las') return 'other';
  // Unrecognized non-empty value — omit rather than print a raw code.
  if (/^[A-Z0-9]{2,8}$/.test(t) && t === t.toUpperCase()) return 'unknown';
  return 'other';
}

export function translateSetAside(raw: string | null | undefined): SetAsideCopy {
  const kind = classifySetAside(raw);
  if (kind === 'unknown') {
    return { kind, label: null, explanation: null, audience: null, program: null };
  }
  if (kind === 'other') {
    return {
      kind,
      label: 'Set-aside listed',
      explanation: 'This opportunity has a listed restriction. Open the SAM listing for details.',
      audience: "Who it's for: See the listing",
      program: null,
    };
  }
  return SET_ASIDE_COPY[kind];
}

/**
 * Eligibility guard. A description is not size/8(a)/WOSB/SDVOSB/HUBZone
 * evidence. Never emit "likely you" / "you qualify" unless evidence.established
 * and the program is in evidence.programs.
 */
export function applyEligibilityGuard(
  copy: SetAsideCopy,
  evidence: EligibilityEvidence | undefined,
): { audienceLabel: string | null; userQualifies: boolean } {
  const established = evidence?.established === true;
  const programs = established ? evidence.programs : [];
  const qualifies =
    established && copy.program !== null && programs.includes(copy.program);
  if (qualifies) {
    return { audienceLabel: copy.audience, userQualifies: true };
  }
  return { audienceLabel: copy.audience, userQualifies: false };
}

export const FORBIDDEN_ELIGIBILITY_PHRASES = ['likely you', 'you qualify', 'you are eligible'] as const;

export type NoticeKind =
  | 'solicitation'
  | 'presolicitation'
  | 'sources_sought'
  | 'award'
  | 'informational'
  | 'unknown';

export interface NoticeCopy {
  kind: NoticeKind;
  label: string | null;
  meaning: string | null;
  nextStep: string;
}

/**
 * Beginner notice labels. Stricter than classifyNoticeType: unknown types
 * are NOT called "open to bid now" (classifyNoticeType defaults unknown to
 * bid so Proposal Assist does not block — that default would overclaim here).
 */
export function translateNoticeType(
  noticeType: string | null | undefined,
  title?: string | null,
): NoticeCopy {
  const raw = (noticeType || '').trim();
  if (!raw) {
    return {
      kind: 'unknown',
      label: null,
      meaning: null,
      nextStep: 'Open the listing and review the requirements.',
    };
  }
  const classified = classifyNoticeType(raw, title);
  const t = raw.toLowerCase();

  if (t.includes('task order') || t.includes('delivery order')) {
    return {
      kind: 'award',
      label: 'Task order — already awarded',
      meaning: 'This work was awarded as a task order under an existing contract vehicle.',
      nextStep: 'Study the winner and the parent vehicle for future orders.',
    };
  }
  if (t.includes('award')) {
    return {
      kind: 'award',
      label: 'Already awarded — study who won',
      meaning: 'This one has already been awarded.',
      nextStep: 'Study the winner and contract details for future opportunities.',
    };
  }
  if (t.includes('presol') || t.includes('pre-sol') || t.includes('pre sol')) {
    return {
      kind: 'presolicitation',
      label: 'Coming soon — get ready',
      meaning: 'The opportunity is expected, but the final solicitation may not be posted yet.',
      nextStep: 'Review it now and prepare before the bid opens.',
    };
  }
  if (t.includes('sources sought') || t.includes('rfi') || t.includes('request for information')) {
    return {
      kind: 'sources_sought',
      label: "They're researching the market",
      meaning: 'The agency is checking whether companies can do this work.',
      nextStep: 'Read the notice and decide whether to respond with your capabilities.',
    };
  }
  const explicitlyBiddable =
    t.includes('combined') ||
    t.includes('solicitation') ||
    t.includes('rfq') ||
    t.includes('quot') ||
    t.includes('rfp') ||
    classified.label === 'Special Notice · RPP' ||
    classified.label === 'BAA' ||
    classified.label === 'CSO' ||
    classified.label === 'OTA';
  if (explicitlyBiddable && classified.respondability === 'bid') {
    return {
      kind: 'solicitation',
      label: 'Open to bid now',
      meaning: 'The agency is accepting offers.',
      nextStep: 'Open the listing and review the requirements and deadline.',
    };
  }
  if (classified.respondability === 'none') {
    return {
      kind: 'informational',
      label: 'Informational notice',
      meaning: 'This is an announcement, not a request for a priced bid.',
      nextStep: 'Open the listing to see what the agency is announcing.',
    };
  }
  return {
    kind: 'unknown',
    label: null,
    meaning: null,
    nextStep: 'Open the listing and review the requirements.',
  };
}

/**
 * WHAT STAGE IS THIS? — the beginner distinction that decides what to DO.
 *
 * An RFI and a Solicitation are both "opportunities", but only one of them
 * you can bid. The screenshot headline said "13 current opportunities" over a
 * set that was 8 market-research notices, 1 pre-solicitation and 4 biddable —
 * a beginner reading that can miss a real bid deadline while preparing a
 * capability statement, or the reverse.
 *
 * Derived from `notice_type` on the record. `unknown` stays unknown: a notice
 * type we do not recognise is never promoted to "open to bid".
 */
export type NoticeStage =
  | 'open_bid'
  | 'market_research'
  | 'upcoming'
  | 'awarded'
  | 'informational'
  | 'unknown';

export const STAGE_LABEL: Record<NoticeStage, string> = {
  open_bid: 'Open to bid now',
  market_research: 'Market research — not a bid',
  upcoming: 'Coming soon — not open yet',
  awarded: 'Already awarded',
  informational: 'Announcement only',
  unknown: 'Stage not stated',
};

/** Plural-safe group headings for the stage-split counts. */
export const STAGE_GROUP_LABEL: Record<NoticeStage, (n: number) => string> = {
  open_bid: (n) => `${n} open to bid now`,
  market_research: (n) => `${n} market research ${n === 1 ? 'notice' : 'notices'} (not a bid)`,
  upcoming: (n) => `${n} coming soon`,
  awarded: (n) => `${n} already awarded`,
  informational: (n) => `${n} ${n === 1 ? 'announcement' : 'announcements'}`,
  unknown: (n) => `${n} with no stage stated`,
};

export function noticeStage(noticeType: string | null | undefined, title?: string | null): NoticeStage {
  const kind = translateNoticeType(noticeType, title).kind;
  switch (kind) {
    case 'solicitation':
      return 'open_bid';
    case 'sources_sought':
      return 'market_research';
    case 'presolicitation':
      return 'upcoming';
    case 'award':
      return 'awarded';
    case 'informational':
      return 'informational';
    default:
      return 'unknown';
  }
}

export interface StageCounts {
  open_bid: number;
  market_research: number;
  upcoming: number;
  awarded: number;
  informational: number;
  unknown: number;
  total: number;
}

export function emptyStageCounts(): StageCounts {
  return {
    open_bid: 0,
    market_research: 0,
    upcoming: 0,
    awarded: 0,
    informational: 0,
    unknown: 0,
    total: 0,
  };
}

/**
 * Headline copy that never blurs the stages. "13 current opportunities" is
 * replaced by the actual mix, in the order a beginner should act on it.
 */
export function describeStageMix(counts: StageCounts): string {
  const parts: string[] = [];
  const order: NoticeStage[] = ['open_bid', 'market_research', 'upcoming', 'awarded', 'informational', 'unknown'];
  for (const stage of order) {
    const n = counts[stage];
    if (n > 0) parts.push(STAGE_GROUP_LABEL[stage](n));
  }
  if (parts.length === 0) return 'Nothing open right now.';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const EPOCH_FLOOR = Date.UTC(1980, 0, 1);

export function parseDeadlineMs(iso: string | null | undefined): number | null {
  if (!iso || !String(iso).trim()) return null;
  const s = String(iso).trim();
  // Bare numbers are not SAM deadlines — Date.parse('0') becomes Jan 2000 in V8.
  if (/^\d{1,10}$/.test(s)) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  if (t < EPOCH_FLOOR) return null;
  return t;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function monthDayUtc(ms: number): string {
  const d = new Date(ms);
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Due in 8 days · Sept 16" / "Due today · Sept 8" / "Closed · Sept 1" / "Deadline: check listing". */
export const MISSING_DUE_LABEL = 'Deadline: check listing';

export function formatDueLabel(iso: string | null | undefined, nowMs: number): string {
  const t = parseDeadlineMs(iso);
  if (t === null) return MISSING_DUE_LABEL;
  const days = Math.round((utcDayStart(t) - utcDayStart(nowMs)) / 86_400_000);
  const when = monthDayUtc(t);
  if (days < 0) return `Closed · ${when}`;
  if (days === 0) return `Due today · ${when}`;
  if (days === 1) return `Due in 1 day · ${when}`;
  return `Due in ${days} days · ${when}`;
}

/**
 * A BID deadline and a MARKET-RESEARCH response date are not the same promise.
 * `formatDueLabel` says "Due in 8 days" for both, which reads as "bid by then"
 * on an RFI. The stage picks the verb; the date arithmetic is shared.
 */
export function formatStageDueLabel(
  iso: string | null | undefined,
  nowMs: number,
  stage: NoticeStage,
): string {
  if (stage === 'awarded') return formatAwardedLabel(iso);
  const base = formatDueLabel(iso, nowMs);
  if (base === MISSING_DUE_LABEL) {
    if (stage === 'market_research') return 'Response date: check listing';
    return MISSING_DUE_LABEL;
  }
  if (base.startsWith('Closed')) return base;
  switch (stage) {
    case 'market_research':
      return `Response ${lowerFirst(base)}`;
    case 'upcoming':
      return `Expected ${lowerFirst(base)}`;
    case 'open_bid':
      return `Bid ${lowerFirst(base)}`;
    default:
      return base;
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Award notices have no bid deadline. Prefer posted/award date over "Deadline: check listing". */
export function formatAwardedLabel(iso: string | null | undefined): string {
  const t = parseDeadlineMs(iso);
  if (t === null) return 'Already awarded';
  return `Awarded · ${monthDayUtc(t)}`;
}

export type AmountRender =
  | { kind: 'omitted' }
  | { kind: 'missing'; label: 'Amount not listed' }
  | { kind: 'zero'; label: '$0' }
  | { kind: 'value'; label: string };

/**
 * `undefined` = field not on the record (omit the row).
 * `null` = field present but unknown.
 * `0` = explicit zero (the only time we print $0).
 */
export function formatBeginnerAmount(value: number | null | undefined): AmountRender {
  if (value === undefined) return { kind: 'omitted' };
  if (value === null) return { kind: 'missing', label: 'Amount not listed' };
  if (!Number.isFinite(value)) return { kind: 'missing', label: 'Amount not listed' };
  if (value === 0) return { kind: 'zero', label: '$0' };
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const compact = (divisor: number, suffix: string) => {
    const formatted = (abs / divisor).toFixed(1).replace(/\.0$/, '');
    return `${sign}$${formatted}${suffix}`;
  };
  if (abs >= 1_000_000_000) return { kind: 'value', label: compact(1_000_000_000, 'B') };
  if (abs >= 1_000_000) return { kind: 'value', label: compact(1_000_000, 'M') };
  if (abs >= 1_000) return { kind: 'value', label: compact(1_000, 'K') };
  return { kind: 'value', label: `${sign}$${Math.round(abs).toLocaleString()}` };
}

/**
 * Show the trusted PSC description only. Never invent a title from the code
 * (do not call getPsc here — a missing description stays omitted).
 */
export function beginnerPscLabel(
  description: string | null | undefined,
  _code?: string | null,
): string | null {
  const d = (description || '').trim();
  return d || null;
}

export type RevealState = 'strong' | 'direct_only' | 'expanded_only' | 'thin' | 'unavailable';
export type CtaVariant = 'more' | 'full_market';

export function ctaLabel(variant: CtaVariant, revealState: RevealState): string {
  if (revealState === 'strong' && variant === 'full_market') return 'See your full market with Mindy';
  return 'See more opportunities with Mindy';
}

export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
