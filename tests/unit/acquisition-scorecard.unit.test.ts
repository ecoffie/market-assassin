/**
 * The scorecard must refuse to invent a zero when it cannot read production,
 * and it must not grow a write path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquisitionWindow, applyEnvFile, latencySummary } from '../../scripts/acquisition-scorecard.mjs';

describe('acquisitionWindow', () => {
  it('is seven UTC days ending the day after the given instant', () => {
    const w = acquisitionWindow(new Date('2026-11-18T19:53:00Z'));
    expect(w.days).toBe(7);
    expect(w.end).toBe('2026-11-19T00:00:00.000Z');
    expect(w.start).toBe('2026-11-12T00:00:00.000Z');
  });
});

describe('applyEnvFile', () => {
  it('reads a service-role style file and does not override an existing value', () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'already' };
    applyEnvFile('NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co"\nSUPABASE_SERVICE_ROLE_KEY=from-file\n# comment\n', env);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('already');
  });
});

describe('latencySummary', () => {
  it('reports median and p90 from the samples it was given', () => {
    const s = latencySummary([10, 1, 3, 8, 2]);
    expect(s.sample).toBe(5);
    expect(s.medianHours).toBe(3);
    expect(s.p90Hours).toBe(10);
  });

  it('an empty sample is null, not zero', () => {
    expect(latencySummary([])).toEqual({ medianHours: null, p90Hours: null, sample: 0 });
  });
});

describe('the script stays read-only', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/acquisition-scorecard.mjs'), 'utf8');

  it('has no insert, update, delete, upsert, or rpc, and only GETs PostgREST', () => {
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/\.upsert\(/);
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/from '@supabase\//);
    expect(src).not.toMatch(/from 'dotenv'/);
    expect(src).toContain("method: 'GET'");
    expect(src).toContain('/rest/v1/');
    expect(src).not.toMatch(/method:\s*'POST'/);
    expect(src).not.toMatch(/method:\s*'PATCH'/);
    expect(src).not.toMatch(/method:\s*'DELETE'/);
  });

  it('says unknown instead of zero when a count cannot be made', () => {
    expect(src).toContain("status: 'unknown'");
    expect(src).toContain('None of them are zero');
  });
});
