// @vitest-environment jsdom
/** Your ranking card: every state says what it is. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RankingView, money } from './YourRankingCard';

const ok = {
  status: 'ok' as const, uei: 'ABC123DEF456',
  ranking: { uei: 'ABC123DEF456', name: 'ACME LLC', state: 'FL', totalObligated: 12_400_000, rankAll: 4210, countAll: 317_402, rankState: 38, countState: 9210, since: '2007-10-01', asOf: '2026-04-23' },
};

describe('RankingView', () => {
  it('shows overall + state rank, lifetime dollars and what "lifetime" covers', () => {
    const html = renderToStaticMarkup(<RankingView data={ok} />);
    expect(html).toContain('#4,210');
    expect(html).toContain('of 317,402 · top 2%');
    expect(html).toContain('In FL');
    expect(html).toContain('#38');
    expect(html).toContain('$12.4M');
    expect(html).toContain('since 2007');
    expect(html).toContain('data through Apr 2026');
  });

  it('asks for a UEI when the Vault has none', () => {
    expect(renderToStaticMarkup(<RankingView data={{ status: 'no_uei' }} onAddUei={() => {}} />)).toContain('Add my UEI');
  });

  it('never shows a rank when the data is unavailable or the UEI is unknown', () => {
    const un = renderToStaticMarkup(<RankingView data={{ status: 'unavailable' }} />);
    const nf = renderToStaticMarkup(<RankingView data={{ status: 'not_found', uei: 'ABC123DEF456' }} />);
    expect(un).not.toMatch(/#[0-9]/);
    expect(nf).not.toMatch(/#[0-9]/);
    expect(un).toContain('unavailable right now');
  });

  it('formats money', () => {
    expect(money(1_250_000_000)).toBe('$1.3B');
    expect(money(950_000)).toBe('$950K');
  });
});
