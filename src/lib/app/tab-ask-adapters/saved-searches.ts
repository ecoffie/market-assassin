/**
 * Ask Mindy → Saved searches tab (the Watchlist, `/opportunity-map/saved` shown in the app shell).
 *
 * This tab's list is the customer's OWN saved searches — no server-side filter API exists for it; the
 * page loads them once from GET /api/app/saved-searches and renders one card per search. So the honest
 * equivalent of "the tab's own filters" is: narrow THAT already-loaded list to the searches whose STORED
 * filters (the map keys parseMapFilters reads: agency/subAgency · naics · psc · state · setAside · q) or
 * name explicitly cover every part of the question. No request, no new endpoint, no LLM, and the page
 * renders the matches with its own card renderer.
 *
 * Matching is deliberately literal: a search scoped to "All agencies" is NOT shown for "Navy" — it
 * doesn't name the Navy, and claiming it does would be a match the search never made (A MATCH IS A CLAIM).
 * Facets AND together; keyword alternatives ("cloud, cyber") OR together.
 *
 * Meaning still comes from src/lib/discovery via parseTabAsk; this file only compares parsed facets to
 * stored saved-search filters. Pure: no window, no fetch.
 */
import type { SetAsideKey } from '@/lib/search/query-intent';
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

/** frame → app: the saved searches the Watchlist page loaded (sent only when the feature is on). */
export const WATCHLIST_SEARCHES_MESSAGE = 'mindy:watchlist-searches';
/** app → frame: show only these saved-search ids (`null` = Clear, show them all again). */
export const WATCHLIST_ASK_MESSAGE = 'mindy:watchlist-ask';

/** The fields of a saved search the page already has (id, name, stored map filters). */
export interface SavedSearchLite {
  id: string;
  name: string;
  filters: Record<string, unknown>;
}

export interface SavedSearchesAskParams {
  /** Per asked buyer, the words that name it (what the user typed + the canonical resolveAs). */
  agencies: string[][];
  naics: string[];
  psc: string[];
  states: string[];
  setAsides: SetAsideKey[];
  /** Alternatives — a search matches when ANY one is covered by its name or keyword. */
  keywords: string[];
}

const NOUN = { one: 'saved search', many: 'saved searches' };

/**
 * Stored `setAside` values (the map's SET_GROUPS keys and raw SAM codes, src/lib/opportunities/map-data.ts)
 * that mean each canonical set-aside. Kept here because map-data.ts is server-only. A group key that
 * CONTAINS the asked kind counts ('SDVOSB' group holds VSA/VSB; 'WOSB' group holds EDWOSB).
 */
const STORED_SET_ASIDE: Record<SetAsideKey, string[]> = {
  sb: ['SB', 'SBA', 'SBP'],
  '8a': ['8A', '8AN', '8(A)'],
  sdvosb: ['SDVOSB', 'SDVOSBC', 'SDVOSBS'],
  vosb: ['SDVOSB', 'VSA', 'VSB', 'VOSB'],
  wosb: ['WOSB', 'WOSBSS'],
  edwosb: ['WOSB', 'EDWOSB', 'EDWOSBSS'],
  hubzone: ['HZ', 'HZC', 'HZS', 'HUBZONE'],
  sdb: ['SDB'],
  isbee: ['ISBEE'],
};

function fold(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Same splitting the map uses for multi-value filters (comma or pipe), as plain strings. */
function multi(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  return raw.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
}

/** Whole-token phrase containment on folded text ("navy" in "department of the navy", never "navyfed"). */
function hasPhrase(text: string, phrase: string): boolean {
  const p = fold(phrase);
  return !!p && ` ${text} `.includes(` ${p} `);
}

function prefixEither(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** Does this saved search explicitly cover every part of the question? */
export function savedSearchMatches(s: SavedSearchLite, p: SavedSearchesAskParams): boolean {
  const f = s.filters && typeof s.filters === 'object' ? s.filters : {};

  if (p.agencies.length) {
    const agencyText = fold([...multi(f.agency), ...multi(f.agencies), ...multi(f.subAgency)].join(' '));
    if (!agencyText) return false;
    if (!p.agencies.every((terms) => terms.some((t) => hasPhrase(agencyText, t)))) return false;
  }
  if (p.naics.length) {
    const stored = multi(f.naics);
    if (!p.naics.every((c) => stored.some((x) => prefixEither(x, c)))) return false;
  }
  if (p.psc.length) {
    const stored = multi(f.psc).map((x) => x.toUpperCase());
    if (!p.psc.every((c) => stored.some((x) => prefixEither(x, c.toUpperCase())))) return false;
  }
  if (p.states.length) {
    const stored = multi(f.state).map((x) => x.toUpperCase());
    if (!p.states.every((st) => stored.includes(st.toUpperCase()))) return false;
  }
  if (p.setAsides.length) {
    const stored = multi(f.setAside).map((x) => x.toUpperCase());
    if (!p.setAsides.every((k) => (STORED_SET_ASIDE[k] || []).some((v) => stored.includes(v)))) return false;
  }
  if (p.keywords.length) {
    const text = fold([s.name, f.q, f.search].filter((x) => typeof x === 'string').join(' '));
    const tokens = text.split(' ').filter(Boolean);
    // Every word of ONE alternative appears as the start of a word ("cyber" ⊂ "cybersecurity").
    const covered = p.keywords.some((k) => fold(k).split(' ').every((w) => tokens.some((t) => t.startsWith(w))));
    if (!covered) return false;
  }
  return true;
}

/** The ids (in list order) of the saved searches that cover the question. */
export function matchSavedSearches(searches: SavedSearchLite[], p: SavedSearchesAskParams): string[] {
  return searches.filter((s) => savedSearchMatches(s, p)).map((s) => String(s.id));
}

/** Read a frame → app list message; null for anything else. Never trusts shape. */
export function parseWatchlistSearchesMessage(data: unknown): SavedSearchLite[] | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { type?: unknown; searches?: unknown };
  if (d.type !== WATCHLIST_SEARCHES_MESSAGE || !Array.isArray(d.searches)) return null;
  const out: SavedSearchLite[] = [];
  for (const raw of d.searches) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { id?: unknown; name?: unknown; filters?: unknown };
    if (r.id == null || r.id === '') continue;
    out.push({
      id: String(r.id),
      name: typeof r.name === 'string' ? r.name : '',
      filters: r.filters && typeof r.filters === 'object' && !Array.isArray(r.filters) ? (r.filters as Record<string, unknown>) : {},
    });
  }
  return out;
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type a buyer, a place, or what you sell to find it in your saved searches.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint === 'recompete') return 'Expiring-contract (recompete) searches aren’t listed on this tab.';
  if (i.exclusions.length) return 'Saved searches can’t be filtered by excluded words here.';
  const scoped = i.agencies.length + i.states.length + i.setAsides.length + i.naics.length + i.psc.length + ask.keywords.length;
  if (!scoped) return 'A saved search has no fiscal year — add a buyer, a place, or what you sell.';
  return null;
}

export const savedSearchesAskAdapter: TabAskAdapter<SavedSearchesAskParams> = {
  tab: 'saved_searches',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. which of my searches cover the Navy?',
  examples: ['Navy', 'cybersecurity in Virginia', 'small business construction'],
  // Nouns naming this tab, plus the verbs people use to ask ABOUT their list ("which searches cover the
  // Navy") — routing words, never something a saved search is about. "naics"/"psc" are here because
  // parseTabAsk keeps the bare label as a keyword next to the code (noted for the foundation owner).
  tabWords: [
    'saved searches', 'saved search', 'my searches', 'searches', 'watchlist', 'watch list', 'watching',
    'cover', 'covers', 'covering', 'include', 'includes', 'including', 'mention', 'mentions', 'track', 'tracking',
    'naics', 'psc',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const i = ask.intent;
    return {
      agencies: i.agencies.map((a) => [...new Set([a.mention, a.resolveAs].filter(Boolean))]),
      naics: [...i.naics],
      psc: [...i.psc],
      states: [...i.states],
      setAsides: [...i.setAsides],
      keywords: [...ask.keywords],
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets = askFacets(ask);
    for (const c of ask.intent.psc) facets.push(`PSC ${c}`);
    let line = `Mindy searched your saved searches for: ${facets.join(' · ')} — ${countPhrase(count, NOUN)}`;
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t part of a saved search, so it was not used)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
