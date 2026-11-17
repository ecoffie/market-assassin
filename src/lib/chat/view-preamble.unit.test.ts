import { describe, it, expect } from 'vitest';
import { splitViewPreamble, customerText, sessionTitleFrom, isViewPreambleTitle } from './view-preamble';
import { splitViewPreamble as fromCompiler } from './intent-compiler';

const VIEW = '[Current map view — 853+ Open Now opps in view. Location: the map area is in VA, MD, PA (plotted pins in view, most first: VA 312, MD 140, PA 90). Answer for THIS view when the question is about "these"/"this"/"here": use this location.]\n\n';

describe('view preamble', () => {
  it('splits the preamble from the customer text', () => {
    expect(splitViewPreamble(VIEW + 'Who buys here?')).toEqual({ view: VIEW, rest: 'Who buys here?' });
    expect(splitViewPreamble('Who buys here?')).toEqual({ view: null, rest: 'Who buys here?' });
  });
  it('matches intent-compiler exactly (the model-side copy; both must recognise the same preamble)', () => {
    for (const t of [VIEW + 'Who buys here?', VIEW, 'Who buys here?', '  ' + VIEW + 'q', 'Why did it say [Current map view — x]?', '', '[Current map view — 3 opps]']) {
      expect(splitViewPreamble(t)).toEqual(fromCompiler(t));
    }
  });
  it('customerText is what the customer typed', () => {
    expect(customerText(VIEW + 'Who buys here?')).toBe('Who buys here?');
    expect(customerText('  plain question ')).toBe('  plain question ');
    expect(customerText('')).toBe('');
  });
  it('only a LEADING preamble is removed (a customer quoting it mid-message keeps their words)', () => {
    const quoted = 'Why did it say [Current map view — x]?';
    expect(customerText(quoted)).toBe(quoted);
  });
  it('the session title comes from the typed text', () => {
    expect(sessionTitleFrom(VIEW + 'Who buys janitorial work here?')).toBe('Who buys janitorial work here?');
    expect(sessionTitleFrom(VIEW + 'a'.repeat(80))).toBe('a'.repeat(60));
    expect(sessionTitleFrom('Line one\n\nline   two')).toBe('Line one line two');
  });
  it('a preamble-only message never becomes a preamble title', () => {
    expect(sessionTitleFrom(VIEW)).toBe('');
    expect(isViewPreambleTitle(sessionTitleFrom(VIEW))).toBe(false);
  });
  it('recognises the titles the old code stored (first 60 chars of the preamble)', () => {
    expect(isViewPreambleTitle((VIEW + 'q').slice(0, 60).replace(/\s+/g, ' ').trim())).toBe(true);
    expect(isViewPreambleTitle('Who buys here?')).toBe(false);
    expect(isViewPreambleTitle(null)).toBe(false);
  });
});
