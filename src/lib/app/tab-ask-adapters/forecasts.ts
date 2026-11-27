/**
 * Ask Mindy → Forecasts tab ("Upcoming Buys"). Maps a parsed question onto the params the panel already
 * sends to GET /api/forecasts (naics · agency · search · state · setAside). Nothing else.
 *
 * The tab cannot express: PSC codes, `-exclusions`, OR-alternatives ("cloud, cyber" — the route's
 * `search` is ONE title/description phrase), set-asides outside its own dropdown, a recompete question,
 * or advice. Those return null → the box offers "Ask Mindy in chat instead". A fiscal year is not one of
 * the tab's filters either: the search still runs and the summary SAYS all years are shown, so a dropped
 * constraint is never silent.
 */
import type { SetAsideKey } from '@/lib/search/query-intent';
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface ForecastsAskParams {
  naics: string;
  agency: string;
  search: string;
  state: string;
  setAside: string;
}

/** The panel's Set-Aside dropdown values (real set_aside_type strings) — the ONLY ones the tab offers. */
const FORECAST_SET_ASIDE: Partial<Record<SetAsideKey, string>> = {
  sb: 'Small Business',
  '8a': '8(a)',
  hubzone: 'HUBZone',
  sdvosb: 'SDVOSB',
};

const NOUN = { one: 'upcoming buy', many: 'upcoming buys' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type what you sell, a buyer, or a place to search upcoming buys.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint === 'recompete') return 'That is about expiring contracts, not planned buys.';
  if (i.psc.length) return 'Upcoming buys can’t be filtered by PSC code here.';
  if (i.exclusions.length) return 'Upcoming buys can’t exclude words here.';
  if (ask.keywords.length > 1) return 'Upcoming buys search one phrase at a time.';
  if (i.setAsides.length > 1) return 'Upcoming buys filter one set-aside at a time.';
  if (i.setAsides.length === 1 && !FORECAST_SET_ASIDE[i.setAsides[0]]) return 'That set-aside isn’t one of this tab’s filters.';
  const scoped = i.agencies.length + i.states.length + i.setAsides.length + i.naics.length + ask.keywords.length;
  if (!scoped) return 'Add what you sell, a buyer, or a place — a fiscal year alone isn’t a filter here.';
  return null;
}

export const forecastsAskAdapter: TabAskAdapter<ForecastsAskParams> = {
  tab: 'forecasts',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. Navy cybersecurity buys in Virginia',
  examples: ['Navy cybersecurity', 'janitorial services in Florida', 'VA IT help desk, small business'],
  tabWords: ['upcoming buys', 'upcoming buy', 'planned buys', 'buys', 'buy', 'forecasts', 'forecast', 'procurements'],

  toQuery(ask) {
    if (reason(ask)) return null;
    const i = ask.intent;
    return {
      naics: i.naics.join(', '),
      // Pipe separates buyers for the shared forecast agency resolver (resolveForecastAgencies).
      agency: i.agencies.map((a) => a.resolveAs).join('|'),
      search: ask.keywords[0] || '',
      state: i.states.join(', '),
      setAside: i.setAsides.length ? FORECAST_SET_ASIDE[i.setAsides[0]] || '' : '',
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets = askFacets(ask);
    let line = `Mindy searched: ${facets.join(' · ')} — ${countPhrase(count, NOUN)}`;
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab, so all years are shown)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
