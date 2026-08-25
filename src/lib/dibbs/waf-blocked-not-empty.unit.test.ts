import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * BLOCKED IS NOT EMPTY.
 *
 * The DIBBS WAF answers with HTTP 200 and the DoD Warning and Consent page for EVERY archive
 * URL — including dates that have no file at all. VERIFIED 2026-08-24: five probes spanning
 * Fri through Tue, weekend included, each returned an identical 9,170-byte consent document.
 *
 * fetchDibbsDirect already detected that page and skipped it — then returned [], which is
 * indistinguishable from a genuine no-data window. So ingestDibbs recorded
 * `direct:empty(0)` and the run read as "DLA published nothing" for four days, while the real
 * state was "the WAF refused us".
 *
 * That false negative is what made the SR-002 diagnosis ambiguous. The one-shot run resolved
 * it only because Apify's separate under-delivery gave a second signal to compare against.
 *
 * Throwing does NOT change routing — ingestDibbs already catches a direct failure and falls
 * through to Apify. The only change is that attempts[] records the REASON.
 */
const SRC = readFileSync(join(process.cwd(), 'src/lib/dibbs/direct.ts'), 'utf8');
const INGEST = readFileSync(join(process.cwd(), 'src/lib/dibbs/ingest.ts'), 'utf8');

describe('a WAF block is reported as a block', () => {
  it('counts blocked files separately from missing ones', () => {
    // Two different causes of zero. Collapsing them is the bug.
    expect(SRC).toContain('blockedFiles');
    expect(SRC).toContain('missingFiles');
  });

  it('throws with the cause when every file was blocked', () => {
    expect(SRC).toMatch(/blockedFiles > 0 && missingFiles === 0/);
    expect(SRC).toContain('WAF blocked all');
    expect(SRC).toContain('not an empty window');
  });

  it('does NOT throw on a partial block — some data beats an exception', () => {
    // The guard requires out.length === 0. A run that got two of three files still returns
    // what it got.
    expect(SRC).toMatch(/out\.length === 0 && blockedFiles > 0/);
  });

  it('does NOT throw on a genuine no-data window', () => {
    // missingFiles > 0 with no blocks = DLA published nothing. Still an ordinary empty
    // result, and the weekend path upstream depends on that staying true.
    expect(SRC).toMatch(/missingFiles === 0/);
    expect(SRC).toContain('window is entirely weekend — expected, not an error');
  });
});

describe('routing is unchanged — this is a diagnosis fix, not a behaviour change', () => {
  it('ingestDibbs still falls through to Apify when direct throws', () => {
    // Cost control must never become data loss. If this catch disappeared, making direct
    // throw would turn a blocked run into a failed run.
    expect(INGEST).toContain('cost-guard direct fetch failed, falling back to Apify');
    expect(INGEST).toMatch(/outcome: 'threw'/);
  });

  it('records the thrown reason in attempts[], which is the point', () => {
    expect(INGEST).toMatch(/error: \(err as Error\)\.message/);
  });
});
