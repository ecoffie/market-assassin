/**
 * search_federal_contacts must report a degraded lookup as degraded — never as an empty,
 * grounded roster. A statement timeout on W912PL (182 real contacts) is UNKNOWN, not zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryFederalContacts = vi.fn();
vi.mock('@/lib/gov-contacts/contact-roster', () => ({
  queryFederalContacts: (...a: unknown[]) => queryFederalContacts(...a),
}));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: true } }));

import { searchFederalContacts } from './federal-contacts';

beforeEach(() => queryFederalContacts.mockReset());

describe('searchFederalContacts — degraded is not an empty roster', () => {
  it('degraded lib result → grounded=false, degraded=true, reason surfaced, hint says NOT "no contacts"', async () => {
    queryFederalContacts.mockResolvedValue({
      contacts: [],
      anchor: 'dodaac',
      total: 0,
      emailableCount: 0,
      degraded: true,
      trace: ['query error: canceling statement due to statement timeout'],
    });
    const r = await searchFederalContacts({ dodaac: 'W912PL' });
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded_reason).toContain('statement timeout');
    expect(r._ai_hint?.summary).toMatch(/NOT "no contacts"/);
    expect(r._ai_hint?.summary).not.toMatch(/^No contacts matched/);
  });

  it('degraded stays ungrounded even if a partial row slipped through', async () => {
    queryFederalContacts.mockResolvedValue({
      contacts: [{ contact_fullname: 'X', contact_email: 'x@usace.army.mil' }],
      anchor: 'dodaac', total: 1, emailableCount: 1, degraded: true, trace: ['query error: boom'],
    });
    const r = await searchFederalContacts({ dodaac: 'W912PL' });
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(true);
  });

  it('a healthy roster is grounded and carries no degraded_reason', async () => {
    queryFederalContacts.mockResolvedValue({
      contacts: [{ contact_fullname: 'Jane Doe', contact_email: 'jane@usace.army.mil' }],
      anchor: 'dodaac', total: 182, emailableCount: 1, degraded: false, trace: [],
    });
    const r = await searchFederalContacts({ dodaac: 'W912PL' });
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, total: 182 });
    expect(r._meta.degraded_reason).toBeUndefined();
  });
});
