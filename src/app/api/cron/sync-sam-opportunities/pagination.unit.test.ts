/**
 * Guards SAM pagination semantics.
 *
 * THE BUG (2026-07-29 → 2026-08-04, seven days, silent):
 * SAM's `offset` parameter is a PAGE NUMBER, not a record offset. Our loop advanced
 * `offset += batchSize`, so its SECOND request asked for page 1000. SAM answered
 * HTTP 200 with an empty array, the loop's `length === 0` break fired, and the run
 * recorded status 'partial' with ZERO errors, null failed_offsets, null error_message.
 *
 * Nothing alerted. Every run made exactly 2 API calls and ingested exactly 1,000 of
 * ~23,000 available — about 4% of the daily feed — for a week.
 *
 * Proven against the live API 2026-08-04 (totalRecords 23,937, limit 1000):
 *   page 0  → 1000    page 22 → 1000
 *   page 1  → 1000    page 23 →  937   ← exact remainder of 23,937
 *   page 20 → 1000    page 24 →    0   ← past the end
 *   page 1000 → 0
 * A record-offset API would return records 1..1000 for offset=1 (overlapping page 0
 * by 999) and a FULL page at offset=23. It returned neither.
 *
 * An earlier fix (2026-08-03) diagnosed this as a Vercel function timeout and added
 * maxDuration=300. That was wrong: the runs complete in ~7 seconds, and they kept
 * fetching exactly 1,000 afterwards. Timeouts and page-semantics look identical from
 * the outside — both truncate after one page — which is why this file asserts the
 * arithmetic rather than the symptom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/sync-sam-opportunities/route.ts'),
  'utf8'
);

// The arithmetic the loop relies on, mirrored.
const lastPageFor = (total: number, limit: number) => Math.max(0, Math.ceil(total / limit) - 1);

describe('page arithmetic matches the live API', () => {
  it('23,937 records at 1000/page = pages 0..23', () => {
    // Verified against SAM: page 23 returned exactly 937 rows, page 24 returned 0.
    expect(lastPageFor(23937, 1000)).toBe(23);
  });

  it('an exact multiple does not produce a trailing empty page', () => {
    // 24,000 records = pages 0..23, all full. Asking for page 24 would waste a call.
    expect(lastPageFor(24000, 1000)).toBe(23);
  });

  it('a single partial page is page 0', () => {
    expect(lastPageFor(323, 1000)).toBe(0);   // the 1-day control window
    expect(lastPageFor(1, 1000)).toBe(0);
  });

  it('zero records yields page 0, never -1', () => {
    // A negative bound would make `page <= lastPage` false immediately — correct —
    // but Math.max guards against it being used as an index anywhere else.
    expect(lastPageFor(0, 1000)).toBe(0);
  });
});

describe('legacy checkpoint migration', () => {
  // last_successful_offset in the DB holds RECORD offsets written by the old code.
  // Resuming from a raw 1000 would ask for page 1000 — reintroducing the exact bug.
  const toPage = (stored: number, batchSize: number) =>
    stored >= batchSize ? Math.floor(stored / batchSize) : stored;

  it('converts a stored record offset to a page', () => {
    expect(toPage(1000, 1000)).toBe(1);
    expect(toPage(24000, 1000)).toBe(24);
  });

  it('leaves an already-page-shaped checkpoint alone', () => {
    expect(toPage(0, 1000)).toBe(0);
    expect(toPage(5, 1000)).toBe(5);
    expect(toPage(23, 1000)).toBe(23);
  });
});

describe('the route uses page semantics', () => {
  it('advances by ONE page, never by batchSize', () => {
    expect(SRC, 'offset += batchSize is the bug').not.toMatch(/offset\s*\+=\s*batchSize/);
    expect(SRC).toMatch(/page\s*\+=\s*1/);
  });

  it('bounds the loop by page count, not record count', () => {
    expect(SRC).toContain('Math.ceil(totalAvailable / batchSize) - 1');
    expect(SRC, 'a record-count bound loops ~23,000 times').not.toMatch(/while\s*\(\s*offset\s*<\s*totalAvailable/);
  });

  it('migrates legacy record-offset checkpoints on resume', () => {
    expect(SRC).toMatch(/startOffset\s*>=\s*batchSize\s*\?\s*Math\.floor\(startOffset\s*\/\s*batchSize\)/);
  });

  it('documents the page semantics so it cannot be silently reverted', () => {
    expect(SRC).toContain('PAGE NUMBER, not a record offset');
  });
});
