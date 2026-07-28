/**
 * A company's set-aside chip must reflect how it ACTUALLY competes, measured against its WHOLE award
 * mix (Eric 2026-07-28: "SAIC is a billion-dollar firm, it doesn't track"). SAIC is 99.7% full-and-
 * open yet held 64 SDVOSB awards (0.3%) → the old logic (which dropped "NO SET ASIDE" and ranked only
 * the set-aside awards) tagged it "SDVOSB · SMALL BIZ". Now a bucket only chips when it's >= 20% of the
 * firm's awards. This pins the classifier + the dominance threshold with mock counts.
 */
import { describe, it, expect } from 'vitest';
import { classifySetAside } from './recipients';

// Re-derive the exact chip decision the lib makes from per-firm counts (mirror of getSetAsidesForRecipients).
function chipsFor(counts: Record<string, number>, MIN_SHARE = 0.2): string[] {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const buckets = new Map<string, number>();
  for (const [sa, n] of Object.entries(counts)) {
    const b = classifySetAside(sa);
    if (b) buckets.set(b, (buckets.get(b) || 0) + n);
  }
  return Array.from(buckets.entries()).filter(([, n]) => n / total >= MIN_SHARE).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

describe('classifySetAside — "NO SET ASIDE" is open competition, never a chip', () => {
  it('returns null for open/full-and-open', () => {
    expect(classifySetAside('NO SET ASIDE USED.')).toBeNull();
    expect(classifySetAside('')).toBeNull();
    expect(classifySetAside(null)).toBeNull();
  });
  it('classifies real set-asides', () => {
    expect(classifySetAside('SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE')).toBe('SDVOSB');
    expect(classifySetAside('SMALL BUSINESS SET ASIDE - TOTAL')).toBe('SB');
    expect(classifySetAside('8A COMPETED')).toBe('8A');
  });
});

describe('set-aside chips require MEANINGFUL share (>= 20% of the firm\'s awards)', () => {
  it('SAIC (99.7% open, 0.3% SDVOSB) gets NO chip — the reported bug', () => {
    // real proportions: 3099 open, 64 SDVOSB, 15 SB, 2 8(a)
    expect(chipsFor({ 'NO SET ASIDE USED.': 3099, 'SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE': 64, 'SMALL BUSINESS SET ASIDE - TOTAL': 15, '8A COMPETED': 2 })).toEqual([]);
  });
  it('a genuine SDVOSB firm (86% SDVOSB) KEEPS its chip', () => {
    expect(chipsFor({ 'SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE': 86, 'NO SET ASIDE USED.': 14 })).toEqual(['SDVOSB']);
  });
  it('a firm split across two set-asides shows both when each clears the bar', () => {
    expect(chipsFor({ 'SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE': 40, 'SMALL BUSINESS SET ASIDE - TOTAL': 35, 'NO SET ASIDE USED.': 25 }).sort()).toEqual(['SB', 'SDVOSB']);
  });
});
