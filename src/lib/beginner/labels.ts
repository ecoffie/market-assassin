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
  open: {
    kind: 'open',
    label: 'Open competition',
    explanation: 'No small-business set-aside is listed.',
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
 * Classify a SAM set-aside description OR code. Null/empty on SAM open
 * opportunities is Full & Open (map-filters: ~4,801 active rows have NULL
 * set_aside_code). That is SAM-specific — do not reuse for recompete rows
 * where NULL means unknown.
 */
export function classifySetAside(raw: string | null | undefined): SetAsideKind {
  const t = (raw || '').trim();
  if (!t) return 'open';
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

/** "Due in 8 days · Sept 16" / "Due today" / "Closed" / "Due date not listed". */
export function formatDueLabel(iso: string | null | undefined, nowMs: number): string {
  const t = parseDeadlineMs(iso);
  if (t === null) return 'Due date not listed';
  const days = Math.round((utcDayStart(t) - utcDayStart(nowMs)) / 86_400_000);
  if (days < 0) return 'Closed';
  if (days === 0) return 'Due today';
  if (days === 1) return `Due in 1 day · ${monthDayUtc(t)}`;
  return `Due in ${days} days · ${monthDayUtc(t)}`;
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
