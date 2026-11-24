/**
 * Ask Mindy → Contractors tab. Maps a parsed question onto the params the panel already sends to
 * GET /api/contractors/search-bq: `search` (COMPANY NAME — the route matches recipient_name only),
 * `naics`, and `state`. Nothing else.
 *
 * What this tab can express, and therefore what an answer may claim:
 *  - a NAICS code (or several)            → the top contractors in that code
 *  - a company name                       → firms whose name contains it (± one state, ± NAICS)
 *  - one state                            → contractors headquartered there (name path only)
 *
 * What it cannot, so the box offers "Ask Mindy in chat instead" rather than guessing:
 *  - a CAPABILITY in words ("cybersecurity contractors"). The tab's text box searches company NAMES,
 *    and no canonical keyword→NAICS mapping exists in src/lib/discovery, so treating "cybersecurity"
 *    as a name would return firms that happen to be NAMED cyber-something — a claim the user did not
 *    make. A phrase becomes a name search only when the user named a company: an explicit cue
 *    ("named", "called", "company name"), or the question is just the phrase with no tab noun — the
 *    same thing typing it into the tab's "Company name" box does. The summary always says
 *    `name contains "…"` so the meaning is visible.
 *  - an agency (the route has no agency filter), set-asides, PSC, `-exclusions`, OR-alternatives,
 *    more than one state, NAICS + state together (the panel applies its state filter only to name
 *    search), expiring/upcoming-contract questions, and advice.
 * A fiscal year is not a filter here: the search still runs and the summary SAYS all years are shown.
 */
import { countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface ContractorsAskParams {
  /** Company-name search (recipient_name LIKE), '' for none. */
  search: string;
  /** Comma-separated NAICS codes, '' for none. */
  naics: string;
  /** One 2-letter state, '' for none. Only ever set without NAICS (the panel's own rule). */
  state: string;
}

const NOUN = { one: 'contractor', many: 'contractors' };

/** The user is naming a company, not describing work. */
const NAME_CUE_RE = /\b(?:named|called|company\s+name|name)\b/i;
const NAME_CUE_WORDS = new Set(['named', 'called', 'name']);

/** The company name to search, or null when the phrase reads as a capability (or there is none). */
function companyName(ask: ParsedTabAsk): string | null {
  if (ask.keywords.length !== 1) return null;
  const cue = NAME_CUE_RE.test(ask.question);
  if (!cue && ask.mentionedTab) return null;
  const name = ask.keywords[0].split(' ').filter((w) => !NAME_CUE_WORDS.has(w)).join(' ').trim();
  return name || null;
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint) return 'This tab lists contractors by award history, not upcoming or expiring contracts.';
  if (ask.empty) return 'Type a company name, a NAICS code, or a state to search contractors.';
  if (i.agencies.length) return 'This tab can’t filter contractors by the agency they sell to yet.';
  if (i.setAsides.length) return 'This tab can’t filter contractors by set-aside.';
  if (i.psc.length) return 'This tab can’t filter contractors by PSC code.';
  if (i.exclusions.length) return 'This tab can’t exclude words.';
  if (ask.keywords.length > 1) return 'This tab searches one company name at a time.';
  if (ask.keywords.length === 1 && !companyName(ask)) {
    return 'This tab finds contractors by company name or NAICS code, not by what they do. Try a NAICS code (for example “top contractors in 541512”) or ask Mindy in chat.';
  }
  if (i.states.length > 1) return 'This tab filters one state at a time.';
  if (i.states.length && i.naics.length) return 'On this tab the state filter works with a company-name search, not with a NAICS code.';
  const scoped = i.naics.length + i.states.length + (companyName(ask) ? 1 : 0);
  if (!scoped) return 'Add a company name, a NAICS code, or a state — a fiscal year alone isn’t a filter here.';
  return null;
}

export const contractorsAskAdapter: TabAskAdapter<ContractorsAskParams> = {
  tab: 'contractors',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. top contractors in NAICS 541512',
  examples: ['top contractors in NAICS 541512', 'companies named Leidos', 'contractors in Virginia'],
  tabWords: [
    'contractors', 'contractor', 'companies', 'company', 'firms', 'firm', 'vendors', 'vendor',
    'businesses', 'primes', 'players', 'competitors',
    // The tab's own filter label — "NAICS 541512" already yields the code; the word itself is not a keyword.
    'naics codes', 'naics code', 'naics',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const i = ask.intent;
    return {
      search: companyName(ask) || '',
      naics: i.naics.join(', '),
      state: i.naics.length ? '' : (i.states[0] || ''),
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets: string[] = [];
    const name = companyName(ask);
    if (name) facets.push(`name contains “${name}”`);
    for (const n of ask.intent.naics) facets.push(`NAICS ${n}`);
    if (ask.intent.states.length) facets.push(ask.intent.states.join(', '));
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
