/**
 * Ask Mindy → Partner Finder tab. Maps a parsed question onto the params the panel's "Describe the work"
 * mode already sends to GET /api/app/capability-search: `q` (a description of the work, matched
 * semantically against award-history capability profiles) and one `state`. Nothing else.
 *
 * What this tab can express, and therefore what an answer may claim:
 *  - a description of the work            → firms whose award history means that work
 *  - … plus one state                     → the same, located in that state
 *
 * What it cannot, so the box offers "Ask Mindy in chat instead" rather than guessing:
 *  - a buyer/agency, a set-aside, NAICS or PSC codes (the tab deliberately searches by what firms do,
 *    not by code), `-exclusions`, OR-alternatives ("cloud, cyber" — the tab takes ONE description),
 *    more than one state, a state with no work described (the tab needs a description), an
 *    upcoming/expiring-contract question, and advice.
 * The description is the discovery layer's own keyword phrase (parseTabAsk) — never re-interpreted here.
 * A fiscal year is not a filter: the search still runs and the summary SAYS all years are used.
 * The specialty-concentration dropdown is left at "Any" for an answer, so nothing narrows it silently.
 */
import { countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface PartnerFinderAskParams {
  /** The work to describe (capability-search `q`). Never empty. */
  q: string;
  /** One 2-letter state, '' for none. */
  state: string;
}

const NOUN = { one: 'partner match', many: 'partner matches' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint) return 'This tab finds partners by the work in their award history, not by upcoming or expiring contracts.';
  if (ask.empty) return 'Describe the work you need a partner for, optionally with a state.';
  if (i.agencies.length) return 'This tab can’t filter partners by the agency they sell to yet.';
  if (i.setAsides.length) return 'This tab can’t filter partners by set-aside.';
  if (i.naics.length || i.psc.length) return 'This tab finds partners by what they do, not by NAICS or PSC code — describe the work instead.';
  if (i.exclusions.length) return 'This tab can’t exclude words.';
  if (ask.keywords.length > 1) return 'This tab searches one description of the work at a time.';
  if (i.states.length > 1) return 'This tab filters one state at a time.';
  if (!ask.keywords.length) return 'Describe the work you need a partner for — a state alone isn’t enough to search.';
  return null;
}

export const partnerFinderAskAdapter: TabAskAdapter<PartnerFinderAskParams> = {
  tab: 'partner_finder',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. cybersecurity partners in Virginia',
  examples: ['cybersecurity partners in Virginia', 'wildland firefighting crews', 'janitorial teaming partners in Florida'],
  tabWords: [
    'teaming partners', 'teaming partner', 'teaming', 'partners', 'partner', 'subcontractors', 'subcontractor',
    'subs', 'contractors', 'contractor', 'companies', 'company', 'firms', 'firm', 'vendors', 'vendor',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    return { q: ask.keywords[0], state: ask.intent.states[0] || '' };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets = [ask.keywords[0], ...ask.intent.states].filter(Boolean);
    let line = `Mindy searched: ${facets.join(' · ')} — ${countPhrase(count, NOUN)}`;
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab, so all award years are used)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
