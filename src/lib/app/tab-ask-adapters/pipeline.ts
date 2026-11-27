/**
 * Ask Mindy → Pipeline tab (My Pursuits).
 *
 * This tab's list is the customer's OWN pursuits. GET /api/pipeline returns them all once; every filter
 * on the page (notice type, owner, saved views, completed/archived toggles) is applied in the browser
 * over that loaded list. So the honest equivalent of "the tab's own filters" is: narrow THAT already-
 * loaded list to the pursuits whose STORED fields (agency · NAICS · set-aside · title) cover every part
 * of the question. No request, no new endpoint, no LLM; the page renders the matches with its own rows.
 *
 * Meaning comes from src/lib/discovery only: the question is parsed by parseTabAsk, and a pursuit's
 * stored agency / set-aside text is read by the SAME extractStructuredIntent, so "DEPT OF THE NAVY" is
 * the Navy because discovery says so — not because of a rule written here. Matching is literal: a pursuit
 * with no agency is NOT shown for "Navy" (A MATCH IS A CLAIM). Facets AND together; keyword alternatives
 * ("cloud, cyber") OR together.
 *
 * Pure: no window, no fetch.
 */
import { extractStructuredIntent } from '@/lib/discovery/intent';
import type { SetAsideKey } from '@/lib/search/query-intent';
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

/** The fields of a pursuit the page already has. */
export interface PursuitLite {
  id: string;
  title?: string | null;
  agency?: string | null;
  naics_code?: string | null;
  set_aside?: string | null;
}

export interface PipelineAskParams {
  /** Per asked buyer: the canonical key (resolveAs) and the words the user typed. */
  agencies: Array<{ resolveAs: string; mention: string }>;
  naics: string[];
  setAsides: SetAsideKey[];
  /** Alternatives — a pursuit matches when ANY one is covered by its title. */
  keywords: string[];
}

const NOUN = { one: 'pursuit', many: 'pursuits' };

function fold(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Whole-token phrase containment on folded text ("navy" in "dept of the navy", never "navyfed"). */
function hasPhrase(text: string, phrase: string): boolean {
  const p = fold(phrase);
  return !!p && ` ${text} `.includes(` ${p} `);
}

/** Does this pursuit explicitly cover every part of the question? */
export function pursuitMatches(o: PursuitLite, p: PipelineAskParams): boolean {
  if (p.agencies.length) {
    const raw = String(o.agency ?? '').trim();
    if (!raw) return false;
    const text = fold(raw);
    const resolved = new Set(extractStructuredIntent(raw).agencies.map((a) => a.resolveAs));
    if (!p.agencies.every((a) => resolved.has(a.resolveAs) || hasPhrase(text, a.mention))) return false;
  }
  if (p.naics.length) {
    const stored = String(o.naics_code ?? '').trim();
    if (!stored) return false;
    if (!p.naics.every((c) => stored.startsWith(c) || c.startsWith(stored))) return false;
  }
  if (p.setAsides.length) {
    const raw = String(o.set_aside ?? '').trim();
    if (!raw) return false;
    const stored = new Set(extractStructuredIntent(raw).setAsides);
    if (!p.setAsides.every((k) => stored.has(k))) return false;
  }
  if (p.keywords.length) {
    const tokens = fold(o.title).split(' ').filter(Boolean);
    // Every word of ONE alternative appears as the start of a title word ("cyber" ⊂ "cybersecurity").
    const covered = p.keywords.some((k) => fold(k).split(' ').every((w) => tokens.some((t) => t.startsWith(w))));
    if (!covered) return false;
  }
  return true;
}

/** The pursuits (in list order) that cover the question. */
export function matchPursuits<T extends PursuitLite>(pursuits: T[], p: PipelineAskParams): T[] {
  return pursuits.filter((o) => pursuitMatches(o, p));
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type a buyer, a set-aside, or what you sell to find it in your pursuits.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint === 'recompete') return 'Your pursuits aren’t marked as recompetes, so this tab can’t filter by that.';
  if (i.horizonHint === 'forecast') return 'Your pursuits aren’t marked as forecasts, so this tab can’t filter by that.';
  if (i.exclusions.length) return 'Pursuits can’t be filtered by excluded words here.';
  if (i.states.length) return 'Pursuits don’t store a place of performance, so this tab can’t filter by state.';
  if (i.psc.length) return 'Pursuits don’t store a PSC code, so this tab can’t filter by it.';
  const scoped = i.agencies.length + i.setAsides.length + i.naics.length + ask.keywords.length;
  if (!scoped) return 'A pursuit has no fiscal year here — add a buyer, a set-aside, or what you sell.';
  return null;
}

export const pipelineAskAdapter: TabAskAdapter<PipelineAskParams> = {
  tab: 'pipeline',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. which of my pursuits are for the Navy?',
  examples: ['Navy', 'cybersecurity', 'SDVOSB pursuits for the VA'],
  // Nouns naming this tab, plus the verbs people use to ask ABOUT their list ("which pursuits are for
  // the Navy") — routing words, never something a pursuit is about. "naics" is here because parseTabAsk
  // keeps the bare label as a keyword next to the code (as on the saved-searches tab).
  tabWords: [
    'my pursuits', 'pursuits', 'pursuit', 'my pipeline', 'pipeline', 'my deals', 'deals', 'deal',
    'tracking', 'pursuing', 'cover', 'covers', 'include', 'includes', 'naics',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const i = ask.intent;
    return {
      agencies: i.agencies.map((a) => ({ resolveAs: a.resolveAs, mention: a.mention })),
      naics: [...i.naics],
      setAsides: [...i.setAsides],
      keywords: [...ask.keywords],
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    let line = `Mindy searched your pursuits for: ${askFacets(ask).join(' · ')} — ${countPhrase(count, NOUN)}`;
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t stored on a pursuit, so it was not used)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
