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

const BANNED = ['vault', 'reports'] as const;

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

  for (const slug of BANNED) {
    it(`no page links to /opportunity-map/${slug} from a rail or nav anchor`, () => {
      const offenders = RAIL_PAGES.filter((page) => navAnchors(read(page), slug).length > 0);
      expect(offenders, `${slug} is back in the nav on: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('the /today React chrome matches — it mirrors this rail and must not drift', () => {
    // MindyChrome.tsx re-implements the same rail in React. If it kept Vault/Reports the two
    // shells would disagree the moment a user crossed from the homepage into the map.
    const chrome = readFileSync(join(process.cwd(), 'src/components/today/MindyChrome.tsx'), 'utf8');
    for (const slug of BANNED) {
      expect(chrome, `MindyChrome still lists ${slug}`).not.toContain(`/opportunity-map/${slug}`);
    }
  });

  it('the pages themselves still EXIST — this removes nav, not features', () => {
    // The distinction that makes this safe to enforce: /opportunity-map/vault and .../reports keep
    // working at their URLs. A future "cleanup" that deletes them would fail here.
    for (const slug of BANNED) {
      const src = read(`${slug}/route.ts`);
      expect(src.length, `${slug} page was deleted — only the RAIL ENTRY should be gone`).toBeGreaterThan(1000);
    }
  });
});
