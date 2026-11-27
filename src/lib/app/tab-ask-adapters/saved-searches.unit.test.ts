import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import {
  WATCHLIST_SEARCHES_MESSAGE,
  matchSavedSearches,
  parseWatchlistSearchesMessage,
  savedSearchesAskAdapter as adapter,
  type SavedSearchLite,
} from './saved-searches';

const ask = (q: string) => parseTabAsk(q, adapter.tabWords);
const query = (q: string) => adapter.toQuery(ask(q));

// Stored filters use the map's own keys (parseMapFilters): agency · naics · psc · state · setAside · q.
const SEARCHES: SavedSearchLite[] = [
  { id: 's1', name: 'Navy cyber', filters: { agency: 'Department of the Navy', q: 'cybersecurity', state: 'VA' } },
  { id: 's2', name: 'All-agency IT', filters: { naics: '541512,541519' } },
  { id: 's3', name: 'Florida janitorial Search', filters: { q: 'janitorial', state: 'FL,GA', setAside: 'SB' } },
  { id: 's4', name: 'Army construction', filters: { agency: 'ARMY', naics: '236220', setAside: '8A' } },
  { id: 's5', name: 'Codes only', filters: { psc: 'D310' } },
];
const ids = (q: string) => matchSavedSearches(SEARCHES, query(q)!);

describe('Saved searches adapter — question → stored-filter match', () => {
  it('every example is expressible on this tab', () => {
    for (const ex of adapter.examples) expect(query(ex), ex).not.toBeNull();
  });

  it('a buyer matches only searches that NAME it (an all-agency search is not a Navy search)', () => {
    expect(ids('Navy')).toEqual(['s1']);
    expect(ids('which of my saved searches cover the Navy?')).toEqual(['s1']);
  });

  it('keyword + state AND together; keywords match the name or stored keyword', () => {
    expect(ids('cybersecurity in Virginia')).toEqual(['s1']);
    expect(ids('janitorial in Florida')).toEqual(['s3']);
    expect(ids('janitorial in Virginia')).toEqual([]);
  });

  it('keyword alternatives OR together', () => {
    expect(ids('janitorial, construction')).toEqual(['s3', 's4']);
  });

  it('NAICS prefix either way, set-aside via the map\'s stored codes, PSC prefix', () => {
    expect(ids('NAICS 541512')).toEqual(['s2']);
    expect(ids('small business')).toEqual(['s3']);
    expect(ids('8(a) construction')).toEqual(['s4']);
    expect(query('PSC D310')?.psc).toEqual(['D310']);
    expect(ids('PSC D310')).toEqual(['s5']);
  });

  it('cannot be expressed → null with a plain reason (chat handoff), never a guess', () => {
    for (const q of ['how should I price a Navy bid', 'recompetes for the Army', 'IT -staffing', 'FY2027', '']) {
      expect(query(q), q).toBeNull();
      expect(adapter.whyNot(ask(q)), q).not.toBe('');
    }
  });

  it('summary names what Mindy searched; an unknown count is never 0; a fiscal year is called out', () => {
    expect(adapter.summary(ask('Navy cybersecurity'), { shown: 1, more: false }))
      .toBe('Mindy searched your saved searches for: Navy · cybersecurity — 1 saved search');
    const unknown = adapter.summary(ask('Navy'), null);
    expect(unknown).toContain('count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
    expect(adapter.summary(ask('Navy FY2027'), { shown: 1, more: false })).toContain('FY2027 isn’t part of a saved search');
  });

  it('parses only well-formed list messages from the page', () => {
    expect(parseWatchlistSearchesMessage({ type: 'other', searches: [] })).toBeNull();
    expect(parseWatchlistSearchesMessage(null)).toBeNull();
    expect(parseWatchlistSearchesMessage({
      type: WATCHLIST_SEARCHES_MESSAGE,
      searches: [{ id: 7, name: 'A', filters: { q: 'x' } }, { name: 'no id' }, { id: 'b', filters: ['bad'] }],
    })).toEqual([{ id: '7', name: 'A', filters: { q: 'x' } }, { id: 'b', name: '', filters: {} }]);
  });
});
