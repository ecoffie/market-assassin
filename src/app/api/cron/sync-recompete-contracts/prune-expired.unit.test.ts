/**
 * The recompete sync self-prunes EXPIRED rows (Eric 2026-07-27, the NRWA case). The sync only
 * captures contracts expiring within `months` (18), so a long follow-on (ending years out) won't
 * enter the table while the expired parent lingers from when it was in-window. Each execute run
 * FLAGS past-expiry rows quality_flag='expired' (reversible; the map + Layer-1 view filter key on
 * quality_flag IS NULL, so flagging removes them everywhere at once). Surfaces, never swallows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('sync-recompete cron prunes expired rows', () => {
  it("flags past-expiry rows quality_flag='expired' (not delete — reversible)", () => {
    // Still an UPDATE that FLAGS (never a delete) — the count option is how we read the
    // affected-row total; matching loosely here keeps the test on the BEHAVIOUR, not the
    // exact argument list.
    expect(route).toMatch(/update\(\{ quality_flag: 'expired' \}/);
    expect(route).not.toMatch(/\.delete\(\)[\s\S]{0,120}quality_flag/);
    expect(route).toContain("lt('period_of_performance_current_end', todayStr)");
  });

  it('counts pruned rows with an exact affected-row count, not a capped RETURNING payload', () => {
    // `.select()` on an UPDATE returns at most 1,000 rows, so counting its length
    // under-reported a large prune (candidate set = 137,186 rows). Ask Postgres for the count.
    expect(route).toContain("{ count: 'exact' }");
    expect(route).not.toContain("expiredPruned = pruned?.length");
    // and an unknown count must NOT be reported as "0 pruned"
    expect(route).toContain('prunedCount === null');
  });
  it('only prunes rows currently unflagged (never re-flags synthetic/other)', () => {
    expect(route).toContain(".is('quality_flag', null)");
  });
  it('prunes only on execute, and surfaces a prune error (never swallows)', () => {
    expect(route).toContain("if (mode === 'execute')");
    expect(route).toContain("failed['__prune_expired__'] = pruneErr.message");
  });
  it('reports the prune count in the run summary', () => {
    expect(route).toContain('expiredPruned');
  });
});

describe('sync-recompete cron captures follow-ons for expiring contracts', () => {
  it('looks up each expiring row\'s successor via findFollowOnAward (UEI-anchored) before pruning', () => {
    expect(route).toContain('findFollowOnAward');
    expect(route).toContain(".not('incumbent_uei', 'is', null)"); // only rows we can anchor
  });
  it('upserts a captured follow-on as a live row, counts it, and is fail-soft (never blocks prune)', () => {
    expect(route).toContain("upsert(followOn, { onConflict: 'contract_id' })");
    expect(route).toContain('followOnsCaptured');
    // the whole capture block is wrapped so a column-missing / network error can't kill the cron
    expect(route).toContain("failed['__followon_capture__']");
  });
  it('bounds the number of lookups per run (USASpending is ~1 call each)', () => {
    expect(route).toContain('FOLLOWON_CAP');
  });
});
