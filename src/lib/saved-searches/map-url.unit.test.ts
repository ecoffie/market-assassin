import { describe, it, expect } from 'vitest';
import { buildSavedSearchMapUrl } from './map-url';
import { mapHref } from '@/lib/alerts/saved-search-email';

describe('saved-search map URL parity with alert emails', () => {
  const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('restores saved search via ?ss= (same contract as alert emails)', () => {
    const url = buildSavedSearchMapUrl(id, { src: 'saved_search_alert' });
    expect(url).toContain(`ss=${encodeURIComponent(id)}`);
    expect(url).toContain('src=saved_search_alert');
  });

  it('per-opportunity link matches mapHref raw-& shape (ss + opp)', () => {
    const notice = 'abc123NOTICE';
    expect(buildSavedSearchMapUrl(id, { noticeId: notice, src: 'saved_search_alert' })).toBe(
      mapHref({ id, name: 'x' }, notice, '&'),
    );
  });

  it('MCP schedule uses distinct src attribution', () => {
    const url = buildSavedSearchMapUrl(id, { src: 'mcp_schedule' });
    expect(url).toContain(`ss=${encodeURIComponent(id)}`);
    expect(url).toContain('src=mcp_schedule');
  });
});
