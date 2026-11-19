// @vitest-environment jsdom
/** Today's 3 (owner, 2026-11-19): three picks from the newest briefing, Pursue / Pass, M-Win only when grounded. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TodaysThree, { oddsLabel, storageKey, todayKey } from './TodaysThree';

const noop = () => {};
const picks = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, title: `Opportunity ${i}`, buyer: 'GSA', deadline: 'Dec 4' }));
const render = (over: Partial<Parameters<typeof TodaysThree>[0]> = {}) => renderToStaticMarkup(
  <TodaysThree email="a@b.com" picks={picks} alreadyPursued={() => false} getAuthHeaders={() => ({})} onPursue={noop} onPass={noop} {...over} />,
);
const dom = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe("Today's 3", () => {
  it('shows exactly three picks, each with Pursue and Pass', () => {
    const d = dom(render());
    expect(d.querySelectorAll('[data-testid="todays-three-card"]')).toHaveLength(3);
    expect(Array.from(d.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Pursue', 'Pass', 'Pursue', 'Pass', 'Pursue', 'Pass']);
  });

  it('renders nothing without picks', () => {
    expect(render({ picks: [] })).toBe('');
  });

  it('a pick already in the pipeline counts as Pursued', () => {
    const html = render({ alreadyPursued: (id) => id === 'n0' });
    expect(html).toContain('In My Pursuits');
    expect(html).toContain('1 of 3 decided');
  });

  it('done for today once every pick is decided', () => {
    expect(render({ alreadyPursued: () => true })).toContain('data-testid="todays-three-done"');
  });

  it('shows M-Win only when the server says it is grounded — never a made-up number', () => {
    expect(oddsLabel({ grounded: true, score: 61.6 })).toBe('M-Win 62%');
    expect(oddsLabel({ grounded: false, score: 30 })).toBeNull();
    expect(oddsLabel(null)).toBeNull();
    expect(oddsLabel({ grounded: true })).toBeNull();
  });

  it('remembers decisions per person per day', () => {
    expect(todayKey(new Date(2026, 10, 19, 9))).toBe('2026-11-19');
    expect(storageKey('A@B.com', '2026-11-19')).toBe('mindy_todays3:a@b.com:2026-11-19');
  });
});
