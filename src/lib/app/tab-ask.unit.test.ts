/**
 * Ask Mindy on a tab — the pure contract and the Forecasts adapter.
 * A plain question becomes the tab's OWN params (never a guess); anything the tab's filters can't say
 * returns null so the box hands off to chat; an unknown count is never shown as 0.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { countPhrase, isTabAskEnabled, parseTabAsk } from './tab-ask';
import { forecastsAskAdapter as A, type ForecastsAskParams } from './tab-ask-adapters/forecasts';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));
const blank: ForecastsAskParams = { naics: '', agency: '', search: '', state: '', setAside: '' };

describe('isTabAskEnabled', () => {
  const prev = process.env.NEXT_PUBLIC_TAB_ASK;
  afterEach(() => { if (prev === undefined) delete process.env.NEXT_PUBLIC_TAB_ASK; else process.env.NEXT_PUBLIC_TAB_ASK = prev; });

  it('is OFF by default and for anything but the exact value "on"', () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    expect(isTabAskEnabled()).toBe(false);
    for (const v of ['true', '1', 'ON', 'yes', '']) { process.env.NEXT_PUBLIC_TAB_ASK = v; expect(isTabAskEnabled()).toBe(false); }
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    expect(isTabAskEnabled()).toBe(true);
  });
});

describe('parseTabAsk (canonical discovery underneath)', () => {
  it('pulls buyer, place, set-aside and NAICS through extractStructuredIntent', () => {
    const a = ask('541512 small business in texas');
    expect(a.intent.naics).toEqual(['541512']);
    expect(a.intent.setAsides).toEqual(['sb']);
    expect(a.intent.states).toEqual(['TX']);
    expect(a.keywords).toEqual([]);
  });

  it('a fiscal year never becomes a keyword', () => {
    const a = ask('Navy cybersecurity forecasts for FY2027');
    expect(a.fiscalYears).toEqual(['2027']);
    expect(a.keywords).toEqual(['cybersecurity']);
    expect(ask('cyber in fiscal year 26').fiscalYears).toEqual(['2026']);
  });

  it('tab nouns and question words are not search terms', () => {
    expect(ask('what forecasts does the navy have for cybersecurity').keywords).toEqual(['cybersecurity']);
    expect(ask('show me upcoming VA IT help desk buys').keywords).toEqual(['it help desk']);
  });

  it('keeps comma alternatives apart', () => {
    expect(ask('cloud, cyber at DHS').keywords).toEqual(['cloud', 'cyber']);
  });
});

describe('Forecasts adapter: question → the tab\'s own params', () => {
  it.each<[string, Partial<ForecastsAskParams>]>([
    ['Navy cybersecurity', { agency: 'NAVY', search: 'cybersecurity' }],
    ['what forecasts does the navy have for cybersecurity', { agency: 'NAVY', search: 'cybersecurity' }],
    ['janitorial services in Florida 8(a)', { search: 'janitorial', state: 'FL', setAside: '8(a)' }],
    ['541512 small business in texas', { naics: '541512', state: 'TX', setAside: 'Small Business' }],
    ['VA IT help desk, small business', { agency: 'VA', search: 'it help desk', setAside: 'Small Business' }],
    ['NAVSEA ship repair', { agency: 'NAVSEA', search: 'ship repair' }],
    ['HUBZone construction in Georgia and Florida', { search: 'construction', state: 'FL, GA', setAside: 'HUBZone' }],
  ])('%s', (q, expected) => {
    expect(query(q)).toEqual({ ...blank, ...expected });
  });

  it('only uses the set-aside values the tab\'s own dropdown offers', () => {
    const values = ['janitorial 8a', 'janitorial hubzone', 'janitorial sdvosb', 'janitorial small business']
      .map((q) => query(q)?.setAside);
    expect(values).toEqual(['8(a)', 'HUBZone', 'SDVOSB', 'Small Business']);
  });

  it.each([
    ['cloud, cyber at DHS', 'one phrase'],
    ['recompetes expiring at the army for logistics', 'expiring contracts'],
    ['how do I win navy work', 'question for Mindy'],
    ['what is the best way to win', 'question for Mindy'],
    ['women owned construction in Georgia', 'set-aside'],
    ['R408 at GSA', 'PSC'],
    ['cybersecurity -training', 'exclude'],
    ['FY27', 'fiscal year alone'],
    ['', 'Type what you sell'],
  ])('cannot express "%s" → null (chat handoff), with a reason', (q, why) => {
    expect(query(q)).toBeNull();
    expect(A.whyNot(ask(q))).toContain(why);
  });

  it('summary says what Mindy searched and how many rows', () => {
    expect(A.summary(ask('Navy cybersecurity'), { shown: 14, more: false }))
      .toBe('Mindy searched: Navy · cybersecurity — 14 upcoming buys');
    expect(A.summary(ask('VA IT help desk, small business'), { shown: 1, more: false }))
      .toBe('Mindy searched: VA · it help desk · Small business — 1 upcoming buy');
  });

  it('says out loud that a fiscal year was not applied', () => {
    expect(A.summary(ask('Navy cybersecurity FY2027'), { shown: 14, more: false }))
      .toBe('Mindy searched: Navy · cybersecurity — 14 upcoming buys (FY2027 isn’t a filter on this tab, so all years are shown)');
  });

  it('an unknown count is "unavailable", never 0; a capped list says so', () => {
    const s = A.summary(ask('Navy cybersecurity'), null);
    expect(s).toContain('count unavailable');
    expect(s).not.toMatch(/\b0\b/);
    expect(countPhrase({ shown: 200, more: true }, A.noun)).toBe('200+ upcoming buys (showing the first 200)');
  });

  it('every example chip is expressible by the tab', () => {
    for (const ex of A.examples) expect(query(ex), ex).not.toBeNull();
  });
});
