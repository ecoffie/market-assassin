/**
 * Opportunity clicks open the map drawer, not SAM.gov (Eric 2026-08-13).
 */
import { describe, it, expect } from 'vitest';
import { mapDrawerHref, noticeIdFromOppUrl, mindyMapPath } from './email-branding';

describe('noticeIdFromOppUrl', () => {
  it('pulls the notice id from a sam.gov /opp/ URL', () => {
    expect(noticeIdFromOppUrl('https://sam.gov/opp/ABC123/view')).toBe('ABC123');
    expect(noticeIdFromOppUrl('https://sam.gov/workspace/contract/opp/XYZ/view')).toBe('XYZ');
  });
  it('returns null for a map URL or empty', () => {
    expect(noticeIdFromOppUrl('/opportunity-map?opp=ABC')).toBeNull();
    expect(noticeIdFromOppUrl(null)).toBeNull();
  });
});

describe('mapDrawerHref', () => {
  it('builds /opportunity-map?src=&opp= from a notice id', () => {
    expect(mapDrawerHref({ noticeId: 'N1', src: 'alert' })).toBe('/opportunity-map?src=alert&opp=N1');
  });
  it('converts a leftover SAM.gov URL into the drawer', () => {
    expect(mapDrawerHref({ url: 'https://sam.gov/opp/N2/view', src: 'app' }))
      .toBe('/opportunity-map?src=app&opp=N2');
  });
  it('keeps an existing map URL', () => {
    const u = 'https://getmindy.ai/opportunity-map?src=saved_search&opp=N3';
    expect(mapDrawerHref({ url: u })).toBe(u);
  });
});

describe('mindyMapPath', () => {
  it('omits opp when there is no notice id', () => {
    expect(mindyMapPath({ src: 'alert' })).toBe('/opportunity-map?src=alert');
  });
});
