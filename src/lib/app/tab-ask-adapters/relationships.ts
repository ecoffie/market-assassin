/**
 * Ask Mindy → Contacts tab (panel id "contacts" → RelationshipsPanel). Maps a parsed question onto the
 * filters the tab already sends to GET /api/app/relationships, and nothing else:
 *
 *   view    — the tab's own sub-list: My Saved Contacts (`network`), Gov Buyers (`buyers`), OSBP
 *             Directory (`osbp`) or Find Partners (`partners`). Chosen ONLY when the question names one
 *             ("OSBP at DHS", "teaming partners 541512", "Smith in my network"); otherwise `null` and the
 *             panel keeps the sub-list the user is on (see relationshipsRequest).
 *   search  — the tab's search box (one phrase; the route substring-matches it across name / title /
 *             organization / agency / office / email / context).
 *   naics   — the tab's NAICS box (comma list; discovery sorted it out, never a keyword).
 *   agency  — the tab's Agency box. The route substring-matches it against SAM department / sub-tier /
 *             office text ("DEPT OF THE NAVY", "HOMELAND SECURITY, DEPARTMENT OF") and the OSBP
 *             directory's agency names. A bare acronym does NOT work there (`%VA%` matches "NAVY"), so a
 *             discovery buyer code is sent as the core words both stores share ("homeland security").
 *             A buyer whose core words would be ambiguous as a substring ("state", "interior") or that the
 *             stored text does not carry (Marine Corps rows sit under "DEPT OF THE NAVY") is never sent:
 *             the question goes to chat instead of showing a wrong list.
 *
 * The tab has no location, set-aside, PSC or fiscal-year filter and cannot exclude words; those questions
 * return null → "Ask Mindy in chat instead". A fiscal year beside something the tab CAN filter still
 * runs and the summary says the year was not applied.
 */
import agencyAliases from '@/data/agency-aliases.json';
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export type RelationshipsView = 'network' | 'buyers' | 'osbp' | 'partners';

export interface RelationshipsAskParams {
  /** The sub-list the question named, or null = keep the one the user is on. */
  view: RelationshipsView | null;
  /** The tab's search box. '' = none. */
  search: string;
  /** The tab's NAICS box, comma-separated. '' = none. */
  naics: string;
  /** The tab's Agency box (substring text). '' = none. */
  agency: string;
}

const ALIASES: Record<string, string> = (agencyAliases as { aliases?: Record<string, string> }).aliases || {};

/**
 * discovery's short buyer codes → the words the stored department / sub-tier / OSBP names contain.
 * Codes absent here (DOS, DOI, USMC, USACE) cannot be matched safely by substring → chat.
 */
const CODE_TO_TEXT: Record<string, string> = {
  ARMY: 'army',
  NAVY: 'navy',
  'AIR FORCE': 'air force',
  'COAST GUARD': 'coast guard',
  DOD: 'defense',
  VA: 'veterans affairs',
  DHS: 'homeland security',
  HHS: 'health and human services',
  USDA: 'agriculture',
  DOE: 'energy',
  DOJ: 'justice',
  DOT: 'transportation',
  TREASURY: 'treasury',
  NASA: 'aeronautics and space',
  GSA: 'general services',
  EPA: 'environmental protection',
  NSF: 'national science foundation',
};
const UNMATCHABLE_CODES = new Set(['DOS', 'DOI', 'USMC', 'USACE']);

/** A discovery `resolveAs` → the Agency-box text, or null when no safe substring exists. */
export function relationshipsAgencyText(resolveAs: string): string | null {
  if (UNMATCHABLE_CODES.has(resolveAs)) return null;
  if (CODE_TO_TEXT[resolveAs]) return CODE_TO_TEXT[resolveAs];
  const name = ALIASES[resolveAs] || resolveAs;
  // "U.S. Postal Service (USPS)" → "U.S. Postal Service": a parenthetical acronym is never stored text.
  const text = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  // A bare short code that discovery did not expand is the `%VA%` trap — never send it.
  if (!/\s/.test(text) && text === text.toUpperCase() && text.length <= 6) return null;
  return text;
}

/** Words that name one of the tab's sub-lists (whole words, folded). Longest first. */
const VIEW_WORDS: Array<[string, RelationshipsView]> = [
  ['my saved contacts', 'network'], ['saved contacts', 'network'], ['my contacts', 'network'], ['my network', 'network'],
  ['government buyers', 'buyers'], ['gov buyers', 'buyers'], ['buyers', 'buyers'], ['buyer', 'buyers'],
  ['osbp directory', 'osbp'], ['osbp', 'osbp'], ['osdbu', 'osbp'],
  ['teaming partners', 'partners'], ['teaming partner', 'partners'], ['prime contractors', 'partners'],
  ['partners', 'partners'], ['partner', 'partners'], ['primes', 'partners'], ['teaming', 'partners'],
];

function fold(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** The sub-list(s) the question names. */
function namedViews(question: string): RelationshipsView[] {
  let q = fold(question);
  const out: RelationshipsView[] = [];
  for (const [w, v] of VIEW_WORDS) {
    const t = ` ${w} `;
    if (q.includes(t)) {
      q = q.split(t).join(' ');
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

const NOUN = { one: 'contact', many: 'contacts' };

/** A question that only names a sub-list ("show the OSBP directory") — opens it with no filters. */
function bareView(ask: ParsedTabAsk): RelationshipsView | null {
  const i = ask.intent;
  const views = namedViews(ask.question);
  if (views.length !== 1 || ask.advice) return null;
  const filters = i.agencies.length + i.states.length + i.setAsides.length + i.naics.length + i.psc.length
    + i.exclusions.length + ask.keywords.length;
  return filters === 0 ? views[0] : null;
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (bareView(ask)) return null;
  if (ask.empty) return 'Type a buyer, a NAICS code, a job title, or a name to search contacts.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  const views = namedViews(ask.question);
  if (views.length > 1) return 'Contacts show one list at a time — My Network, Gov Buyers, OSBP, or Partners.';
  if (i.states.length) return 'Contacts can’t be filtered by location here.';
  if (i.setAsides.length) return 'Contacts can’t be filtered by set-aside here — try the OSBP Directory for small business offices.';
  if (i.psc.length) return 'Contacts can’t be filtered by PSC code here.';
  if (i.exclusions.length) return 'Contacts can’t exclude words here.';
  if (i.agencies.length > 1) return 'Contacts filter one agency at a time.';
  if (ask.keywords.length > 1) return 'Contacts search one name, title or company at a time.';
  if (i.agencies.length && relationshipsAgencyText(i.agencies[0].resolveAs) === null) {
    return 'That buyer can’t be matched reliably by this tab’s Agency filter.';
  }
  if (views[0] === 'network') {
    if (i.naics.length) return 'My Saved Contacts can’t be filtered by NAICS code.';
    if (i.agencies.length && ask.keywords.length) return 'My Saved Contacts search one name, company or agency at a time.';
  }
  if (!i.agencies.length && !ask.keywords.length && !i.naics.length) {
    return 'Add a buyer, a NAICS code, a job title, or a name — a fiscal year alone isn’t a filter here.';
  }
  return null;
}

export const relationshipsAskAdapter: TabAskAdapter<RelationshipsAskParams> = {
  tab: 'contacts',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. contracting officers at the Navy',
  examples: ['contracting officers at the Navy', 'OSBP at DHS', 'teaming partners 541512'],
  tabWords: [
    'my saved contacts', 'saved contacts', 'my contacts', 'my network',
    'government buyers', 'gov buyers', 'buyers', 'buyer',
    'osbp directory', 'osbp', 'osdbu',
    'teaming partners', 'teaming partner', 'prime contractors', 'partners', 'partner', 'primes', 'teaming',
    'relationships', 'relationship', 'contacts', 'contact', 'people', 'person', 'pocs', 'poc',
    'naics codes', 'naics code', 'naics',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const a = ask.intent.agencies[0];
    return {
      view: namedViews(ask.question)[0] || null,
      search: ask.keywords[0] || '',
      naics: ask.intent.naics.join(', '),
      agency: a ? relationshipsAgencyText(a.resolveAs) || '' : '',
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets = askFacets(ask);
    const views = namedViews(ask.question);
    const label = views[0] ? VIEW_LABEL[views[0]] : '';
    const what = [label, ...facets].filter(Boolean).join(' · ') || 'contacts';
    let line = `Mindy searched: ${what} — ${countPhrase(count, NOUN)}`;
    const notes: string[] = [];
    // The search box matches text, not meaning — say so, so an empty list is read correctly.
    if (ask.keywords[0]) notes.push(`name, title, company or agency contains “${ask.keywords[0]}”`);
    if (ask.fiscalYears.length) notes.push(`${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab`);
    if (notes.length) line += ` (${notes.join('; ')})`;
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};

export const VIEW_LABEL: Record<RelationshipsView, string> = {
  network: 'My Saved Contacts',
  buyers: 'Gov Buyers',
  osbp: 'OSBP Directory',
  partners: 'Find Partners',
};

/**
 * Resolve the adapter's params against the sub-list the user is on, into exactly what the tab loads:
 *  - a named sub-list wins; otherwise the current one;
 *  - My Saved Contacts has only a search box (the route ILIKEs name / organization / agency / email), so
 *    an agency alone becomes that search; a NAICS code, or an agency plus words, can't run there, so an
 *    un-named question moves to Gov Buyers (the tab's default discovery list) instead of being dropped.
 */
export function relationshipsRequest(
  p: RelationshipsAskParams,
  current: RelationshipsView,
): { view: RelationshipsView; search: string; naics: string; agency: string } {
  let view = p.view ?? current;
  if (view === 'network' && p.view === null && (p.naics || (p.agency && p.search))) view = 'buyers';
  if (view === 'network') return { view, search: p.search || p.agency, naics: '', agency: '' };
  return { view, search: p.search, naics: p.naics, agency: p.agency };
}
