import { describe, expect, it, vi } from 'vitest';

vi.mock('./report', () => ({ runGa4Report: vi.fn() }));
import { isHomepageReferrer, rate } from './conversions';

describe('conversion helpers', () => {
  it('recognises only the homepage as a referrer', () => {
    expect(isHomepageReferrer('https://getmindy.ai/')).toBe(true);
    expect(isHomepageReferrer('https://getmindy.ai')).toBe(true);
    expect(isHomepageReferrer('https://www.getmindy.ai/?utm_source=x')).toBe(true);
    expect(isHomepageReferrer('https://getmindy.ai/pricing')).toBe(false);
    expect(isHomepageReferrer('https://google.com/')).toBe(false);
    expect(isHomepageReferrer('')).toBe(false);
  });

  it('formats a rate and refuses a missing or zero base', () => {
    expect(rate(257, 1483)).toBe('17.3%');
    expect(rate(5, 0)).toBe('—');
    expect(rate(null, 10)).toBe('—');
  });
});
