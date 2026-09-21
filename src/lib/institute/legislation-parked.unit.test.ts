/**
 * Institute legislation — PARKED / BLOCKED_CONTROLLED.
 *
 * Not broken, not misleading — explicitly blocked and reaching nobody. Evidence:
 *   · CONGRESS_API_KEY absent in production (collector runs on a fallback key)
 *   · the 29-row corpus reaches ZERO customer surfaces
 *   · 28 of 29 rows are NDAA, under ONE agency
 *   · the weekly job has never resolved an outcome (dispatched/NULL)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260921_park_institute_legislation.sql'),
  'utf8',
);
const BODY = SQL.replace(/--.*$/gm, '');

describe('the classification is truthful within the existing vocabulary', () => {
  it('source_state is upstream_quiet — the DATA is quiet, not broken', () => {
    expect(BODY).toMatch(/SET source_state\s+= 'upstream_quiet'/);
  });

  it('it is NOT reported current — that would imply the source is delivering', () => {
    expect(BODY).not.toMatch(/SET source_state\s+= 'current'/);
  });

  it('it is NOT reported unreachable — that would imply it is broken', () => {
    expect(BODY).not.toMatch(/source_state\s+= 'unreachable'/);
  });

  it('intervention_state carries the parked fact, and names what unblocks it', () => {
    expect(BODY).toMatch(/intervention_state = 'blocked'/);
    expect(BODY).toMatch(/manual_action_type = 'credential_renewal'/);
  });
});

describe('nothing is destroyed and the job is not silenced', () => {
  it('no row, source or registration is deleted', () => {
    expect(BODY).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(BODY).not.toMatch(/\bDROP\b/i);
    expect(BODY).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('the cron stays ENABLED — unlike DARPA/NSF it emits no false-green evidence', () => {
    // It reports `dispatched`, which is honestly unknown, and #1593 makes the
    // real outcome observable. Disabling it would hide a working collector.
    expect(BODY).not.toMatch(/cron_jobs[\s\S]*SET[\s\S]*enabled\s*=\s*FALSE/i);
  });

  it('the cron note is idempotent — re-running cannot stack it', () => {
    expect(BODY).toMatch(/NOT LIKE '%PARKED\/BLOCKED_CONTROLLED%'/);
  });
});

describe('the two states stay independent', () => {
  it('a human acknowledgement cannot render the DATA current', () => {
    // intervention_state is set in the same statement but to 'blocked', never to
    // a value that would imply the data moved.
    expect(BODY).not.toMatch(/intervention_state = 'completed'/);
    expect(BODY).not.toMatch(/intervention_state = 'none_required'/);
  });
});
