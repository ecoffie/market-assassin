/**
 * RES-003 is the Institute's ONLY public publication, and every figure on it is
 * an exact head-count over `sam_opportunities`. This pins the dependency so the
 * input cannot quietly lose its control-plane registration.
 *
 * Measured 2026-09-20: 215,066 rows, 34,684 active — and the published page
 * reports 34,684 active solicitations. Input and publication reconcile.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLICATIONS } from './research-publications';

const MIGRATION = 'supabase/migrations/20260920_sam_opportunities_source_instance.sql';

describe('RES-003 rests on a controlled input', () => {
  it('RES-003 is still the only published publication', () => {
    const published = PUBLICATIONS.filter((p) => p.status === 'published');
    expect(published.map((p) => p.id)).toEqual(['RES-003']);
    expect(published[0].slug).toBe('small-business-participation-benchmark');
  });

  it('its input is registered in the control plane', () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toContain("'sam_opportunities'");
    expect(sql).toContain('data_source_instances');
  });

  it('the advancement oracle reads the SOURCE date, never a Mindy timestamp', () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toMatch(/max\(posted_date\)/);
    // An ingest/refresh timestamp must not be the currentness signal.
    expect(sql).not.toMatch(/CURRENT_DATE\s*-\s*max\((updated_at|created_at|synced_at)\)/);
  });

  it('state is stamped FROM the oracle, not asserted as a literal', () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toMatch(/SELECT advancement_state FROM public\.sam_opportunities_advancement\(\)/);
  });

  it('a null source date is unmeasured, never current', () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toMatch(/WHEN max\(posted_date\) IS NULL\s+THEN 'unmeasured'/);
  });

  it('registration is idempotent', () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toContain('ON CONFLICT (source_key) DO NOTHING');
  });
});
