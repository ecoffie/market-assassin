import { describe, it, expect, vi } from 'vitest';
import { officeRemainder, looksLikeOffice, resolveAwardingOffices } from './office-resolve';

describe('office detection', () => {
  it('finds the office part of an agency phrase', () => {
    expect(officeRemainder('USACE Memphis District')).toBe('Memphis');
    expect(looksLikeOffice('USACE Memphis District', 'Memphis')).toBe(true);
    expect(looksLikeOffice('VA Memphis', 'Memphis')).toBe(true);
  });
  it('a plain or formal agency name is never treated as an office (no lookup, nothing reported)', () => {
    expect(officeRemainder('Department of the Army')).toBeNull();
    expect(officeRemainder('Navy')).toBeNull();
    expect(looksLikeOffice('Department of Homeland Security', officeRemainder('Department of Homeland Security'))).toBe(false);
    expect(looksLikeOffice('Small Business Administration', officeRemainder('Small Business Administration'))).toBe(false);
  });
});

describe('resolveAwardingOffices', () => {
  const payload = { results: { office: [
    { code: '36C614', name: '614-MEMPHIS(00614)', subtier_agency: { name: 'Department of Veterans Affairs' } },
    { code: 'W38GNW', name: 'W18X MEPS MEMPHIS', subtier_agency: { name: 'Department of the Army' } },
    { code: 'W912EQ', name: 'W07V ENDIST MEMPHIS', subtier_agency: { name: 'Department of the Army' } },
  ] } };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
  it('keeps offices of the resolved sub-agency and prefers engineer districts for USACE', async () => {
    const r = await resolveAwardingOffices('USACE Memphis District', 'Department of the Army', fetcher);
    expect(r.offices.map((o) => o.code)).toEqual(['W912EQ']);
  });
  it('a lookup error is reported, never a silent empty', async () => {
    const bad = vi.fn(async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    const r = await resolveAwardingOffices('USACE Memphis District', 'Department of the Army', bad);
    expect(r).toMatchObject({ offices: [], error: 'office lookup HTTP 503' });
  });
});
