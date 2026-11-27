/**
 * Ask Mindy → Decision Makers tab (GovDecisionMakersPanel). Maps a parsed question onto the two filters
 * the tab already sends to GET /api/app/federal-contacts: `agency` (the Agency dropdown) and `search`
 * (the "name or title" box, which the route also matches against agency and bureau). Nothing else.
 *
 * The directory has no location, set-aside, NAICS, PSC or fiscal-year columns, takes ONE agency and ONE
 * search phrase, and cannot exclude words. Those questions return null → "Ask Mindy in chat instead".
 * A fiscal year next to something the tab CAN filter still runs, and the summary says the year was not
 * applied, so a dropped constraint is never silent.
 *
 * The agency value: the route resolves full names ("Department of Homeland Security", "Defense Logistics
 * Agency") through its parent/sub-agency/DoDAAC resolvers, exactly as it does for a Target List agency.
 * Bare acronyms do NOT all resolve there ("DHS" would be ILIKE %DHS%; "EPA" would match every
 * "DEPARTMENT"), so a discovery `resolveAs` is sent as the agency's full name, never as the acronym.
 */
import agencyAliases from '@/data/agency-aliases.json';
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface DecisionMakersAskParams {
  /** The tab's search box (name / title / agency / bureau). '' = none. */
  search: string;
  /** The tab's agency filter, as a full agency name. '' = all agencies. */
  agency: string;
}

const ALIASES: Record<string, string> = (agencyAliases as { aliases?: Record<string, string> }).aliases || {};

/** discovery's short buyer codes (intent.ts MAPS_AGENCY_PHRASES) → the full name the route resolves. */
const CODE_TO_NAME: Record<string, string> = {
  ARMY: 'Department of the Army',
  NAVY: 'Department of the Navy',
  'AIR FORCE': 'Department of the Air Force',
  USMC: 'U.S. Marine Corps',
  'COAST GUARD': 'U.S. Coast Guard',
  DOD: 'Department of Defense',
  VA: 'Department of Veterans Affairs',
  DHS: 'Department of Homeland Security',
  HHS: 'Department of Health and Human Services',
  USDA: 'Department of Agriculture',
  DOE: 'Department of Energy',
  DOJ: 'Department of Justice',
  DOS: 'Department of State',
  DOI: 'Department of the Interior',
  DOT: 'Department of Transportation',
  TREASURY: 'Department of the Treasury',
  NASA: 'National Aeronautics and Space Administration',
  GSA: 'General Services Administration',
  EPA: 'Environmental Protection Agency',
  USACE: 'U.S. Army Corps of Engineers',
  NSF: 'National Science Foundation',
};

/** A discovery `resolveAs` → the full agency name sent as the tab's `agency` filter. */
export function decisionMakersAgencyName(resolveAs: string): string {
  const name = CODE_TO_NAME[resolveAs] || ALIASES[resolveAs] || resolveAs;
  // "U.S. Postal Service (USPS)" → "U.S. Postal Service": the route ILIKEs the name, and a
  // parenthetical acronym is never part of the stored department text.
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

const NOUN = { one: 'decision maker', many: 'decision makers' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type a buyer, a job title, or a name to search decision makers.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.states.length) return 'Decision makers can’t be filtered by location here.';
  if (i.setAsides.length) return 'Decision makers can’t be filtered by set-aside here.';
  if (i.naics.length || i.psc.length) return 'Decision makers can’t be filtered by NAICS or PSC code here.';
  if (i.exclusions.length) return 'Decision makers can’t exclude words here.';
  if (i.agencies.length > 1) return 'Decision makers filter one agency at a time.';
  if (ask.keywords.length > 1) return 'Decision makers search one name or title at a time.';
  if (!i.agencies.length && !ask.keywords.length) {
    return 'Add a buyer, a job title, or a name — a fiscal year alone isn’t a filter here.';
  }
  return null;
}

export const decisionMakersAskAdapter: TabAskAdapter<DecisionMakersAskParams> = {
  tab: 'decision_makers',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. contracting officers at the Navy',
  examples: ['contracting officers at the Navy', 'DLA decision makers', 'NASA program manager'],
  tabWords: [
    'government decision makers', 'decision makers', 'decision maker',
    'government contacts', 'federal contacts', 'points of contact', 'point of contact',
    'contacts', 'contact', 'pocs', 'poc', 'people', 'person',
    'who buys', 'buyers', 'buyer', 'buys',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    const a = ask.intent.agencies[0];
    return {
      search: ask.keywords[0] || '',
      agency: a ? decisionMakersAgencyName(a.resolveAs) : '',
    };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    let line = `Mindy searched: ${askFacets(ask).join(' · ')} — ${countPhrase(count, NOUN)}`;
    const notes: string[] = [];
    // The search box matches text, not meaning — say so, so an empty list is read correctly.
    if (ask.keywords[0]) notes.push(`name, title or agency contains “${ask.keywords[0]}”`);
    if (ask.fiscalYears.length) {
      notes.push(`${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab`);
    }
    if (notes.length) line += ` (${notes.join('; ')})`;
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
