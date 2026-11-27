/**
 * Ask Mindy → OSBP "Find Capable Small Businesses" tab. Maps a parsed question onto the two code params
 * the panel's form already sends to GET /api/app/osbp/smb-search: `psc` (one code) and `naics` (one code).
 * The tab's own "Max federal $" ceiling and "set-aside winners only" checkbox are left exactly as the user
 * set them, so the answer is what typing the codes into the tab's form would show.
 *
 * "Small business" is the tab's OWN subject (every row is ranked toward small firms by the $ ceiling), so
 * it is not an extra filter. Everything else the form cannot express — words describing the work (the
 * route ranks by code only), more than one PSC or NAICS, a buyer, a state, a specific set-aside program,
 * a fiscal year, `-exclusions`, or advice — returns null → "Ask Mindy in chat instead". Never guessed.
 */
import { countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface OsbpSmbAskParams {
  psc: string;
  naics: string;
}

const NOUN = { one: 'capable business', many: 'capable businesses' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type the PSC code of what you’re buying (e.g. J998) and/or a NAICS code.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.psc.length > 1) return 'This tab searches one PSC code at a time.';
  if (i.naics.length > 1) return 'This tab searches one NAICS code at a time.';
  if (i.agencies.length) return 'This tab can’t filter firms by buyer.';
  if (i.states.length) return 'This tab can’t filter firms by state.';
  if (i.setAsides.some((s) => s !== 'sb')) return 'This tab can’t filter by a specific set-aside program.';
  if (ask.fiscalYears.length) return 'This tab can’t filter by fiscal year.';
  if (i.exclusions.length) return 'This tab can’t exclude words.';
  if (ask.keywords.length) return 'This tab finds firms by PSC or NAICS code, not by words — add the code (e.g. PSC J998).';
  if (!i.psc.length && !i.naics.length) return 'Type the PSC code of what you’re buying (e.g. J998) and/or a NAICS code.';
  return null;
}

export const osbpSmbAskAdapter: TabAskAdapter<OsbpSmbAskParams> = {
  tab: 'osbp_smb',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. PSC J998, or NAICS 336611',
  examples: ['PSC J998', 'NAICS 336611', 'PSC R425 NAICS 541330'],
  tabWords: [
    'capable small businesses', 'small businesses', 'businesses', 'business', 'firms', 'firm',
    'companies', 'company', 'vendors', 'vendor', 'suppliers', 'supplier',
    'psc code', 'psc', 'naics code', 'naics', 'code',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    return { psc: ask.intent.psc[0] || '', naics: ask.intent.naics[0] || '' };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facets: string[] = [];
    if (ask.intent.psc[0]) facets.push(`PSC ${ask.intent.psc[0]}`);
    if (ask.intent.naics[0]) facets.push(`NAICS ${ask.intent.naics[0]}`);
    return `Mindy searched: ${facets.join(' · ')} — ${countPhrase(count, NOUN)}`;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
