/**
 * Ask Mindy → Dashboard tab ("Today's Intel"). Maps a parsed question onto the two filters the tab
 * already has over the selected briefing's items: the Search box (ONE literal phrase, matched by the
 * panel's existing substring filter) and the filter chips (All · Urgent · Opportunities · Teaming).
 * Nothing else — the answer is the same rows typing in the Search box and clicking a chip would show.
 *
 * The tab cannot express: a buyer (the Search box is literal text, so "VA" or "DHS" would match the
 * wrong rows or none), a state, set-aside, NAICS/PSC code, `-exclusions`, OR-alternatives, a fiscal
 * year, an upcoming/recompete horizon (the briefing is one mixed list), or advice. Those return null →
 * the box offers "Ask Mindy in chat instead". A dropped constraint is never silent.
 *
 * The chip words ("urgent", "teaming") are this tab's own filter labels, not search meaning: they pick
 * the chip and are stripped (as tab words) so they never become a keyword.
 */
import { countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

/** The panel's chip filters an ask can select ("Opportunities" is the tab's generic noun, not a chip ask). */
export type DashboardAskFilter = 'all' | 'urgent' | 'teaming';

export interface DashboardAskParams {
  /** The tab's Search box text. */
  search: string;
  /** The tab's active filter chip. */
  filter: DashboardAskFilter;
}

const NOUN = { one: 'briefing item', many: 'briefing items' };

const CHIP_WORDS: Array<{ word: string; filter: Exclude<DashboardAskFilter, 'all'> }> = [
  { word: 'urgent', filter: 'urgent' },
  { word: 'teaming', filter: 'teaming' },
];

function chips(ask: ParsedTabAsk): Array<Exclude<DashboardAskFilter, 'all'>> {
  const folded = ` ${ask.question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  return CHIP_WORDS.filter((c) => folded.includes(` ${c.word} `)).map((c) => c.filter);
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  const chosen = chips(ask);
  if (!ask.question) return 'Type a word to look for in today’s briefing, or “urgent” or “teaming”.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint === 'recompete') return 'Today’s briefing can’t be narrowed to expiring contracts here.';
  if (i.horizonHint === 'forecast') return 'Today’s briefing can’t be narrowed to upcoming buys here.';
  if (i.agencies.length) return 'Today’s briefing can’t be filtered by buyer here.';
  if (i.states.length) return 'Today’s briefing can’t be filtered by state here.';
  if (i.setAsides.length) return 'Today’s briefing can’t be filtered by set-aside here.';
  if (i.naics.length || i.psc.length) return 'Today’s briefing can’t be filtered by code here.';
  if (i.exclusions.length) return 'Today’s briefing can’t exclude words here.';
  if (ask.fiscalYears.length) return 'Today’s briefing can’t be filtered by fiscal year.';
  if (ask.keywords.length > 1) return 'Today’s briefing searches one phrase at a time.';
  if (chosen.length > 1) return 'Today’s briefing shows one filter at a time — urgent or teaming.';
  if (!ask.keywords.length && !chosen.length) return 'Type a word to look for in today’s briefing, or “urgent” or “teaming”.';
  return null;
}

export const dashboardAskAdapter: TabAskAdapter<DashboardAskParams> = {
  tab: 'dashboard',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. urgent cybersecurity',
  examples: ['urgent', 'teaming', 'cybersecurity'],
  tabWords: [
    'briefing items', 'briefing item', 'briefings', 'briefing', 'today s intel', 'todays intel', 'intel', 'today',
    'opportunities', 'opportunity', 'items', 'urgent', 'teaming',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    return { search: ask.keywords[0] || '', filter: chips(ask)[0] || 'all' };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets: string[] = [];
    const chip = chips(ask)[0];
    if (chip) facets.push(chip);
    if (ask.keywords[0]) facets.push(ask.keywords[0]);
    return `Mindy searched today’s briefing: ${facets.join(' · ')} — ${countPhrase(count, NOUN)}`;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
