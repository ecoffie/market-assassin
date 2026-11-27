/**
 * Ask Mindy → Recompetes tab ("Expiring Contracts"). Maps a parsed question onto the params the panel
 * already sends to GET /api/recompete, and nothing else:
 *
 *   naics       — the tab's own NAICS field (comma list; the route ORs the codes, prefix rule per code)
 *   state       — the route's existing `state` param (one exact place_of_performance_state)
 *   eligibleFor — the tab's own "Set-asides I qualify for" lanes. Same meaning as that toggle: the named
 *                 lanes PLUS every contract whose set-aside is not recorded (~65% of rows). The summary
 *                 says so, so a reader never takes the list for "only 8(a)".
 *
 * The "Expiring Within" window stays whatever the tab is already set to.
 *
 * The tab CANNOT express, so these return null → "Ask Mindy in chat instead":
 *  - words ("cybersecurity", "janitorial"): /api/recompete has no keyword search;
 *  - a buyer ("Navy", "VA"): the route's `agency` param substring-matches short aliases against
 *    awarding_agency only (`%AF%` also matches "Veterans AFfairs"; Navy/Army/Air Force rows carry
 *    awarding_agency "Department of Defense", so `%NAVY%` misses them). Sending it would show a wrong
 *    list, so this adapter never does;
 *  - more than one state (the route's `state` is one exact value), PSC, `-exclusions`, SDB/ISBEE (not
 *    lanes the tab offers), a forecast question, advice, or a fiscal year with nothing else.
 */
import type { SetAsideKey } from '@/lib/search/query-intent';
import { askFacets, countPhrase, SET_ASIDE_LABEL, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface RecompetesAskParams {
  /** NAICS codes, comma-separated (the panel's NAICS field format). '' = no NAICS filter. */
  naics: string;
  /** One two-letter state for /api/recompete `state`. '' = no state filter. */
  state: string;
  /** Set-aside lanes for /api/recompete `eligibleFor` (recompete_opportunities.set_aside_type values). */
  eligibleFor: string[];
}

/** SetAsideKey → the tab's set-aside lane vocabulary (src/lib/vault/certifications.ts SetAsideCode). */
export const RECOMPETE_SET_ASIDE: Partial<Record<SetAsideKey, string>> = {
  sb: 'SB-Total',
  '8a': '8(a)',
  sdvosb: 'SDVOSB',
  vosb: 'VOSB',
  wosb: 'WOSB',
  edwosb: 'EDWOSB',
  hubzone: 'HUBZone',
};

const NOUN = { one: 'expiring contract', many: 'expiring contracts' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type a NAICS code, a state, or a set-aside to search expiring contracts.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint === 'forecast') return 'That is about planned buys, not contracts that are ending.';
  if (i.agencies.length) return 'Expiring contracts can’t be filtered by buyer on this tab yet.';
  if (i.states.length > 1) return 'Expiring contracts filter one state at a time.';
  if (ask.keywords.length) return 'Expiring contracts here search by NAICS code, state and set-aside — not by words.';
  if (i.psc.length) return 'Expiring contracts can’t be filtered by PSC code here.';
  if (i.exclusions.length) return 'Expiring contracts can’t exclude words here.';
  if (i.setAsides.some((s) => !RECOMPETE_SET_ASIDE[s])) return 'That set-aside isn’t one of this tab’s filters.';
  const scoped = i.naics.length + i.states.length + i.setAsides.length;
  if (!scoped) return 'Add a NAICS code, a state, or a set-aside — a fiscal year alone isn’t a filter here.';
  return null;
}

export const recompetesAskAdapter: TabAskAdapter<RecompetesAskParams> = {
  tab: 'recompetes',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. 541512 expiring in Virginia, small business',
  examples: ['541512 in Virginia', 'HUBZone 236220 in Texas', '8(a) 561720 recompetes'],
  tabWords: [
    'expiring contracts', 'expiring contract', 'expiring awards', 'expiring award',
    'recompetes', 'recompete', 'rebids', 'rebid', 'contracts', 'contract', 'awards', 'award',
    // The NAICS code itself is already structured intent; the word naming the field is not a keyword.
    'naics codes', 'naics code', 'naics',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const i = ask.intent;
    return {
      naics: i.naics.join(', '),
      state: i.states[0] || '',
      eligibleFor: i.setAsides.map((s) => RECOMPETE_SET_ASIDE[s] as string),
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    let line = `Mindy searched: ${askFacets(ask).join(' · ')} — ${countPhrase(count, NOUN)}`;
    if (ask.intent.setAsides.length) {
      const lanes = ask.intent.setAsides.map((s) => SET_ASIDE_LABEL[s] || s).join(', ');
      line += ` (${lanes} plus contracts with no set-aside recorded)`;
    }
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab — the Expiring Within window applies)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
