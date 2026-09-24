/**
 * DHS APFS identity — the republish `*` is never identity (tasks/dhs-forecast-identity-2026-09-24.md).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalDhsApfsNumber, canonicalDhsExternalId, isDhsRepublished } from './dhs-identity';

describe('canonical DHS identity', () => {
  it('a republished record keeps the SAME identity as its first publication', () => {
    expect(canonicalDhsApfsNumber('*F2026073903')).toBe('F2026073903');
    expect(canonicalDhsApfsNumber('F2026073903')).toBe('F2026073903');
    expect(canonicalDhsApfsNumber('  **F2025070120 ')).toBe('F2025070120');
    expect(canonicalDhsApfsNumber('f2026073449')).toBe('F2026073449');
  });
  it('the republish flag is readable but never identity', () => {
    expect(isDhsRepublished('*F2026073903')).toBe(true);
    expect(isDhsRepublished('F2026073903')).toBe(false);
  });
  it('fallbacks are unchanged when DHS omits the APFS number', () => {
    expect(canonicalDhsApfsNumber('')).toBeNull();
    expect(canonicalDhsApfsNumber('*')).toBeNull();
    expect(canonicalDhsExternalId(null, 74690, 'X')).toBe('74690');
    expect(canonicalDhsExternalId(undefined, null, 'Edge Computing Support for cUAS')).toBe('DHS:Edge Computing Support for cUAS');
  });
});

describe('every live DHS ingest path uses the canonical identity', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('cron/sync-forecasts', () => {
    const s = read('src/app/api/cron/sync-forecasts/route.ts');
    expect(s).toContain('canonicalDhsExternalId(');
    expect(s).not.toMatch(/external_id:\s*nn\(clean\(r\.apfs_number\)\)/);
  });
  it('scrapers/dhs-apfs', () => {
    expect(read('src/lib/forecasts/scrapers/dhs-apfs.ts')).toContain('canonicalDhsApfsNumber(');
  });
});

describe('post-migration republish updates the canonical row (executed: scripts/proofs/dhs-republish.pglite.ts)', () => {
  const route = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-forecasts/route.ts'), 'utf8');
  it('the sync upserts on (source_agency, external_id)', () => {
    expect(route).toContain(".upsert(batch, { onConflict: 'source_agency,external_id' })");
  });
  it('the DHS payload never carries created_at — an update keeps the original first-seen time', () => {
    const start = route.indexOf('async function fetchDHS');
    const body = route.slice(start, route.indexOf('\n}\n', start));
    expect(body).toContain('canonicalDhsExternalId(');
    expect(body).not.toMatch(/created_at/);
  });
});
