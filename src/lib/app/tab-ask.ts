/**
 * Ask Mindy on a tab — the shared, PURE contract (ships OFF behind NEXT_PUBLIC_TAB_ASK).
 *
 * Owner goal: "have Ask Mindy on every tab, and its results are produced like the results on the page
 * that the tab is on". So an answer is NOT a chat reply: the plain-English question is turned into the
 * tab's OWN existing filter/search parameters, and the tab reloads its list through its OWN existing API.
 * The rows the user sees are exactly the rows the tab's filters would have produced. No new endpoint,
 * no LLM, no invented data.
 *
 *   question ─► parseTabAsk()  (canonical discovery: extractStructuredIntent + buildTextMatcher)
 *            ─► adapter.toQuery(ask) → that tab's params, or null  (null ⇒ "Ask Mindy in chat instead")
 *            ─► the tab's existing fetch  → the tab's normal cards
 *            ─► adapter.summary(ask, count) → "Mindy searched: Navy · cybersecurity — 14 upcoming buys"
 *
 * MEANING LIVES IN src/lib/discovery (the ONE search-meaning layer). This file never re-interprets a
 * query; it only (a) removes the tab's own routing nouns ("forecasts", "decision makers" — the tab already
 * answers that), (b) pulls a fiscal-year token so it can never become a keyword, and (c) drops closed-class
 * function words the discovery matcher already marks as never-a-market (FUNCTION_WORDS).
 *
 * Imports intent.ts / matcher.ts DIRECTLY, never the discovery index (that pulls server-only apply.ts).
 */
import { extractStructuredIntent, type StructuredIntent } from '@/lib/discovery/intent';
import { buildTextMatcher, FUNCTION_WORDS, type Concept } from '@/lib/discovery/matcher';
import type { SetAsideKey } from '@/lib/search/query-intent';

/** The code switch. Default OFF; with it off every tab renders exactly as before. Never set here. */
export function isTabAskEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TAB_ASK === 'on';
}

/** Event the box fires to open the in-app chat with the question (the app shell listens). */
export const TAB_ASK_CHAT_EVENT = 'mindy:tab-ask-chat';
/** The chat panel's existing seed key (MindyChatPanel reads it once on mount and sends it). */
export const CHAT_SEED_KEY = 'mindy_chat_seed';

export type TabAskTab = 'forecasts' | 'recompetes' | 'contractors' | 'decision_makers' | 'saved_searches' | 'pipeline' | 'contacts' | 'grants' | 'dibbs';

export interface ParsedTabAsk {
  question: string;
  /** The canonical structured intent (agencies, states, set-asides, NAICS, PSC, exclusions, horizon hint). */
  intent: StructuredIntent;
  /** Fiscal years named in the question, as 4-digit years ("2027"). Never a keyword. */
  fiscalYears: string[];
  /**
   * Keyword phrases, one per comma/"or" alternative, in the user's own word order, with tab nouns and
   * function words removed. Words are kept only when the discovery matcher recognised them as part of
   * a concept, so the keyword is never something discovery itself would ignore.
   */
  keywords: string[];
  /** Tab nouns the user used ("forecasts") — evidence the question is about this tab's list. */
  mentionedTab: boolean;
  /** Advice-shaped ("how do I…", "why…", "should I…") — a chat question, never a list filter. */
  advice: boolean;
  /** Nothing usable at all. */
  empty: boolean;
}

/** How the tab's list size is reported back. `null` = unknown (the load failed) — never shown as 0. */
export type TabAskCount = { shown: number; more: boolean } | null;

export interface TabAskAdapter<P> {
  tab: TabAskTab;
  /** Plural noun for the tab's rows, in the tab's own words ("upcoming buys"). Singular for 1. */
  noun: { one: string; many: string };
  placeholder: string;
  /** 2–3 example questions the tab can ALWAYS express with its filters. */
  examples: string[];
  /** Words/phrases that name the tab itself; stripped before keyword derivation. */
  tabWords: string[];
  /** The tab's params, or null when the question cannot be expressed in the tab's filters. */
  toQuery(ask: ParsedTabAsk): P | null;
  /** One short line: what Mindy searched and how many rows came back. */
  summary(ask: ParsedTabAsk, count: TabAskCount): string;
  /** Why toQuery returned null, in plain English (shown beside the chat handoff). */
  whyNot(ask: ParsedTabAsk): string;
}

// ── Parse ────────────────────────────────────────────────────────────────────────────────────

const FY_RE = /\b(?:fy\s?'?(\d{4}|\d{2})|fiscal\s+year\s+(\d{4}|\d{2}))\b/gi;
const ADVICE_START = /^\s*(how|why|should|could|would|can i|can we|is it|do i|do we|what should|what would|what is the best|explain|tell me why)\b/i;

function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function removePhrase(padded: string, phrase: string): { hit: boolean; rest: string } {
  const t = ` ${fold(phrase)} `;
  if (t.trim() === '') return { hit: false, rest: padded };
  let rest = padded;
  let hit = false;
  while (rest.includes(t)) { rest = rest.replace(t, ' '); hit = true; }
  return { hit, rest };
}

function conceptWords(c: Concept, into: Set<string>): void {
  for (const s of [c.label, ...c.forms, ...c.aliases]) for (const w of fold(s).split(' ')) if (w) into.add(w);
  for (const a of c.acronyms || []) into.add(a.toLowerCase());
  for (const cc of c.cooccur || []) conceptWords(cc, into);
}

export function parseTabAsk(question: string, tabWords: string[] = []): ParsedTabAsk {
  const q = String(question || '').trim();
  const fiscalYears: string[] = [];
  const withoutFy = q.replace(FY_RE, (_m, a?: string, b?: string) => {
    const y = String(a || b || '');
    const year = y.length === 2 ? `20${y}` : y;
    if (!fiscalYears.includes(year)) fiscalYears.push(year);
    return ' ';
  });

  const intent = extractStructuredIntent(withoutFy);

  // Tab nouns, longest first, whole-token, removed from the RESIDUAL only (structure is already out).
  let padded = ` ${intent.residual.toLowerCase().replace(/\s*,\s*/g, ' , ')} `;
  let mentionedTab = false;
  for (const w of [...tabWords].sort((a, b) => b.length - a.length)) {
    const r = removePhrase(padded, w);
    if (r.hit) { mentionedTab = true; padded = r.rest; }
  }
  // "forecast"/"upcoming"/"recompete" are lifecycle words discovery already consumed into horizonHint.
  if (intent.horizonHint) mentionedTab = mentionedTab || tabWords.some((w) => intent.stripped.includes(fold(w)));

  const residual = padded.replace(/\s+/g, ' ').trim();
  const matcher = buildTextMatcher(residual, intent.exclusions.map((e) => e.term));
  const keywords: string[] = [];
  if (matcher.mode === 'code' && matcher.phrase) {
    keywords.push(matcher.phrase);
  } else if (matcher.mode === 'exact_phrase' && matcher.phrase) {
    keywords.push(matcher.phrase);
  } else if (matcher.mode === 'lexical') {
    const parts = residual.split(/\s*[,;]\s*|\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const known = new Set<string>();
      const m = buildTextMatcher(part);
      for (const alt of m.alternatives) for (const c of [...alt.eligible, ...alt.rankOnly]) conceptWords(c, known);
      const words = fold(part).split(' ').filter((w) => w && known.has(w) && !FUNCTION_WORDS.has(w));
      if (words.length) keywords.push(words.join(' '));
    }
  }

  const structured = intent.agencies.length + intent.states.length + intent.setAsides.length
    + intent.naics.length + intent.psc.length + fiscalYears.length;
  const advice = ADVICE_START.test(q);
  const empty = !q || (structured === 0 && keywords.length === 0 && intent.exclusions.length === 0);
  return { question: q, intent, fiscalYears, keywords, mentionedTab, advice, empty };
}

// ── Helpers adapters share ─────────────────────────────────────────────────────────────────────

/** Plain-English set-aside labels (summary line). */
export const SET_ASIDE_LABEL: Record<SetAsideKey, string> = {
  '8a': '8(a)', wosb: 'WOSB', edwosb: 'EDWOSB', hubzone: 'HUBZone', sdvosb: 'SDVOSB', vosb: 'VOSB',
  sdb: 'SDB', sb: 'Small business', isbee: 'ISBEE',
};

/** Words that resolve to an upper-case key but read as names ("Navy", not "NAVY"). */
const NAME_WORDS = new Set(['navy', 'army', 'marines']);

/** The buyer as the user wrote it: their own casing if they used any, else acronym or Title Case. */
function agencyLabel(question: string, resolveAs: string, mention: string): string {
  const escaped = mention.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9]+');
  const typed = question.match(new RegExp(`\\b${escaped}\\b`, 'i'))?.[0];
  if (typed && typed !== typed.toLowerCase()) return typed;
  if (!/\s/.test(mention) && resolveAs === mention.toUpperCase() && !NAME_WORDS.has(mention)) return resolveAs;
  return mention.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** The facets Mindy searched, in a stable order, for the summary line. */
export function askFacets(ask: ParsedTabAsk, opts: { includeFiscalYears?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const a of ask.intent.agencies) out.push(agencyLabel(ask.question, a.resolveAs, a.mention));
  for (const k of ask.keywords) out.push(k);
  for (const n of ask.intent.naics) out.push(`NAICS ${n}`);
  for (const s of ask.intent.setAsides) out.push(SET_ASIDE_LABEL[s] || s);
  if (ask.intent.states.length) out.push(ask.intent.states.join(', '));
  if (opts.includeFiscalYears) for (const y of ask.fiscalYears) out.push(`FY${y}`);
  return out;
}

/** "14 upcoming buys" / "200+ upcoming buys" / "count unavailable" — unknown is never 0. */
export function countPhrase(count: TabAskCount, noun: { one: string; many: string }): string {
  if (count === null) return `${noun.many} count unavailable`;
  const n = count.shown;
  const word = n === 1 ? noun.one : noun.many;
  return count.more ? `${n.toLocaleString('en-US')}+ ${word} (showing the first ${n.toLocaleString('en-US')})` : `${n.toLocaleString('en-US')} ${word}`;
}

/** Seed the chat with the question and ask the app shell to open it. Safe when storage is blocked. */
export function handOffToChat(question: string): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(CHAT_SEED_KEY, question); } catch { /* storage unavailable — chat opens empty */ }
  window.dispatchEvent(new CustomEvent(TAB_ASK_CHAT_EVENT, { detail: { question } }));
}
