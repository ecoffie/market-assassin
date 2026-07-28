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
    expect(route).toContain("update({ quality_flag: 'expired' })");
    expect(route).toContain("lt('period_of_performance_current_end', todayStr)");
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
