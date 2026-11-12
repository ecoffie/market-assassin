/**
 * THE MAP RAIL IS A CLOSED SET — Vault and Reports must stay OUT of it.
 *
 * Eric 2026-08-15, looking at the live map: *"on the left side bar the vault should not be there
 * and we discussed also not putting reports there but through another mean but **it keeps
 * resurfacing**."*
 *
 * That last clause is the actual defect. This file REPLACES `vault-rail.unit.test.ts`, which two
 * days earlier asserted the exact OPPOSITE — that Vault was present on all nine rails. A guard
 * pointed the wrong way doesn't merely fail to help; it actively re-imposes the thing that was
 * rejected, which is how "we discussed this" becomes "it's back again."
 *
 * THE RULE: the rail is the DISCOVERY workspace — the two maps, plus the three things you
 * accumulate while browsing (Watchlist / Saved / Pursuits). The Vault is company-profile SETUP and
 * Reports is an OUTPUT ARTIFACT. Neither is a place you navigate to mid-browse, so neither earns a
 * permanent slot in the browsing chrome.
 *
 * NOT A DELETION: both pages still exist and still work at their own URLs, and stay reachable from
 * /app. Only the rail entry is gone. Asserting the absence of a NAV ANCHOR (rather than of the
 * bare string) is what keeps those pages' own rendering intact while still blocking the nav entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every page that renders the workspace rail. Each carries its OWN copy — that duplication is
 * precisely why this needs a test: removing the item from the map alone would leave it showing on
 * Watchlist and Pursuits, and a half-removal reads as a bug rather than a decision.
 * If a new sub-view ships with a rail, add it here.
 */
const RAIL_PAGES = [
  'route.ts',
  'favorites/route.ts',
  'forecasts/route.ts',
  'saved/route.ts',
  'market/route.ts',
  'proposal/route.ts',
  'reports/route.ts',
  'pursuits/route.ts',
  'vault/route.ts',
];

/**
 * Vault is banned EVERYWHERE in the map chrome — it's company-profile setup, reachable from /app.
 * Reports is banned from the RAIL but ALLOWED in the top nav, where it is labelled "Markets"
 * (Eric 2026-08-15: "put reports back on the top bar and rename it to markets" — that top-bar slot
 * IS the "another mean" the earlier note referred to).
 *
 * Nav and rail are different promises: the NAV is where you CHOOSE to go, the RAIL is what follows
 * you while you browse. Encoding that split is the whole point — a blanket ban would have made the
 * correct fix fail this test, and a blanket allow would let Reports drift back into the rail.
 */
const BANNED_EVERYWHERE = ['vault'] as const;
const BANNED_FROM_RAIL_ONLY = ['reports'] as const;

/**
 * The rail MARKUP is `<nav class="zrail">…</nav>`; the top nav is `<nav class="zh-left">`.
 *
 * ⚠️ Match the OPENING TAG, not the bare word "zrail". Every page defines a `.zrail{…}` CSS rule
 * thousands of characters BEFORE the markup, so `indexOf('zrail')` lands in the stylesheet and the
 * slice then swallows the top nav — which made this guard report "reports is back in the RAIL" on
 * eight pages that had only ever gained a legitimate top-nav Markets link. The guard was right to
 * fail; the helper was wrong. Anchor on the tag.
 */
function railBlock(src: string): string {
  const m = src.match(/<nav[^>]*class="zrail"[^>]*>/);
  if (!m || m.index == null) return '';
  const start = m.index;
  const end = src.indexOf('</nav>', start);
  return src.slice(start, end > start ? end : start + 4000);
}

function read(page: string): string {
  return readFileSync(join(process.cwd(), 'src/app/opportunity-map', page), 'utf8');
}

/** An <a> element pointing at the page — the NAV ENTRY, not a mere mention of the word. */
function navAnchors(src: string, slug: string): string[] {
  return src.split('\n').filter((l) => l.includes(`opportunity-map/${slug}`) && /<a\b/.test(l));
}

describe('map rail — Vault and Reports stay OUT (all 9 copies)', () => {
  it('read the real rail files (a vacuous pass would hide every assertion below)', () => {
    for (const page of RAIL_PAGES) {
      const src = read(page);
      expect(src.length, `${page} unexpectedly tiny`).toBeGreaterThan(1000);
      // Prove the rail itself is still here — otherwise "no vault anchor" passes trivially
      // because the whole nav got deleted.
      expect(navAnchors(src, 'pursuits').length, `${page} lost its rail entirely`).toBeGreaterThan(0);
    }
  });

  for (const slug of BANNED_EVERYWHERE) {
    it(`no page links to /opportunity-map/${slug} from ANY rail or nav anchor`, () => {
      const offenders = RAIL_PAGES.filter((page) => navAnchors(read(page), slug).length > 0);
      expect(offenders, `${slug} is back in the nav on: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  for (const slug of BANNED_FROM_RAIL_ONLY) {
    it(`/opportunity-map/${slug} stays OUT of the left rail on every page`, () => {
      // Scoped to the rail block, so the legitimate top-nav "Markets" link doesn't trip it.
      const offenders = RAIL_PAGES.filter((page) => navAnchors(railBlock(read(page)), slug).length > 0);
      expect(offenders, `${slug} is back in the RAIL on: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('Markets (the /reports route) is still reachable from the map, labelled "Markets"', () => {
    // The map's link row was removed 2026-11-12 ("make sure you can still access everything").
    // Markets now lives in the account menu (desktop) and the phone drawer — never the rail.
    // Renaming the route would break Share links and saved bookmarks, so only the LABEL is "Markets".
    const src = read('route.ts');
    const menu = read('account-menu.ts');
    expect(menu).toContain('<a href="/opportunity-map/reports" role="menuitem">');
    expect(menu).toMatch(/<\/svg>Markets<\/a>/);
    expect(src).toMatch(/<a href="\/opportunity-map\/reports"><svg[^']*<\/svg>Markets<\/a>/);
    expect(src).not.toContain('<a href="/opportunity-map/reports">Reports</a>');
  });

  it('every destination of the removed map row still has a way in', () => {
    const src = read('route.ts');
    const menu = read('account-menu.ts');
    // Opportunities + Players: the dataset dropdown in the filter bar (Players stays gated).
    expect(src).toContain('<option value="open" selected>Opportunities</option>');
    expect(src).toContain('<option value="companies">Players</option>');
    expect(src).toContain("if((v==='companies'||v==='buyers')&&typeof window.__playersGate==='function')");
    // Pursuits: the rail + the account menu.
    expect(railBlock(src)).toContain('href="/opportunity-map/pursuits"');
    expect(menu).toContain('<a href="/opportunity-map/pursuits" role="menuitem">');
  });

  it('sibling top-nav Players links to the canonical companies mode, not buyers', () => {
    // In-map Players nav already called __playersGate('companies'). Sibling pages (Markets,
    // Today, Vault, …) emitted ?mode=buyers, and the dataset pill has no buyers option, so
    // the dropdown went blank. Gold master = the in-map nav.
    const siblings = RAIL_PAGES.filter((p) => p !== 'route.ts');
    for (const page of siblings) {
      const src = read(page);
      expect(src, `${page} still emits ?mode=buyers`).not.toContain('href="/opportunity-map?mode=buyers"');
      expect(src, `${page} Players nav must land on companies`).toContain('href="/opportunity-map?mode=companies"');
    }
    const today = readFileSync(join(process.cwd(), 'src/app/today/route.ts'), 'utf8');
    expect(today).not.toContain('href="/opportunity-map?mode=buyers"');
    expect(today).toContain('href="/opportunity-map?mode=companies"');
  });

  it('/today matches — it renders the same rail and must not drift', () => {
    // /today is a ROUTE HANDLER now (PR #1127), so it carries its own copy of this rail. It used
    // to be MindyChrome.tsx; that component became dead code the moment the reframe landed and
    // has been deleted, so this reads the surface that actually ships.
    const chrome = readFileSync(join(process.cwd(), 'src/app/today/route.ts'), 'utf8');
    for (const slug of BANNED_EVERYWHERE) {
      expect(chrome, `/today still lists ${slug}`).not.toContain(`/opportunity-map/${slug}`);
    }
    // /today's chrome mirrors the map's TOP NAV too, so Markets must appear there as well or the
    // two shells disagree the moment a visitor crosses from the homepage into the map.
    expect(chrome, '/today is missing the Markets nav item').toContain('>Markets</a>');
  });

  it('the pages themselves still EXIST — this removes nav, not features', () => {
    // The distinction that makes this safe to enforce: /opportunity-map/vault and .../reports keep
    // working at their URLs. A future "cleanup" that deletes them would fail here.
    for (const slug of [...BANNED_EVERYWHERE, ...BANNED_FROM_RAIL_ONLY]) {
      const src = read(`${slug}/route.ts`);
      expect(src.length, `${slug} page was deleted — only the RAIL ENTRY should be gone`).toBeGreaterThan(1000);
    }
  });
});
