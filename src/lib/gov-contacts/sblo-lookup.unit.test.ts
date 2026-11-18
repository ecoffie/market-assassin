/**
 * Data Core PR 3 — sblo-lookup must not present an unverified or stale contact as verified.
 *
 * A 2026-11-17 sample found none of 9 primes still publishing the personal email we hold, while
 * their official pages publish role mailboxes. The served contact therefore carries an additive
 * `verification` block: per-field status, the date and URL behind it, and the email's kind.
 * A value is `verified` ONLY with field-level provenance (confirmed/changed + sourceUrl).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/bigquery/recipients', () => ({ searchRecipients: vi.fn(async () => ({ rows: [] })) }));

vi.mock('@/data/sblo-roster-2026-06.json', () => ({
  default: {
    metadata: { verified: '2026-06' },
    contacts: [
      // Jun-2026 snapshot row: personal email, no field provenance.
      {
        company: 'CACI INTERNATIONAL INC', sbloName: 'Yadira Beltre', title: 'Small Business Liaison Officer',
        email: 'yadira.beltre@caci.com', phone: null, supplierPortal: 'https://www.caci.com/sbao', source: 'Jun 2026',
      },
      // Refreshed row: role mailbox verified, the liaison's name no longer on the page.
      {
        company: 'NORTHROP GRUMMAN SYSTEMS CORPORATION', sbloName: 'Carla Undurraga', title: 'Sector Manager / SBLO',
        email: 'NGDSSmallBusiness@ngc.com', phone: null, supplierPortal: 'https://www.northropgrumman.com/suppliers/osbp',
        source: 'Nov 2026 refresh',
        provenance: {
          email: { status: 'changed', verifiedAt: '2026-11-17', sourceUrl: 'https://www.northropgrumman.com/suppliers/osbp', staleSince: null },
          sbloName: { status: 'not_named', verifiedAt: '2026-11-17', sourceUrl: 'https://www.northropgrumman.com/suppliers/osbp', staleSince: '2026-11-17' },
          portal: { status: 'confirmed', verifiedAt: '2026-11-17', sourceUrl: 'https://www.northropgrumman.com/suppliers/osbp', staleSince: null },
        },
        personalEmail: 'carla.undurraga@ngc.com',
        personalEmailStatus: 'stale',
      },
      { company: 'AARETE', sbloName: null, title: null, email: null, phone: null, supplierPortal: null, source: 'none found' },
    ],
  },
}));

vi.mock('@/data/prime-contractors-database.json', () => ({
  default: { primes: [{ name: 'PANTEXAS DETERRENCE LLC', sbloName: 'Pat Doe', email: 'pat.doe@pantexas.com', title: 'SBLO', source: 'SBA Prime Directory FY24' }] },
}));

import { lookupSbloContact } from './sblo-lookup';

describe('sblo-lookup verification labelling', () => {
  it('a Jun-2026 snapshot personal email is labelled unverified personal, with the research date — not verified', () => {
    const c = lookupSbloContact('CACI International').contact!;
    expect(c.email).toBe('yadira.beltre@caci.com'); // value unchanged (additive)
    expect(c.verification).toBeDefined();
    expect(c.verification!.basis).toBe('snapshot');
    expect(c.verification!.email_kind).toBe('personal');
    expect(c.verification!.email_status).toBe('unverified');
    expect(c.verification!.fields.email).toEqual({ status: 'unverified', verified_at: '2026-06', source_url: null });
    expect(c.verification!.fields.phone.status).toBeNull();
  });

  it('a refreshed row reports the verified role mailbox and the stale name separately', () => {
    const c = lookupSbloContact('Northrop Grumman Systems').contact!;
    expect(c.email).toBe('NGDSSmallBusiness@ngc.com');
    expect(c.verification!.basis).toBe('field_provenance');
    expect(c.verification!.email_kind).toBe('role');
    expect(c.verification!.email_status).toBe('verified');
    expect(c.verification!.fields.email.source_url).toBe('https://www.northropgrumman.com/suppliers/osbp');
    expect(c.verification!.fields.sbloName.status).toBe('stale');
    expect(c.verification!.fields.portal.status).toBe('verified');
  });

  it('the internally kept personal email is never served', () => {
    const c = lookupSbloContact('Northrop Grumman Systems').contact!;
    expect(JSON.stringify(c)).not.toContain('carla.undurraga@ngc.com');
  });

  it('an empty email has a null status, and prime-DB rows are unverified with no date', () => {
    expect(lookupSbloContact('AArete').contact!.verification!.email_status).toBeNull();
    const p = lookupSbloContact('Pantexas Deterrence').contact!;
    expect(p.matched_from).toBe('prime_db');
    expect(p.verification!.email_status).toBe('unverified');
    expect(p.verification!.fields.email.verified_at).toBeNull();
  });
});
