/**
 * Ask Mindy → Pricing Intel tab. Maps a parsed question onto the ONE param the panel already sends to
 * GET /api/app/pricing-intel: either `naics` (one code — "By NAICS") or `keyword` (one or more labor
 * categories, comma-separated — "By Labor Category", the native GSA CALC search). Nothing else.
 *
 * What this tab can express, and therefore what an answer may claim:
 *  - one NAICS code                         → labor rates for that industry
 *  - one or more roles / labor categories   → labor rates for those job titles
 *
 * What it cannot, so the box offers "Ask Mindy in chat instead" rather than guessing:
 *  - a buyer/agency, a state, a set-aside, PSC codes, `-exclusions` (CALC rates are not filtered by any
 *    of these on this tab), more than one NAICS code, a NAICS code AND roles together (the tab runs one
 *    mode at a time), an upcoming/expiring-contract question, and advice ("what should I charge…" is a
 *    pricing decision for Mindy in chat, not a list).
 * Role phrases are the discovery layer's own keyword phrases (parseTabAsk) — never re-interpreted here;
 * the summary always says `roles “…”` so the meaning is visible. A fiscal year is not a filter: the
 * search still runs and the summary SAYS so.
 */
import { countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface PricingAskParams {
  mode: 'naics' | 'role';
  /** The NAICS code (mode 'naics') or comma-separated labor categories (mode 'role'). Never empty. */
  value: string;
}

const NOUN = { one: 'labor category', many: 'labor categories' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.horizonHint) return 'This tab shows labor rates, not upcoming or expiring contracts.';
  if (ask.empty) return 'Type a NAICS code or the roles you staff to see labor rates.';
  if (i.agencies.length) return 'This tab can’t filter labor rates by agency.';
  if (i.states.length) return 'This tab can’t filter labor rates by state.';
  if (i.setAsides.length) return 'This tab can’t filter labor rates by set-aside.';
  if (i.psc.length) return 'This tab can’t look up labor rates by PSC code.';
  if (i.exclusions.length) return 'This tab can’t exclude words.';
  if (i.naics.length > 1) return 'This tab looks up one NAICS code at a time.';
  if (i.naics.length && ask.keywords.length) return 'This tab searches by a NAICS code or by roles, not both at once.';
  if (!i.naics.length && !ask.keywords.length) return 'Add a NAICS code or a role — a fiscal year alone isn’t a filter here.';
  return null;
}

export const pricingAskAdapter: TabAskAdapter<PricingAskParams> = {
  tab: 'pricing',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. labor rates for software engineer',
  examples: ['labor rates for software engineer', 'rates for NAICS 541512', 'project manager, help desk technician'],
  tabWords: [
    'labor rates', 'labor rate', 'hourly rates', 'hourly rate', 'pay rates', 'pay rate', 'rates', 'rate',
    'pricing intel', 'pricing', 'labor categories', 'labor category', 'roles', 'role',
    // The tab's own mode label — "NAICS 541512" already yields the code; the word itself is not a role.
    'naics codes', 'naics code', 'naics',
  ],

  toQuery(ask) {
    if (reason(ask)) return null;
    if (ask.intent.naics.length) return { mode: 'naics', value: ask.intent.naics[0] };
    return { mode: 'role', value: ask.keywords.join(', ') };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    const facet = ask.intent.naics.length
      ? `NAICS ${ask.intent.naics[0]}`
      : `roles ${ask.keywords.map((k) => `“${k}”`).join(', ')}`;
    let line = `Mindy searched: ${facet} — ${countPhrase(count, NOUN)}`;
    if (ask.fiscalYears.length) {
      line += ` (${ask.fiscalYears.map((y) => `FY${y}`).join(', ')} isn’t a filter on this tab)`;
    }
    return line;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
