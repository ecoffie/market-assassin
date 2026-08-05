/**
 * Guards the attachment drain's key pool.
 *
 * WHY THIS EXISTS (2026-08-04): the attachment backfill ran on ONE key
 * (SAM_ATTACHMENT_DRAIN_KEY, ~1,000 calls/day) against a 14,660-row active queue —
 * roughly two weeks. Meanwhile the SOW backfill had just finished its entire checkable
 * backlog in about two minutes and left 9 dedicated keys idle.
 *
 * Worse, those same 14,660 rows are what BLOCK the 6,118 opportunities the SOW job
 * still cannot check: attachments are stage one of a two-stage pipeline, and no amount
 * of SOW throughput unblocks them. Tuning the second stage while the first was the
 * constraint is the mistake this reallocation corrects.
 *
 * THE TRAP THIS FILE MOSTLY EXISTS FOR: getSowDrainKeys() falls back to the SHARED
 * rotation when no SOW key is set. Borrowing it unguarded would quietly pull the
 * alert/sync keys into the attachment drain under the banner of "dedicated" — exactly
 * the leak the whole day's work removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UTILS = readFileSync(join(process.cwd(), 'src/lib/sam/utils.ts'), 'utf8');
const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/backfill-sam-attachments/route.ts'), 'utf8');

const SHARED = ['shared-a', 'shared-b'];

// Mirrors getAttachmentDrainKeys().
function attachmentKeys(env: Record<string, string | undefined>): string[] {
  const raw: string[] = [];
  if (env.ATTACHMENT_DRAIN_KEY?.trim()) raw.push(env.ATTACHMENT_DRAIN_KEY.trim());
  for (let i = 1; i <= 10; i++) {
    const k = env[`ATTACHMENT_DRAIN_KEY_${i}`];
    if (k?.trim()) raw.push(k.trim());
  }
  const hasSow = !!env.SOW_DRAIN_KEY?.trim()
    || Array.from({ length: 10 }, (_, i) => env[`SOW_DRAIN_KEY_${i + 1}`]).some(k => k?.trim());
  if (hasSow) {
    const sow: string[] = [];
    if (env.SOW_DRAIN_KEY?.trim()) sow.push(env.SOW_DRAIN_KEY.trim());
    for (let i = 1; i <= 10; i++) {
      const k = env[`SOW_DRAIN_KEY_${i}`];
      if (k?.trim()) sow.push(k.trim());
    }
    for (const k of [...new Set(sow)]) if (!raw.includes(k)) raw.push(k);
  }
  const legacy = env.SAM_ATTACHMENT_DRAIN_KEY;
  if (legacy?.trim() && !raw.includes(legacy.trim())) raw.push(legacy.trim());
  const dedicated = [...new Set(raw)];
  return dedicated.length > 0 ? dedicated : SHARED;
}

describe('borrowing the SOW pool', () => {
  it('picks up all nine idle SOW keys', () => {
    const env: Record<string, string> = {};
    for (let i = 2; i <= 10; i++) env[`SOW_DRAIN_KEY_${i}`] = `sow-${i}`;
    expect(attachmentKeys(env)).toHaveLength(9);   // ~9,000 calls/day, was ~1,000
  });

  it('adds the legacy single key alongside, without duplicating it', () => {
    const keys = attachmentKeys({ SOW_DRAIN_KEY_1: 'k1', SAM_ATTACHMENT_DRAIN_KEY: 'legacy' });
    expect(keys).toEqual(['k1', 'legacy']);
    expect(attachmentKeys({ SOW_DRAIN_KEY_1: 'same', SAM_ATTACHMENT_DRAIN_KEY: 'same' }))
      .toEqual(['same']);
  });

  it('prefers explicit ATTACHMENT_DRAIN keys, then borrows', () => {
    const keys = attachmentKeys({ ATTACHMENT_DRAIN_KEY: 'own', SOW_DRAIN_KEY_1: 'sow' });
    expect(keys[0]).toBe('own');
    expect(keys).toContain('sow');
  });
});

describe('the borrow cannot leak shared keys', () => {
  it('does NOT fall through to the shared pool when no SOW key is set', () => {
    // getSowDrainKeys() returns the SHARED rotation when unset. Borrowing it unguarded
    // would put alert/sync keys back into a bulk drain — the leak fixed earlier today.
    const keys = attachmentKeys({ SAM_ATTACHMENT_DRAIN_KEY: 'legacy-only' });
    expect(keys).toEqual(['legacy-only']);
    for (const s of SHARED) expect(keys).not.toContain(s);
  });

  it('the guard is present in the source, not just in this mirror', () => {
    const fn = UTILS.slice(UTILS.indexOf('export function getAttachmentDrainKeys'));
    expect(fn.slice(0, 900)).toContain('if (hasDedicatedSowKeys())');
  });

  it('uses the shared rotation only when nothing dedicated exists at all', () => {
    // So removing every drain key restores prior behaviour instead of breaking the job.
    expect(attachmentKeys({})).toEqual(SHARED);
  });
});

describe('the route uses the pool', () => {
  it('no longer pins a single key', () => {
    expect(ROUTE).toContain('getAttachmentDrainKeys()');
    expect(ROUTE, 'the single-key form is the bottleneck')
      .not.toMatch(/const apiKey = process\.env\.SAM_ATTACHMENT_DRAIN_KEY \|\| getRotatedSAMKey\(\);/);
  });

  it('fails over to the next key before recording a failure', () => {
    // A null result may be a 429 on the current key rather than a dead notice.
    expect(ROUTE).toMatch(/while \(attachments === null && keyIdx < drainKeys\.length - 1\)/);
  });

  it('reports pool size, so a collapse back to one key is visible', () => {
    expect(ROUTE).toContain('keysAvailable: drainKeys.length');
  });
});
