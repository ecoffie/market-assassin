/**
 * The repair-ledger audit is the guard AGAINST regressions — so it must not have blind spots itself.
 * Two were found 2026-07-28 (Eric: "I thought the ledger was built to solve this so you didn't have
 * to ask what I liked"): (1) the file-path parser only accepted ts/tsx/mjs/js/json/md/css — so EVERY
 * .html-anchored row (8 of them, incl. the biggest map file template.html) was SILENTLY skipped;
 * (2) it only checked "present" anchors, so a KILLED thing coming back (SDVOSB subtitle, card button)
 * slipped past. These tests pin both fixes so the audit can't go blind again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const script = readFileSync(join(__dirname, '../../scripts/audit-repair-ledger.mjs'), 'utf8');

describe('repair-ledger audit — no blind spots', () => {
  it('the file-path parser accepts .html (was silently skipping every .html-anchored row)', () => {
    expect(script).toMatch(/tsx\|mjs\|ts\|js\|json\|md\|css\|html/);
  });
  it('supports ABSENT anchors (a killed thing must stay killed) with comments stripped', () => {
    expect(script).toContain("mode = 'absent'");
    expect(script).toContain('REMOVED thing came BACK');
    // comments are stripped before the absence check so a comment quoting the killed text is not a false positive
    expect(script).toContain("filter((l) => !l.trim().startsWith('//'))");
  });
  it('the live audit passes on the current tree (all anchors, present + absent, satisfied)', () => {
    // Exits 0 when clean; throws (non-zero) otherwise. This is the end-to-end proof.
    const out = execSync('node scripts/audit-repair-ledger.mjs', { cwd: join(__dirname, '../..'), encoding: 'utf8' });
    expect(out).toMatch(/Repair ledger clean/);
  });
});
