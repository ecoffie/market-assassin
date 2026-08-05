/**
 * Guards the SOW backfill's key isolation.
 *
 * THE PROBLEM (2026-08-04): the SOW catalog cron drew from getAllDistinctSAMKeys() —
 * the SAME pool daily-alerts and sync-sam-opportunities depend on — and did so
 * deliberately ("drains against the COMBINED daily quota", 2026-08-01).
 *
 * It fires 96×/day, and every record costs ONE authenticated SAM fetch per attachment
 * (to read the content-disposition filename) plus another to download the winner. That
 * is thousands of calls a day spent by a background backfill, against the quota the
 * user-visible paths need.
 *
 * The cron's own timing hid it: each run finished in ~12s of a 120s budget and stamped
 * exactly 25 rows, so the job looked idle and healthy. The cost landed somewhere else.
 *
 * Same shape as SAM_ATTACHMENT_DRAIN_KEY, which already solved this for the attachment
 * backfill after it exhausted the shared quota.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UTILS = readFileSync(join(process.cwd(), 'src/lib/sam/utils.ts'), 'utf8');
const CRON = readFileSync(join(process.cwd(), 'src/app/api/cron/sow-catalog/route.ts'), 'utf8');
const DRAINER = readFileSync(join(process.cwd(), 'scripts/sow-catalog-drain.ts'), 'utf8');

// Mirrors getSowDrainKeys() / hasDedicatedSowKeys().
const SHARED = ['shared-base', 'shared-1'];
function sowKeys(env: Record<string, string | undefined>): string[] {
  const raw: string[] = [];
  if (env.SOW_DRAIN_KEY?.trim()) raw.push(env.SOW_DRAIN_KEY.trim());
  for (let i = 1; i <= 10; i++) {
    const k = env[`SOW_DRAIN_KEY_${i}`];
    if (k?.trim()) raw.push(k.trim());
  }
  const dedicated = [...new Set(raw)];
  return dedicated.length > 0 ? dedicated : SHARED;
}

describe('the backfill runs on its own quota', () => {
  it('uses ONLY the drain keys when they are set', () => {
    const keys = sowKeys({ SOW_DRAIN_KEY: 'drain-a', SOW_DRAIN_KEY_1: 'drain-b' });
    expect(keys).toEqual(['drain-a', 'drain-b']);
    // The whole point: no shared key may leak into the pool.
    for (const shared of SHARED) expect(keys).not.toContain(shared);
  });

  it('accepts all ten keys Eric holds, in the numbered slots', () => {
    // Slots are SOW_DRAIN_KEY_1..10, so ten keys fit without touching the
    // unsuffixed base — which stays free as an 11th if ever needed.
    const env: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) env[`SOW_DRAIN_KEY_${i}`] = `key-${i}`;
    expect(sowKeys(env)).toHaveLength(10);   // ~10,000 SAM calls/day of isolated quota
  });

  it('does not silently drop keys past the scanned slots', () => {
    // The failure this guards: build 6 slots, get handed 10, and 4 sit unused with
    // no error anywhere — the job just runs slower than the quota allows.
    const env: Record<string, string> = { SOW_DRAIN_KEY: 'base' };
    for (let i = 1; i <= 10; i++) env[`SOW_DRAIN_KEY_${i}`] = `key-${i}`;
    expect(sowKeys(env)).toHaveLength(11);
  });

  it('dedupes so a key pasted into two slots is not double-counted', () => {
    // Otherwise a run reports twice the quota it really has and stops early.
    expect(sowKeys({ SOW_DRAIN_KEY: 'same', SOW_DRAIN_KEY_1: 'same' })).toEqual(['same']);
  });

  it('ignores blank and whitespace-only slots', () => {
    expect(sowKeys({ SOW_DRAIN_KEY: 'real', SOW_DRAIN_KEY_1: '', SOW_DRAIN_KEY_2: '   ' }))
      .toEqual(['real']);
  });

  it('trims, because `vercel env add` with echo appends a newline', () => {
    // A trailing \n silently breaks the X-Api-Key header. Documented gotcha.
    expect(sowKeys({ SOW_DRAIN_KEY: '  keyval\n' })).toEqual(['keyval']);
  });
});

describe('falling back is safe, not silent', () => {
  it('uses the shared rotation when NO drain key is set', () => {
    // So removing the env vars after the backlog drains restores prior behaviour
    // rather than breaking the job with "No SAM API keys set".
    expect(sowKeys({})).toEqual(SHARED);
  });

  it('reports which quota was used, so a silent fallback is visible', () => {
    expect(CRON).toContain('dedicatedQuota: hasDedicatedSowKeys()');
    expect(UTILS).toContain('export function hasDedicatedSowKeys');
  });
});

describe('every SOW consumer is switched over', () => {
  it('the cron no longer reaches for the shared pool', () => {
    expect(CRON).toContain('const samKeys = getSowDrainKeys()');
    // Assert on a CALL, not the identifier — the comment above the fix names the old
    // function on purpose, and a substring match would flag that as a regression.
    expect(CRON, 'the shared pool must not be called here').not.toMatch(/=\s*getAllDistinctSAMKeys\(/);
    expect(CRON, 'and must not be imported here').not.toMatch(/import[^;]*getAllDistinctSAMKeys[^;]*from/);
  });

  it('the local drainer uses drain keys and warns when it cannot', () => {
    // CONCURRENCY=10 against SAM_API_KEY is the fastest way to re-starve alerts.
    expect(DRAINER).toContain('SOW_DRAIN_KEY');
    expect(DRAINER).toContain('competes with alerts/sync');
  });

  it('the drainer round-robins instead of exhausting key 1 first', () => {
    expect(DRAINER).toContain('keyIdx++ % DRAIN_KEYS.length');
  });
});
