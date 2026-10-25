/**
 * GUARD — the "⭐ Best fit for you" card's "View opportunity" must open THAT opportunity.
 *
 * Customer report 2026-10-25: the click landed on a profile-wide list of 604 matches
 * (the Source Feed) because CollabHotCard dropped hot.noticeId for every non-Sources-Sought
 * card. See src/lib/today/best-fit-link.ts and docs/engineering/record-links-vs-market-links.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bestFitAction, bestFitViewHref } from './best-fit-link';

const ID = '51ef97706881437ca7bef12a9760fca2';
const MARKET_KEYS = ['naics', 'state', 'agency', 'subAgency', 'ss', 'strategy', 'setAside', 'psc', 'q', 'mode', 'horizon', 'posted'];

const card = (over: Partial<Parameters<typeof bestFitAction>[0]> = {}) => ({
  noticeId: ID, title: 'USCG Cutter Maintenance', agency: 'HOMELAND SECURITY', isSourcesSought: false, ...over,
});

describe('bestFitViewHref — a record link names the record and nothing else', () => {
  it('a canonical 32-hex notice id → /opportunity-map?opp=<id>, exactly', () => {
    expect(bestFitViewHref(ID)).toBe(`/opportunity-map?opp=${ID}`);
  });

  it('the only query key is `opp` — no market param can ride along and exclude the record', () => {
    const href = bestFitViewHref(ID)!;
    const u = new URL(href, 'https://getmindy.ai');
    expect(u.pathname).toBe('/opportunity-map');
    expect([...u.searchParams.keys()]).toEqual(['opp']);
    for (const k of MARKET_KEYS) expect(u.searchParams.has(k)).toBe(false);
    expect(u.searchParams.get('opp')).toBe(ID);
  });

  it('uppercase hex is accepted and preserved verbatim (same id, not rewritten)', () => {
    expect(bestFitViewHref(ID.toUpperCase())).toBe(`/opportunity-map?opp=${ID.toUpperCase()}`);
  });

  it('surrounding whitespace is trimmed, not encoded into the id', () => {
    expect(bestFitViewHref(`  ${ID}\n`)).toBe(`/opportunity-map?opp=${ID}`);
  });

  it.each([
    ['demo card id', 'demo-collab'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['31 chars', ID.slice(1)],
    ['33 chars', ID + 'a'],
    ['non-hex char', ID.slice(0, 31) + 'g'],
    ['forecast id', 'fc-12345'],
    ['solicitation number', 'W912PL26R0001'],
    ['injection attempt', `${ID}&naics=541512`],
    ['path traversal', '../../admin'],
  ])('invalid id (%s) → null, never a guessed link', (_label, bad) => {
    expect(bestFitViewHref(bad as string | null | undefined)).toBeNull();
  });
});

describe('bestFitAction — routing per card type', () => {
  it('ordinary opportunity → record link carrying the SAME id the card holds', () => {
    const a = bestFitAction(card());
    expect(a).toEqual({ kind: 'record', href: `/opportunity-map?opp=${ID}`, noticeId: ID });
  });

  it('Sources Sought → unchanged Proposal Assist workflow with the notice context', () => {
    const a = bestFitAction(card({ isSourcesSought: true }));
    expect(a).toEqual({
      kind: 'sources_sought',
      panel: 'proposals',
      context: { noticeId: ID, title: 'USCG Cutter Maintenance', agency: 'HOMELAND SECURITY', isSourcesSought: true },
    });
  });

  it('Sources Sought wins even when the id is a valid notice id (workflow preserved)', () => {
    expect(bestFitAction(card({ isSourcesSought: true })).kind).toBe('sources_sought');
  });

  it('demo / invalid id on an ordinary card → feed fallback (never a broken map link)', () => {
    expect(bestFitAction(card({ noticeId: 'demo-collab' }))).toEqual({ kind: 'feed', panel: 'alerts' });
    expect(bestFitAction(card({ noticeId: null }))).toEqual({ kind: 'feed', panel: 'alerts' });
  });
});

describe('CollabHotCard is wired to the helper (source guard)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/components/app/CollabHotCard.tsx'), 'utf8');
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('reads the real file', () => {
    expect(SRC.length).toBeGreaterThan(2_000);
  });

  it('routes through bestFitAction', () => {
    expect(code).toContain("from '@/lib/today/best-fit-link'");
    expect(code).toMatch(/bestFitAction\(hot\)/);
  });

  it('the record CTA is a real link to action.href (not a panel switch)', () => {
    expect(code).toMatch(/action\?\.kind === 'record'/);
    expect(code).toMatch(/href=\{action\.href\}/);
  });

  it('never switches to the Source Feed unconditionally — only via the feed fallback', () => {
    expect(code).not.toMatch(/onPanelChange\?\.\(\s*'alerts'\s*\)/);
    expect(code).toMatch(/action\.kind === 'feed'\) onPanelChange\?\.\(action\.panel\)/);
  });

  it('the click event records the selected notice id', () => {
    expect(code).toMatch(/track\(\s*'link_click',\s*'todays_intel'/);
    expect(code).toMatch(/action:\s*'best_fit_view'/);
    expect(code).toMatch(/notice_id:\s*hot\.noticeId/);
    expect(code).toMatch(/onClick=\{trackClick\}/);
  });

  it('the feed fallback is labeled honestly ("View in Source Feed", not "View opportunity")', () => {
    expect(code).toContain("'View in Source Feed'");
  });
});
