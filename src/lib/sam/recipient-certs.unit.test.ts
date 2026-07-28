/**
 * Company set-aside chips come from SAM's REAL certifications by UEI (Eric 2026-07-28: SAM.gov is the
 * source of truth, not award inference). certBuckets maps the cert flags → the map's chip buckets; a
 * SAM-registered firm with no small-biz cert (SAIC) yields [] (no chip), un-foolable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { certBuckets, type RecipientCert } from './recipient-certs';

const cert = (o: Partial<RecipientCert>): RecipientCert =>
  ({ uei: 'X', found: true, is8a: false, isSdvosb: false, isWosb: false, isHubzone: false, ...o });

describe('certBuckets — SAM certs → chip buckets', () => {
  it('SAIC (registered, no small-biz cert) → NO chip', () => {
    expect(certBuckets(cert({ found: true }))).toEqual([]);
  });
  it('a real SDVOSB firm → SDVOSB chip', () => {
    expect(certBuckets(cert({ isSdvosb: true }))).toEqual(['SDVOSB']);
  });
  it('a firm with multiple certs → all of them, ranked', () => {
    expect(certBuckets(cert({ is8a: true, isSdvosb: true, isHubzone: true }))).toEqual(['8A', 'SDVOSB', 'HZ']);
  });
  it('an UNresolved UEI (no SAM record / null) → [] (caller falls back to award-share)', () => {
    expect(certBuckets(null)).toEqual([]);
    expect(certBuckets(cert({ found: false, isSdvosb: true }))).toEqual([]); // found=false never chips
  });
});

describe('certBackfillQueue — seed cap raised + windowed walk (no plateau)', () => {
  // Source-level assertions (the queue needs BigQuery + Supabase to run live). Eric 2026-07-28: the
  // backfill plateaued at ~983 firms because the seed was LIMIT 3000 and, once the top ~983 were fresh,
  // the queue went empty. Fix: raise the cap AND walk the seed in windows so a resolved front doesn't
  // starve the 49K firms behind it.
  const src = readFileSync(join(__dirname, 'recipient-certs.ts'), 'utf8');
  it('seed cap is 50000, not the old 3000', () => {
    expect(src).toContain('LIMIT 50000');
    expect(src).not.toContain('LIMIT 3000');
  });
  it('the queue WALKS the seed in bounded windows (advances past a fully-resolved front)', () => {
    expect(src).toContain('for (let start = 0; start < allSeed.length && picked.length < limit; start += WINDOW)');
    expect(src).toContain('const WINDOW = Math.max(limit * 8, 400)');
    // never-checked first (new coverage), then stale.
    expect(src).toContain('for (const u of never)');
    expect(src).toContain('for (const u of stale)');
  });
});
