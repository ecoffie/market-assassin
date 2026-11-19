/**
 * Structural lock for the 2026-11-18 false-green freshness park migration.
 * Mirrors false-green-producers.unit.test.ts for DARPA/NSF.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261118_park_false_green_freshness.sql'),
  'utf8',
);
const SQL = MIGRATION.replace(/--.*$/gm, '');

describe('20261118 park false-green freshness', () => {
  it('does NOT park sync-dod-sbir — retries + 503 honesty stay enabled (Eric 2026-11-18)', () => {
    // Prior draft parked the job; that section was removed before any prod apply.
    expect(SQL).not.toMatch(/SET\s+enabled\s*=\s*FALSE/);
    expect(SQL).toMatch(/job_name = 'sync-dod-sbir'/);
    expect(SQL).toMatch(/keep ENABLED/);
    expect(MIGRATION).toMatch(/never park this job for an empty corpus/);
  });

  it('DIBBS control plane becomes content_stale + blocked, not current', () => {
    expect(SQL).toMatch(/source_key = 'dibbs_dla_flat_files'/);
    expect(SQL).toMatch(/source_state\s+= 'content_stale'/);
    expect(SQL).toMatch(/intervention_state = 'blocked'/);
    expect(SQL).not.toMatch(/SET source_state\s+= 'current'[\s\S]*?dibbs_dla_flat_files/);
  });

  it('null-clock automated currents are demoted to unmeasured', () => {
    expect(SQL).toMatch(/source_state = 'unmeasured'/);
    expect(SQL).toMatch(/'sam_opportunities_sam_gov'/);
    expect(SQL).toMatch(/'grants_gov_api'/);
    expect(SQL).toMatch(/'forecast_dhs_apfs'/);
    expect(SQL).toMatch(/'forecast_doe_osbp'/);
  });

  it('deletes nothing', () => {
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('does not re-enable specialty ingest (DIBBS/Grants stay parked from repair)', () => {
    expect(SQL).not.toMatch(/sync-dibbs[\s\S]*enabled = TRUE/);
    expect(SQL).not.toMatch(/sync-grants[\s\S]*enabled = TRUE/);
  });
});
