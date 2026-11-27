/**
 * Ask Mindy → DIBBS tab (DLA small-buy RFQs). Maps a parsed question onto the params the panel already
 * sends to GET /api/app/dibbs: `q` — ONE phrase the route matches against the RFQ description or
 * solicitation number — with the tab's NSN and FSC boxes cleared. Sort and "Include expired" stay as
 * the user set them. Nothing else.
 *
 * What the tab cannot express, so the box offers "Ask Mindy in chat instead" rather than guessing:
 *  - any CODE (a number in the question). On this tab a 4-digit number could be an FSC, an NSN prefix,
 *    a NAICS code or part of a solicitation number, and discovery does not know FSC/NSN — so Mindy never
 *    picks one. The tab's own NSN / FSC boxes take codes directly.
 *  - a buyer other than DLA (every DIBBS RFQ is a DLA buy; "DLA" itself is simply the tab), a state or
 *    place, a set-aside, `-exclusions`, OR-alternatives ("bearings or valves" — `q` is one phrase), an
 *    expiring/upcoming-contract question, or advice.
 * A fiscal year is not a filter here: the search still runs and the summary SAYS all years are shown.
 */
import { askFacets, countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface DibbsAskParams {
  /** One description/solicitation-number phrase. */
  q: string;
  /** Always '' — a question never fills the NSN box. */
  nsn: string;
  /** Always '' — a question never fills the FSC box. */
  fsc: string;
}

const NOUN = { one: 'RFQ', many: 'RFQs' };

function hasCode(ask: ParsedTabAsk): boolean {
  const i = ask.intent;
  return i.naics.length > 0 || i.psc.length > 0 || ask.keywords.some((k) => /\d/.test(k));
}

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (ask.empty) return 'Type a part or item (for example “hydraulic hose assembly”) to search DIBBS RFQs.';
  if (hasCode(ask)) return 'Put NSNs and FSC codes in this tab’s NSN / FSC boxes — Mindy won’t guess which kind of code a number is.';
  if (i.horizonHint) return 'DIBBS lists open DLA RFQs, not upcoming or expiring contracts.';
  if (i.agencies.some((a) => a.resolveAs !== 'DLA')) return 'DIBBS lists DLA buys only.';
  if (i.states.length) return 'DIBBS RFQs can’t be filtered by state or place here.';
  if (i.setAsides.length) return 'DIBBS RFQs can’t be filtered by set-aside here.';
  if (i.exclusions.length) return 'DIBBS search can’t exclude words here.';
  if (ask.keywords.length > 1) return 'DIBBS searches one phrase at a time.';
  if (!ask.keywords.length) return 'Add the part or item you supply — DIBBS searches RFQ descriptions.';
  return null;
}

export const dibbsAskAdapter: TabAskAdapter<DibbsAskParams> = {
  tab: 'dibbs',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. hydraulic hose assembly RFQs',
  examples: ['combat helmets', 'hydraulic hose assembly', 'DLA bearings'],
  tabWords: [
    'small buy rfqs', 'small buys', 'small buy', 'rfqs', 'rfq', 'dibbs', 'bid board', 'solicitations',
    'solicitation', 'quotes', 'quote',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    return { q: ask.keywords[0], nsn: '', fsc: '' };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    // "DLA" is the tab itself; naming it as a facet would read like a narrower filter.
    const facets = askFacets({ ...ask, intent: { ...ask.intent, agencies: [] } });
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
