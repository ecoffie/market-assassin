// @vitest-environment jsdom
/** Today home (draft, default OFF): what the view shows, and "unavailable" — never 0 — when a read fails. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TodayView, type TodayViewProps } from './TodayPanel';

const noop = () => {};
const render = (over: Partial<TodayViewProps> = {}) => renderToStaticMarkup(
  <TodayView
    searches={{ state: 'ok', value: [{ id: 's1', name: 'Cyber at VA', newCount: 4, matchedCount: 22, capped: false }] }}
    matches={{ state: 'ok', value: [1, 2, 3].map((i) => ({ noticeId: String(i).repeat(32), title: `Opp ${i}`, buyer: 'GSA', deadline: '2026-12-04' })) }}
    onAskMindy={noop}
    onOpenMap={noop}
    onOpenWatchlist={noop}
    {...over}
  />,
);
const dom = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('Today view', () => {
  it('shows saved searches with what is new, three matches with Ask Mindy, and one Map link', () => {
    const d = dom(render());
    expect(d.querySelector('[data-testid="today-search"]')?.textContent).toContain('4 new since your last visit · 22 open matches');
    const matches = d.querySelectorAll('[data-testid="today-match"]');
    expect(matches).toHaveLength(3);
    for (const m of Array.from(matches)) expect(m.querySelector('button')?.textContent).toBe('Ask Mindy about this');
    expect(d.querySelectorAll('[data-testid="today-open-map"]')).toHaveLength(1);
  });

  it('a read that failed says unavailable and never shows a 0', () => {
    const html = render({ searches: { state: 'unavailable' }, matches: { state: 'unavailable' } });
    const d = dom(html);
    expect(d.querySelector('[data-testid="today-searches-unavailable"]')).not.toBeNull();
    expect(d.querySelector('[data-testid="today-matches-unavailable"]')).not.toBeNull();
    expect(d.querySelector('[data-testid="today-searches"]')?.textContent).not.toMatch(/\b0\b/);
    expect(d.querySelector('[data-testid="today-matches"]')?.textContent).not.toMatch(/\b0\b/);
  });

  it('loading shows a loading line, not numbers', () => {
    const html = render({ searches: { state: 'loading' }, matches: { state: 'loading' } });
    expect(html).toContain('Loading…');
    expect(html).not.toContain('data-testid="today-search"');
  });
});
