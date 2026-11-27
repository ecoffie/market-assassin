/**
 * Ask Mindy → Alerts tab ("Source Feed" of open SAM notices). Maps a parsed question onto the tab's OWN
 * controls and nothing else:
 *
 *   search — the tab's search box. The panel already sends it to GET /api/app/opportunities as
 *            `q` + `keywordOnly=true` (title/description search across ALL of SAM, replacing the
 *            profile NAICS), and the panel's own list filter then applies it too.
 *   state  — the tab's "All states" dropdown (one exact place-of-performance state, applied by the panel
 *            to the loaded rows).
 *
 * Asking resets the notice-type chip to "All" and clears CTA chips so the list shows exactly what the
 * question says (Clear on the box puts them back).
 *
 * The tab CANNOT express, so these return null → "Ask Mindy in chat instead":
 *  - a buyer ("Navy", "VA"): the feed has no agency filter, and putting the name into the search box
 *    would be a new local search rule;
 *  - a NAICS or PSC code: the search box is a title/description text search, a code would match nothing;
 *  - a specific set-aside: the tab's "Set-Aside" chip means ANY set-aside, not 8(a)/SDVOSB/…;
 *  - more than one phrase or state, `-exclusions`, a forecast/recompete question, advice.
 * A fiscal year is not one of the tab's filters: the search still runs and the summary SAYS it was not
 * applied, so a dropped constraint is never silent.
 */
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface AlertsAskParams {
  /** The tab's search box value. '' = the user's profile feed. */
  search: string;
  /** One two-letter state for the tab's state dropdown. '' = all states. */
  state: string;
}

const NOUN = { one: 'open opportunity', many: 'open opportunities' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type what you sell or a state to search open opportunities.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint === 'forecast') return 'That is about planned buys — this feed shows open notices.';
  if (i.horizonHint === 'recompete') return 'That is about expiring contracts — this feed shows open notices.';
  if (i.agencies.length) return 'This feed can’t be filtered by buyer yet.';
  if (i.naics.length || i.psc.length) return 'This feed searches words, not NAICS or PSC codes.';
  if (i.setAsides.length) return 'This feed can’t filter by a specific set-aside.';
  if (i.exclusions.length) return 'This feed can’t exclude words.';
  if (ask.keywords.length > 1) return 'This feed searches one phrase at a time.';
  if (i.states.length > 1) return 'This feed filters one state at a time.';
  if (!ask.keywords.length && !i.states.length) return 'Add what you sell or a state — a fiscal year alone isn’t a filter here.';
  return null;
}

export const alertsAskAdapter: TabAskAdapter<AlertsAskParams> = {
  tab: 'alerts',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. janitorial services in Florida',
  examples: ['cybersecurity', 'janitorial services in Florida', 'IT help desk in Virginia'],
  tabWords: [
    'open opportunities', 'open opportunity', 'opportunities', 'opportunity',
    'alerts', 'alert', 'notices', 'notice', 'solicitations', 'solicitation', 'feed', 'open',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    return { search: ask.keywords[0] || '', state: ask.intent.states[0] || '' };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    let line = `Mindy searched: ${askFacets(ask).join(' · ')} — ${countPhrase(count, NOUN)}`;
    // Without words the feed is the user's own profile feed, not all of SAM — say so.
    if (!ask.keywords.length) line += ' in your profile feed';
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab, so it was not applied)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
