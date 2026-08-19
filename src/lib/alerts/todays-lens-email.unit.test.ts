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
    // Labels are singularised as SIGNAL names ("1,037 Repeat Buyer"), not populations —
    // the plural is what made it read as a count of organizations.
    expect(html).toContain('Repeat Buyer');
    expect(html).toContain('SB-Friendly');
    expect(html).toContain('Close This Week');
    // Assert the COUNTS are present, not the old table-cell markup ('>14<') — pinning
    // markup made a purely visual change look like a broken feature. The 2026-08-19
    // redesign promotes the LARGEST strand to the headline (14 = SB-Friendly here) and
    // renders the rest inline as <strong>N</strong> Label, so the shapes differ by rank.
    // 2026-08-19: no strand is promoted to a headline any more. "1,037 repeat buyers in
    // your markets" read as a count of ORGANIZATIONS; the counts are opportunities
    // CARRYING a signal (todays-lens.ts:82 counts sam_opportunities rows). As labelled
    // chips they are unambiguous, so EVERY strand rides the supporting line.
    for (const n of ['3', '14', '9']) expect(html).toMatch(new RegExp(`<strong[^>]*>${n}</strong>`));
    // and the section leads with the honest market total it actually describes
    expect(html).toContain('26 active opportunities');
    expect(html).toContain('Your market at a glance');

    // The map CTA names WHAT is on the other side of the click, using the lens's REAL total.
    // Copy changed in the 2026-08-19 redesign: the button is now a plain "Open today's
    // map" and the grounded total moved to the footnote beneath it. Assert the TOTAL is
    // present (the thing that must never be fabricated), not the old sentence.
    expect(html).toContain('Explore all 26 in this market');
    // And it explains what the map is for, so the click has a reason. The lead strand
    // The section now states the honest market total it describes, asserted above
    // ("26 active opportunities" + "Your market at a glance"). The old headline phrasing
    // ("N repeat buyers in your markets") is deliberately gone.
    // The overlap disclosure is load-bearing: the strands do NOT sum to the total, and
    // saying so is what stops the numbers reading as an arithmetic error.
    // The "a notice can match more than one signal" footnote was REMOVED (Eric): it read
    // as implementation language and raised a question nobody was asking.
    expect(html).not.toContain('can match more than one signal');

    // The href carries strategy=<lensStrategy> (URL-encoded commas).
    expect(html).toContain(`${BASE}/opportunity-map?strategy=`);
    expect(html).toContain(`strategy=${encodeURIComponent(lens.lensStrategy)}`);

    // NO emoji anywhere — neither the strand icons nor any emoji-range codepoint.
    for (const e of STRAND_EMOJI) expect(html).not.toContain(e);
    expect(EMOJI_RANGE.test(html)).toBe(false);
  });

  it('CTA uses lens.totalOpen, NOT the sum of strands (strands overlap — summing fabricates a number)', () => {
    // One notice can be BOTH set-aside and closing this week, so the strands double-count.
    // Sum here is 1023 + 301 + 331 = 1655, but only 1200 distinct notices are open.
    const lens: TodaysLens = {
      grounded: true,
      usingFallback: false,
      totalOpen: 1200,
      strands: [
        { key: 'repeat_buyer', label: 'Repeat Buyers', icon: '', count: 1023 },
        { key: 'sb_friendly', label: 'SB-Friendly', icon: '', count: 301 },
        { key: 'closes_soon', label: 'Close This Week', icon: '', count: 331 },
      ],
      lensStrategy: 'repeat_buyer',
    };

    const html = renderTodaysLensEmailBlock(lens, BASE);

    expect(html).toContain('Explore all 1,200 in this market'); // the real, grounded total
    expect(html).not.toContain('1,655');                // never the inflated sum
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

  it('routes the map button through trackedUrl when provided (so the email→map click is logged)', () => {
    const lens: TodaysLens = {
      grounded: true, usingFallback: false, totalOpen: 5,
      strands: [{ key: 'repeat_buyer', label: 'Repeat Buyers', icon: '🔥', count: 5 }],
      lensStrategy: 'repeat_buyer',
    };
    // A stub tracker that wraps the raw url in a redirect + records the label it was given.
    const seen: { url: string; label: string }[] = [];
    const trackedUrl = (url: string, label: string) => {
      seen.push({ url, label });
      return `https://getmindy.ai/api/track?to=${encodeURIComponent(url)}&l=${label}`;
    };
    const html = renderTodaysLensEmailBlock(lens, BASE, trackedUrl);
    // The button href is now the TRACKED redirect, not the raw /opportunity-map link.
    expect(html).toContain('/api/track?to=');
    // The tracker was called with the dedicated grounded label + the real map url.
    expect(seen.some((s) => s.label === 'todays_lens_map' && s.url.includes('/opportunity-map?strategy='))).toBe(true);
  });

  it('quiet-day map button also routes through trackedUrl with its own label', () => {
    const lens: TodaysLens = { grounded: false, usingFallback: false, totalOpen: 0, strands: [], lensStrategy: '' };
    const seen: string[] = [];
    const trackedUrl = (url: string, label: string) => { seen.push(label); return `${url}#tracked`; };
    const html = renderTodaysLensEmailBlock(lens, BASE, trackedUrl);
    expect(seen).toContain('todays_lens_map_quiet');
    expect(html).toContain('#tracked');           // the wrapped url is what rendered
    expect(html).not.toContain('strategy=');       // still no fabricated strategy on a quiet day
  });
});
