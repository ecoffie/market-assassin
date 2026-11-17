/**
 * /offices/[dodaac]: the thin-content gate, DoD scope, the sitemap-prefix rule, and the
 * "a failed read is never a zero" contract of the data layer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Res = { data: unknown; error: { message: string } | null; count?: number | null };
const m = vi.hoisted(() => ({
  // Responses keyed by table; each query on that table shifts the next one off.
  responses: {} as Record<string, Res[]>,
  calls: [] as Array<{ table: string; ops: string[] }>,
  mget: vi.fn(),
}));

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@vercel/kv', () => ({ kv: { mget: m.mget, sadd: vi.fn(), zincrby: vi.fn() } }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const ops: string[] = [];
      m.calls.push({ table, ops });
      const settle = () => Promise.resolve(m.responses[table]?.shift() ?? { data: [], error: null, count: 0 });
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'ilike', 'like', 'gt', 'not', 'order', 'limit', 'in', 'or']) {
        q[f] = (...a: unknown[]) => { ops.push(`${f}:${a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('|')}`); return q; };
      }
      q.maybeSingle = () => { ops.push('maybeSingle'); return q; };
      q.range = (...a: unknown[]) => { ops.push(`range:${a.join('|')}`); return settle(); };
      q.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
      return q;
    },
  }),
}));

import {
  officeIndexable,
  officeSitemapEligible,
  isDodOffice,
  dodaacPrefixOf,
  OFFICE_MIN_ACTIVE_NOTICES,
  OFFICE_MIN_CONTACTS,
} from './office-gate';
import { getOfficePageData, getOfficeSitemapEntries, summarizeContacts } from './offices';
import { isSeoTemporarilyUnavailable } from './seo-unavailable';

const DIR_W912PL = { dodaac: 'W912PL', display_name: 'W071 ENDIST LOS ANGELES', agency: 'Department of Defense', sub_agency: 'Department of the Army', award_count: 1200, total_obligated: 5.4e9, updated_at: '2026-10-01T00:00:00Z' };
const person = (i: number, title = 'Contracting Officer') => ({
  contact_fullname: `Pat Buyer${i}`, contact_email: `pat${i}@usace.army.mil`, contact_phone: null,
  contact_title: title, department_ind_agency: 'DEPT OF DEFENSE', contact_kind: 'government_buyer',
});

/** Queue the five page reads (directory, open, active-count, awards, contacts). */
function queuePage(o: { dir?: Res; open?: Res; active?: Res; awards?: Res; contacts?: Res }) {
  m.responses = {
    dodaac_directory_display: [o.dir ?? { data: DIR_W912PL, error: null }],
    sam_opportunities: [
      o.open ?? { data: [], error: null, count: 0 },
      o.active ?? { data: null, error: null, count: 0 },
      o.awards ?? { data: [], error: null },
    ],
    federal_contacts: [o.contacts ?? { data: [], error: null }],
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.responses = {};
  m.calls = [];
  m.mget.mockReset().mockResolvedValue([]);
});

describe('thin-content gate', () => {
  it('indexes on enough active notices OR a real roster, not on less', () => {
    expect(officeIndexable({ activeNotices: OFFICE_MIN_ACTIVE_NOTICES, contacts: 0 })).toBe(true);
    expect(officeIndexable({ activeNotices: 0, contacts: OFFICE_MIN_CONTACTS })).toBe(true);
    expect(officeIndexable({ activeNotices: OFFICE_MIN_ACTIVE_NOTICES - 1, contacts: OFFICE_MIN_CONTACTS - 1 })).toBe(false);
    expect(officeIndexable({ activeNotices: 0, contacts: 0 })).toBe(false);
  });
  it('the sitemap predicate is a subset of the index predicate', () => {
    for (let notices = 0; notices < 10; notices++) {
      for (let contacts = 0; contacts < 10; contacts++) {
        if (officeSitemapEligible(notices)) expect(officeIndexable({ activeNotices: notices, contacts })).toBe(true);
      }
    }
    // A roster-only office is indexable but never advertised.
    expect(officeSitemapEligible(0)).toBe(false);
  });
});

describe('DoD scope and prefix rule', () => {
  it('accepts DoD components and rejects civilian agencies', () => {
    expect(isDodOffice('Department of Defense', 'Department of the Navy')).toBe(true);
    expect(isDodOffice('DEPT OF DEFENSE', 'Defense Logistics Agency')).toBe(true);
    expect(isDodOffice(null, 'Department of the Army')).toBe(true);
    expect(isDodOffice('Department of Veterans Affairs', 'Veterans Affairs')).toBe(false);
    expect(isDodOffice('Defense Nuclear Facilities Safety Board', null)).toBe(false);
    expect(isDodOffice(null, null)).toBe(false);
  });
  it('mirrors ILIKE prefix semantics exactly (case-insensitive, no trimming/de-dashing)', () => {
    expect(dodaacPrefixOf('W912PL26R0001')).toBe('W912PL');
    expect(dodaacPrefixOf('w912pl-26-r-0001')).toBe('W912PL');
    expect(dodaacPrefixOf('N61331-26-Q-KS35')).toBe('N61331');
    expect(dodaacPrefixOf(' W912PL26R0001')).toBeNull(); // ILIKE 'W912PL%' would not match either
    expect(dodaacPrefixOf('W9-12PL')).toBeNull();
    expect(dodaacPrefixOf('12345678')).toBeNull();
    expect(dodaacPrefixOf(null)).toBeNull();
  });
});

describe('contact summary', () => {
  it('dedupes people, buckets roles, and drops vendor POCs and ghost cards', () => {
    const s = summarizeContacts([
      person(1), person(1), person(2, 'Contract Specialist'), person(3, 'Primary Contact'),
      { ...person(4), contact_kind: 'vendor_entity_poc' },
      { ...person(5), contact_fullname: '555-123-4567' },
    ]);
    expect(s.count).toBe(3);
    expect(Object.fromEntries(s.roles.map((r) => [r.role, r.count]))).toEqual({
      'Contracting Officer': 1, 'Contract Specialist': 1, 'Point of contact (role not stated)': 1,
    });
  });
});

describe('getOfficePageData — unknown is never zero', () => {
  it('builds an indexable office from real reads', async () => {
    queuePage({
      open: {
        data: [{ notice_id: 'abc12345abc12345abc12345abc12345', title: 'Dredging services Port Hueneme', description: 'x'.repeat(250), notice_type: 'Solicitation', response_deadline: '2099-01-01', posted_date: '2026-11-01' }],
        error: null, count: 4,
      },
      active: { data: null, error: null, count: 9 },
      contacts: { data: [person(1), person(2), person(3)], error: null },
    });
    const o = await getOfficePageData('w912pl');
    expect(o).not.toBeNull();
    expect(o!.dodaac).toBe('W912PL');
    expect(o!.openCount).toBe(4);
    expect(o!.activeNotices).toBe(9);
    expect(o!.contacts.count).toBe(3);
    expect(o!.indexable).toBe(true);
    expect(o!.openNotices[0].slug).toMatch(/^dredging-services-port-hueneme-/);
    expect(o!.lastModified).toBe('2026-11-01');
    // Every read is anchored on the DoDAAC prefix.
    const prefixed = m.calls.filter((c) => c.table !== 'dodaac_directory_display');
    for (const c of prefixed) expect(c.ops.some((op) => op.includes('W912PL%'))).toBe(true);
  });

  it('a thin office renders but is not indexable', async () => {
    queuePage({ active: { data: null, error: null, count: 1 }, contacts: { data: [person(1)], error: null } });
    const o = await getOfficePageData('W912PL');
    expect(o!.indexable).toBe(false);
  });

  it.each([
    ['directory', { dir: { data: null, error: { message: 'boom' } } }],
    ['open notices', { open: { data: null, error: { message: 'timeout' } } }],
    ['active count', { active: { data: null, error: { message: 'timeout' } } }],
    ['awards', { awards: { data: null, error: { message: 'timeout' } } }],
    ['contacts', { contacts: { data: null, error: { message: 'statement timeout' } } }],
  ])('a failed %s read throws SeoTemporarilyUnavailable instead of rendering 0', async (_label, o) => {
    queuePage(o as Parameters<typeof queuePage>[0]);
    const err = await getOfficePageData('W912PL').catch((e) => e);
    expect(isSeoTemporarilyUnavailable(err)).toBe(true);
  });

  it('a null count (relation missing → count=null, error=null) is unknown, not zero', async () => {
    queuePage({ active: { data: null, error: null, count: null } });
    const err = await getOfficePageData('W912PL').catch((e) => e);
    expect(isSeoTemporarilyUnavailable(err)).toBe(true);
  });

  it('404s only when the directory ANSWERED with a non-DoD or unknown office', async () => {
    queuePage({ dir: { data: { ...DIR_W912PL, dodaac: '36C262', agency: 'Department of Veterans Affairs', sub_agency: 'Veterans Affairs' }, error: null } });
    expect(await getOfficePageData('36C262')).toBeNull(); // invalid shape anyway
    queuePage({ dir: { data: { ...DIR_W912PL, dodaac: 'VA2620', agency: 'Department of Veterans Affairs', sub_agency: null }, error: null } });
    expect(await getOfficePageData('VA2620')).toBeNull();
    queuePage({ dir: { data: null, error: null } });
    expect(await getOfficePageData('ZZ9999')).toBeNull();
    expect(await getOfficePageData('not-a-code')).toBeNull();
  });
});

describe('getOfficeSitemapEntries', () => {
  it('lists DoD offices over the notice floor, counted by the page prefix rule', async () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => ({ solicitation_number: `W912PL26R000${i}`, posted_date: `2026-10-0${i + 1}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ solicitation_number: `N0010426R000${i}`, posted_date: '2026-10-01' })), // under floor
      ...Array.from({ length: 4 }, (_, i) => ({ solicitation_number: `VA262026Q000${i}`, posted_date: '2026-10-01' })), // civilian
    ];
    m.responses = {
      sam_opportunities: [{ data: rows, error: null }],
      dodaac_directory_display: [{
        data: [
          { dodaac: 'W912PL', agency: 'Department of Defense', sub_agency: 'Department of the Army' },
          { dodaac: 'VA2620', agency: 'Department of Veterans Affairs', sub_agency: null },
        ],
        error: null,
      }],
    };
    const out = await getOfficeSitemapEntries();
    expect(out).toEqual([{ dodaac: 'W912PL', lastModified: '2026-10-03' }]);
  });

  it('throws on a read failure instead of publishing an empty family', async () => {
    m.responses = { sam_opportunities: [{ data: null, error: { message: 'timeout' } }] };
    await expect(getOfficeSitemapEntries()).rejects.toThrow(/office sitemap/);
  });
});
