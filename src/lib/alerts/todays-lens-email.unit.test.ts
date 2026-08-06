import { describe, it, expect } from 'vitest';
import { renderTodaysLensEmailBlock } from './todays-lens-email';
import type { TodaysLens } from '@/lib/dashboard/todays-lens';

const BASE = 'https://getmindy.ai';

// The LENS_STRAND emoji icons that must NEVER appear in the email block (NO EMOJI rule).
const STRAND_EMOJI = ['🔥', '🟢', '📣', '⚡', '🎯'];
// Any codepoint in the common emoji planes (misc symbols, pictographs, transport, dingbats…).
const EMOJI_RANGE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;

describe('renderTodaysLensEmailBlock', () => {
  it('grounded lens: renders each present strand label + count, the map CTA with strategy, and NO emoji', () => {
    const lens: TodaysLens = {
      grounded: true,
      usingFallback: false,
      totalOpen: 26,
      strands: [
        { key: 'repeat_buyer', label: 'Repeat Buyers', icon: '🔥', count: 3 },
        { key: 'sb_friendly', label: 'SB-Friendly', icon: '🟢', count: 14 },
        { key: 'closes_soon', label: 'Close This Week', icon: '⚡', count: 9 },
      ],
      lensStrategy: 'repeat_buyer,sb_friendly,closes_soon',
    };

    const html = renderTodaysLensEmailBlock(lens, BASE);

    // Each present strand label + its count.
    expect(html).toContain('Repeat Buyers');
    expect(html).toContain('SB-Friendly');
    expect(html).toContain('Close This Week');
    expect(html).toContain('>3<');
    expect(html).toContain('>14<');
    expect(html).toContain('>9<');

    // The "Open Today's Map" button.
    expect(html).toContain("Open Today's Map");

    // The href carries strategy=<lensStrategy> (URL-encoded commas).
    expect(html).toContain(`${BASE}/opportunity-map?strategy=`);
    expect(html).toContain(`strategy=${encodeURIComponent(lens.lensStrategy)}`);

    // NO emoji anywhere — neither the strand icons nor any emoji-range codepoint.
    for (const e of STRAND_EMOJI) expect(html).not.toContain(e);
    expect(EMOJI_RANGE.test(html)).toBe(false);
  });

  it('quiet-day lens (grounded:false, totalOpen:0): offers the map WITHOUT a strategy param and fabricates NO counts', () => {
    const lens: TodaysLens = {
      grounded: false,
      usingFallback: false,
      totalOpen: 0,
      strands: [],
      lensStrategy: '',
    };

    const html = renderTodaysLensEmailBlock(lens, BASE);

    // Still offers the map.
    expect(html).toContain(`${BASE}/opportunity-map`);
    expect(html).toContain('Open the Map');
    expect(html).toContain('The market moves daily');

    // No strategy filter on a quiet day.
    expect(html).not.toContain('strategy=');

    // No fabricated count rows — the tabular-count cell style is only emitted for real strand rows.
    expect(html).not.toContain('font-variant-numeric:tabular-nums');

    // No emoji.
    expect(EMOJI_RANGE.test(html)).toBe(false);
  });

  it('quiet-day when totalOpen>0 but no present strands is still treated as quiet (no fabricated rows)', () => {
    const lens: TodaysLens = {
      grounded: true,
      usingFallback: false,
      totalOpen: 5,
      strands: [], // grounded totals but nothing surfaced as a strand
      lensStrategy: '',
    };

    const html = renderTodaysLensEmailBlock(lens, BASE);
    expect(html).toContain('Open the Map'); // falls through to the quiet block
    expect(html).not.toContain('strategy=');
    expect(html).not.toContain('font-variant-numeric:tabular-nums');
  });

  it('the map href is properly encoded (commas in the strategy become %2C)', () => {
    const lens: TodaysLens = {
      grounded: true,
      usingFallback: false,
      totalOpen: 10,
      strands: [
        { key: 'repeat_buyer', label: 'Repeat Buyers', icon: '🔥', count: 2 },
        { key: 'set_aside', label: 'Set-Aside', icon: '🎯', count: 8 },
      ],
      lensStrategy: 'repeat_buyer,set_aside',
    };

    const html = renderTodaysLensEmailBlock(lens, BASE);
    expect(html).toContain('strategy=repeat_buyer%2Cset_aside');
    // The raw un-encoded comma must NOT appear inside the strategy param.
    expect(html).not.toContain('strategy=repeat_buyer,set_aside');
  });
});
