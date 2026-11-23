import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The "24,000+ opportunities" count had no source and was stale (the active
 * SAM count was measured at 36,506 on 2026-09-22). Public copy must not state
 * an unsourced opportunity count. These assertions read the rendering call
 * sites themselves, so they fail if the number comes back in any of them.
 */
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const SURFACES: Array<{ file: string; expected: string[] }> = [
  {
    file: 'src/components/MeetMindyStrip.tsx',
    expected: [
      'Mindy is your 24/7 federal market intelligence analyst — it scans federal opportunities daily, scores your fit, and tells you what to bid on.',
    ],
  },
  {
    file: 'src/app/shared/opp/[shareId]/page.tsx',
    expected: [
      "description: 'See your fit on this federal opportunity and find more like it — Mindy scores federal opportunities daily.'",
      "description: 'See your fit and find more like it — Mindy scores federal opportunities daily.'",
    ],
  },
  {
    file: 'src/app/mindy-landing/page.tsx',
    expected: [
      "description: 'Your 24/7 federal market intelligence analyst. Scans federal opportunities daily, tracks competitors, and delivers personalized briefings.'",
    ],
  },
];

describe('public copy carries no unsourced 24,000+ opportunity count', () => {
  for (const { file, expected } of SURFACES) {
    it(`${file} has no 24,000 claim`, () => {
      expect(read(file)).not.toMatch(/24,000\+?|24K\+/);
    });
    it(`${file} keeps the rest of the sentence`, () => {
      const src = read(file);
      for (const text of expected) expect(src).toContain(text);
    });
  }
});
