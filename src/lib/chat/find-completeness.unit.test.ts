import { describe, it, expect } from 'vitest';
import { missingHorizonFooter } from './find-completeness';

const FL = {
  open_now: { status: 'grounded', matched_count: 9 },
  coming_back: { status: 'grounded', matched_count: 80, direct_match: 44, related_market_candidate: 36 },
  coming_soon: { status: 'empty', matched_count: 0 },
};

describe('missingHorizonFooter', () => {
  it('the parity-run case: an answer that stopped after "Open now" gets Coming back + Coming soon from the summary', () => {
    const f = missingHorizonFooter('### Open now\n\n**Coast Guard janitorial — Key West** …', FL);
    expect(f).toBe('\n\n**Coming back:** 80 expiring contracts matched (44 direct, 36 related-market, not confirmed); these are not open solicitations. Ask me to list them.\n\n**Coming soon:** no matching agency forecasts.');
  });
  it('a complete answer gets nothing', () => {
    expect(missingHorizonFooter('## Open now\n…\n## Coming back\n…\n## Coming soon\n…', FL)).toBe('');
  });
  it('unavailable is said as unavailable, never zero', () => {
    const f = missingHorizonFooter('Open now: …', { ...FL, coming_soon: { status: 'unavailable', matched_count: null } });
    expect(f).toContain('**Coming soon:** could not be checked this time (not a zero).');
  });
  it('an open-only answer with no Open heading gets the open count', () => {
    expect(missingHorizonFooter('Coming back … Coming soon …', FL)).toBe('\n\n**Open now:** 9 open notices matched the search; ask me to list them.');
  });
  it('no summary, or only the horizons the tool returned', () => {
    expect(missingHorizonFooter('anything', null)).toBe('');
    expect(missingHorizonFooter('Open now …', { open_now: FL.open_now })).toBe('');
  });
});
