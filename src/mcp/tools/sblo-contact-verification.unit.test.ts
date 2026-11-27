/**
 * Data Core PR 3 — get_sblo_contact reports how verified the contact it returns is.
 * `_meta.email_status` / `_meta.email_kind` mirror contact.verification so an agent can branch
 * on provenance without parsing the contact, and the hint never presents an unverified personal
 * email as current.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SbloLookupResult } from '@/lib/gov-contacts/sblo-lookup';

const lookup = vi.fn<(c: string) => Promise<SbloLookupResult>>();
vi.mock('@/lib/gov-contacts/sblo-lookup', () => ({ lookupSbloContactEnriched: (c: string) => lookup(c) }));
vi.mock('@/lib/sam/registered-poc', () => ({
  REGISTERED_POC_LABEL: 'registered SAM point of contact, not a designated small business liaison',
  resolveRegisteredPocs: vi.fn(async () => ({ status: 'not_found' })),
}));
const flags = vi.hoisted(() => ({ aiHint: false }));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: flags }));

import { getSbloContact } from './sblo-contact';
import { buildSbloVerification } from '@/lib/gov-contacts/sblo-provenance';

const snapshotRow = {
  sbloName: 'Yadira Beltre', title: 'Small Business Liaison Officer', email: 'yadira.beltre@caci.com',
  phone: null, supplierPortal: 'https://www.caci.com/sbao',
};
function contactFrom(row: typeof snapshotRow & Record<string, unknown>, verified: string | null) {
  return {
    company: 'CACI INTERNATIONAL INC', sblo_name: row.sbloName, title: row.title, email: row.email, phone: row.phone,
    supplier_portal: row.supplierPortal, source: 'Jun 2026', matched_from: 'roster' as const, verified,
    verification: buildSbloVerification(row, verified),
  };
}

describe('get_sblo_contact verification reporting', () => {
  beforeEach(() => { flags.aiHint = false; lookup.mockReset(); });

  it('a snapshot personal email reports email_status=unverified, email_kind=personal', async () => {
    lookup.mockResolvedValue({ contact: contactFrom(snapshotRow, '2026-06'), candidates: [], matchType: 'exact' });
    const r = await getSbloContact({ company: 'CACI' });
    expect(r._meta.email_status).toBe('unverified');
    expect(r._meta.email_kind).toBe('personal');
    expect(r._meta.has_email).toBe(true); // unchanged field
  });

  it('a verified role mailbox reports email_status=verified, email_kind=role', async () => {
    const row = {
      ...snapshotRow, email: 'smallbusiness@caci.com',
      provenance: { email: { status: 'changed' as const, verifiedAt: '2026-11-17', sourceUrl: 'https://www.caci.com/sbao', staleSince: null } },
    };
    lookup.mockResolvedValue({ contact: contactFrom(row, '2026-06'), candidates: [], matchType: 'exact' });
    const r = await getSbloContact({ company: 'CACI' });
    expect(r._meta.email_status).toBe('verified');
    expect(r._meta.email_kind).toBe('role');
  });

  it('no contact → email_status null', async () => {
    lookup.mockResolvedValue({ contact: null, candidates: [], matchType: 'none' });
    const r = await getSbloContact({ company: 'Nobody' });
    expect(r._meta.email_status).toBeNull();
    expect(r._meta.email_kind).toBeNull();
  });

  it('the hint labels an unverified personal email as not re-verified (no date) instead of presenting it as current', async () => {
    flags.aiHint = true;
    lookup.mockResolvedValue({ contact: contactFrom(snapshotRow, '2026-06'), candidates: [], matchType: 'exact' });
    const r = await getSbloContact({ company: 'CACI' });
    expect(r._ai_hint!.summary).toContain('yadira.beltre@caci.com');
    expect(r._ai_hint!.summary).toMatch(/not re-verified; confirm it before using it/);
    expect(r._ai_hint!.summary).not.toMatch(/2026-06|as of/); // verified_at stays in the data (2026-11-27)
  });
});
