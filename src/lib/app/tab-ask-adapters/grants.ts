/**
 * Ask Mindy → Grants tab ("Federal Grants"). Maps a parsed question onto the params the panel already
 * sends to GET /api/grants: `keyword` (ONE Grants.gov keyword phrase), `agency` (one code from the tab's
 * own Agency dropdown — the route prefix-matches it on agencyCode), and `status` (the tab's own Status
 * dropdown: Open Now / Forecasted / Closed). Category is cleared, never guessed from words.
 *
 * What the tab cannot express, so the box offers "Ask Mindy in chat instead" rather than guessing:
 *  - a buyer that is not one of the dropdown's top-level departments (NIH, Army, NOAA…) — mapping NIH to
 *    HHS or Army to DOD would silently widen the answer to the whole department;
 *  - more than one buyer, more than one status, OR-alternatives ("cloud, cyber") — the route takes ONE
 *    keyword phrase;
 *  - a state/place, set-aside, NAICS or PSC code, or `-exclusions` (Grants.gov search has none of those
 *    filters on this tab), an expiring-contract question, or advice.
 * A fiscal year is not a filter here either: the search still runs and the summary SAYS all years are
 * shown, so a dropped constraint is never silent.
 *
 * Status words are the tab's OWN dropdown labels ("open now", "forecasted", "closed grants"); they are
 * stripped as tab words so they never become a keyword. Discovery's forecast horizon ("upcoming",
 * "forecast", "planned") means the Forecasted status. No status named → Open Now, the tab's default.
 */
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface GrantsAskParams {
  /** One keyword phrase, '' for none. */
  keyword: string;
  /** One code from the tab's Agency dropdown, '' for all agencies. */
  agency: string;
  /** Always '' — a question never picks a funding category. */
  category: string;
  status: 'posted' | 'forecasted' | 'closed';
}

const NOUN = { one: 'grant', many: 'grants' };

/**
 * discovery resolveAs → the tab's Agency dropdown code (src/app/api/grants/route.ts AGENCY_LIST).
 * Only exact top-level departments; sub-agencies are deliberately absent (see header).
 */
const GRANTS_AGENCY: Record<string, string> = {
  HHS: 'HHS',
  DOD: 'DOD',
  NSF: 'NSF',
  DOE: 'DOE',
  USDA: 'USDA',
  'Department of Commerce': 'DOC',
  'Department of Education': 'ED',
  EPA: 'EPA',
  NASA: 'NASA',
  DOJ: 'DOJ',
  'Department of Labor': 'DOL',
  DOL: 'DOL',
  DOS: 'DOS',
  DOT: 'DOT',
  VA: 'VA',
};

const STATUS_LABEL: Record<GrantsAskParams['status'], string> = {
  posted: 'open now',
  forecasted: 'forecasted',
  closed: 'closed',
};

/** The tab's own Status dropdown words, as whole phrases. */
const STATUS_WORDS: Array<{ status: GrantsAskParams['status']; phrases: string[] }> = [
  { status: 'posted', phrases: ['open now', 'open grants', 'open grant', 'currently open'] },
  { status: 'forecasted', phrases: ['forecasted'] },
  { status: 'closed', phrases: ['closed grants', 'closed grant', 'closed'] },
];

function fold(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** Statuses the question names (tab dropdown words + discovery's forecast horizon). */
function namedStatuses(ask: ParsedTabAsk): Array<GrantsAskParams['status']> {
  const q = fold(ask.question);
  const out: Array<GrantsAskParams['status']> = [];
  for (const s of STATUS_WORDS) {
    if (s.phrases.some((p) => q.includes(` ${p} `)) && !out.includes(s.status)) out.push(s.status);
  }
  if (ask.intent.horizonHint === 'forecast' && !out.includes('forecasted')) out.push('forecasted');
  return out;
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (ask.empty) return 'Type a topic or a funding agency to search grants.';
  if (i.horizonHint === 'recompete') return 'That is about expiring contracts, not grants.';
  if (i.states.length) return 'Grants can’t be filtered by state or place here.';
  if (i.setAsides.length) return 'Grants can’t be filtered by set-aside here.';
  if (i.naics.length || i.psc.length) return 'Grants aren’t filed by NAICS or PSC code.';
  if (i.exclusions.length) return 'Grants can’t exclude words here.';
  if (ask.keywords.length > 1) return 'Grants search one phrase at a time.';
  if (i.agencies.length > 1) return 'Grants filter one agency at a time.';
  if (i.agencies.length === 1 && !GRANTS_AGENCY[i.agencies[0].resolveAs]) {
    return 'That agency isn’t one of this tab’s agency filters (it lists whole departments, like HHS or DOD).';
  }
  if (namedStatuses(ask).length > 1) return 'Grants show one status at a time (open now, forecasted, or closed).';
  const scoped = i.agencies.length + ask.keywords.length + namedStatuses(ask).length;
  if (!scoped) return 'Add a topic or a funding agency — a fiscal year alone isn’t a filter here.';
  return null;
}

export const grantsAskAdapter: TabAskAdapter<GrantsAskParams> = {
  tab: 'grants',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. HHS health research grants',
  examples: ['cybersecurity research', 'HHS health grants', 'upcoming DOE energy grants'],
  tabWords: [
    'grant opportunities', 'grant opportunity', 'federal grants', 'grants', 'grant', 'funding opportunities',
    'funding',
    // The tab's own Status dropdown labels — read by namedStatuses(), never a keyword.
    'open now', 'currently open', 'open grants', 'open grant', 'forecasted', 'closed grants', 'closed grant', 'closed',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const agency = ask.intent.agencies[0];
    return {
      keyword: ask.keywords[0] || '',
      agency: agency ? GRANTS_AGENCY[agency.resolveAs] : '',
      category: '',
      status: namedStatuses(ask)[0] || 'posted',
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets = askFacets(ask);
    facets.push(STATUS_LABEL[namedStatuses(ask)[0] || 'posted']);
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
