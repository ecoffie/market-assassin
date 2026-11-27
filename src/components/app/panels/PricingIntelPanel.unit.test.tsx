// @vitest-environment jsdom
/** Pricing Intel results: each price-to-win tile shows its hint once, and an unknown vendor list never reads 0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const authedFetch = vi.fn();
vi.mock('../authHeaders', () => ({ authedFetch: (...a: unknown[]) => authedFetch(...a) }));
vi.mock('../track', () => ({ useAppTracker: () => () => {} }));
vi.mock('../Toast', () => ({ useToast: () => ({ showToast: () => {} }) }));

import PricingIntelPanel, { vendorCountStat } from './PricingIntelPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseData = {
  laborCategories: [{ category: 'Engineer', recordCount: 40, median: 100, percentile25: 80, percentile75: 120, min: 50, max: 200, avg: 101, nextYearMedian: null }],
  businessSizeComparison: { smallBusiness: { median: 95, count: 20, avg: 96 }, largeBusiness: { median: 105, count: 20, avg: 106 }, gapPercent: 9.5 },
  rateDistribution: [],
  priceToWinGuidance: { aggressiveRate: 80, competitiveRate: 100, premiumRate: 120 },
  naicsCode: '541512',
  naicsDescription: 'Computer Systems Design Services',
  totalRecordsAnalyzed: 40,
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  authedFetch.mockReset();
});

async function renderWith(data: Record<string, unknown>) {
  authedFetch.mockImplementation(async (url: string) =>
    url.startsWith('/api/app/workspace')
      ? json({ user: { naics_codes: ['541512'] } })
      : json({ success: true, data }),
  );
  await act(async () => { root.render(<PricingIntelPanel email="tester@example.com" tier="pro" />); });
  const run = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith('Run'));
  expect(run).toBeTruthy();
  await act(async () => { run!.click(); });
}

function tileText(label: string): string {
  const card = Array.from(container.querySelectorAll('div')).find(
    (d) => d.firstElementChild?.textContent === label && d.children.length >= 2,
  );
  return card?.textContent ?? '';
}

describe('vendorCountStat', () => {
  it('missing or null list is unknown, never 0', () => {
    expect(vendorCountStat(undefined).value).toBe('Not available');
    expect(vendorCountStat(null).value).toBe('Not available');
  });
  it('an empty list is a real 0', () => {
    expect(vendorCountStat([])).toEqual({ value: '0', hint: 'ranked by record count' });
  });
});

describe('PricingIntelPanel results', () => {
  it('each price-to-win tile shows its hint once, with /hr beside the rate', async () => {
    await renderWith({ ...baseData, topVendors: [] });
    const aggressive = tileText('Aggressive');
    expect(aggressive).toContain('$80.00/hr');
    expect(aggressive.match(/undercut to win on price/g)).toHaveLength(1);
    expect(aggressive).not.toContain('·');
    expect(tileText('Competitive').match(/market median/g)).toHaveLength(1);
    expect(tileText('Premium').match(/differentiated value/g)).toHaveLength(1);
  });

  it('a missing vendor list shows Not available, not 0, and does not crash', async () => {
    await renderWith({ ...baseData });
    const t = tileText('Top vendors found');
    expect(t).toContain('Not available');
    expect(t).not.toMatch(/\b0\b/);
  });

  it('an empty vendor list from the API shows a real 0', async () => {
    await renderWith({ ...baseData, topVendors: [] });
    expect(tileText('Top vendors found')).toContain('0ranked by record count');
  });

  it('a returned vendor list shows its count and the vendor table', async () => {
    await renderWith({ ...baseData, topVendors: [{ name: 'Vendor A', avgRate: 99, recordCount: 3, businessSize: 'Small' }] });
    expect(tileText('Top vendors found')).toContain('1ranked by record count');
    expect(container.textContent).toContain('Vendor A');
  });
});
