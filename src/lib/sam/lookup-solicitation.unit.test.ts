/**
 * Historical solicitation lookup — intent, collapse, ranking, isolation, blinds.
 * No emails in assertion messages.
 */
import { describe, expect, it } from 'vitest';
import {
  classifySolicitationIntent,
  firstTurnToolFor,
} from '@/lib/sam/solicitation-intent';
import {
  collapseLookupRows,
  lookupSolicitation,
  parseLookupQuery,
  pickHandoff,
  rankScore,
  whyMatchedFor,
  type LookupItem,
} from '@/lib/sam/lookup-solicitation';
import { creditsFor, isMcpTool, listMcpTools, TOOL_CREDITS } from '@/lib/mcp/tool-registry';
import { P2_FIRST_TURN_INSTRUCTIONS } from '@/lib/mcp/potato-journey';
import { MCP_CONNECTOR_INSTRUCTIONS } from '@/lib/mcp/schedule-discovery';
import type { SolicitationVersionRow } from '@/lib/sam/resolve-solicitation';

const NOW = new Date('2026-09-18T18:00:00.000Z');

const MASA_SOL = 'N0017425RFPREQIHDMDept0002';
const MASA_TITLE = 'Manufacturing & Services Acquisition (MASA) Manufacturing Support';
const AMD3_ID = 'f1aa309fa39040a4929d90a7d88fd091';
const ORIG_ID = 'ce85c48dc296497eb902a0a73ac45680';
const SN0033_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MASAN_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OPEN_ID = 'cccccccccccccccccccccccccccccccc';
const END_SOL = 'N0017426RFPREQM220011';
const CALLER_A = 'caller-a@example.test';
const CALLER_B = 'caller-b@example.test';

function masaRow(partial: Partial<SolicitationVersionRow> & { notice_id: string } & Record<string, unknown>) {
  return {
    solicitation_number: MASA_SOL,
    title: MASA_TITLE,
    department: 'DEPT OF DEFENSE',
    sub_tier: 'DEPT OF THE NAVY',
    office: null,
    naics_code: '332710',
    psc_code: '1377',
    set_aside_description: 'Partial Small Business Set-Aside (FAR 19.5)',
    notice_type: 'Solicitation',
    posted_date: '2026-07-29T00:00:00+00:00',
    response_deadline: '2026-08-27T19:00:00+00:00',
    archive_date: '2026-09-11T00:00:00+00:00',
    active: false,
    description:
      'Amendment 0003, extending the solicitation response/closing date.\n\nRequest for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
    ui_link: null,
    agency_hierarchy: 'DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSEA.NSWC INDIAN HEAD DIVISION',
    office_address: { city: 'Indian Head', state: 'MD' },
    points_of_contact: [{ type: 'primary', fullName: 'Diane Hicks', email: 'diane.hicks@navy.mil', phone: '301-000-0000' }],
    ...partial,
  };
}

const AMD3 = masaRow({ notice_id: AMD3_ID });
const ORIGINAL = masaRow({
  notice_id: ORIG_ID,
  posted_date: '2026-06-17T00:00:00+00:00',
  response_deadline: '2026-07-21T19:00:00+00:00',
  archive_date: '2026-08-05T00:00:00+00:00',
  description: 'Request for Proposal (RFP) N0017426R1003 is hereby issued as of 17 June 2026.',
});
const SN0033 = masaRow({
  notice_id: SN0033_ID,
  solicitation_number: 'N0017426SN0033',
  title: 'Manufacturing Sources Sought — Indian Head',
  posted_date: '2026-05-01T00:00:00+00:00',
  response_deadline: '2026-05-20T00:00:00+00:00',
  archive_date: '2026-06-01T00:00:00+00:00',
  description: 'Sources Sought at Indian Head manufacturing.',
  points_of_contact: [],
});
const MASAN = masaRow({
  notice_id: MASAN_ID,
  solicitation_number: 'W912QR26R0001',
  title: 'Masan Ammo Site construction',
  agency_hierarchy: 'DEPT OF DEFENSE.DEPT OF THE ARMY',
  office_address: { city: 'Masan', state: 'XX' },
  posted_date: '2026-04-01T00:00:00+00:00',
  response_deadline: '2026-04-15T00:00:00+00:00',
  description: 'Masan Ammo Site',
  points_of_contact: [],
});
const OPEN_CTRL = masaRow({
  notice_id: OPEN_ID,
  solicitation_number: '70RTAC26R00000007',
  title: 'Open control solicitation',
  active: true,
  posted_date: '2026-09-01T00:00:00+00:00',
  response_deadline: '2026-12-01T00:00:00+00:00',
  archive_date: null,
  agency_hierarchy: 'HOMELAND SECURITY.TSA',
  office_address: { city: 'Springfield', state: 'VA' },
  description: 'Open TSA solicitation 70RTAC26R00000007',
  points_of_contact: [],
});
const END_V1 = masaRow({
  notice_id: 'dddddddddddddddddddddddddddddddd',
  solicitation_number: END_SOL,
  title: 'Endformers',
  posted_date: '2026-01-10T00:00:00+00:00',
  description: 'Original Endformers N00174-26-RFPREQ-M22-0011',
});
const END_V2 = masaRow({
  notice_id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  solicitation_number: END_SOL,
  title: 'Endformers',
  posted_date: '2026-02-10T00:00:00+00:00',
  description: 'Amendment 0001 Endformers',
});
const END_V3 = masaRow({
  notice_id: 'ffffffffffffffffffffffffffffffff',
  solicitation_number: END_SOL,
  title: 'Endformers',
  posted_date: '2026-03-10T00:00:00+00:00',
  description: 'Amendment 0002 Endformers',
});
const CONSTRUCTION = masaRow({
  notice_id: '11111111111111111111111111111111',
  solicitation_number: 'N4008526R0187',
  title: 'Archived construction',
  active: false,
  posted_date: '2026-03-01T00:00:00+00:00',
  response_deadline: '2026-04-01T00:00:00+00:00',
  archive_date: '2026-04-15T00:00:00+00:00',
  description: 'N4008526R0187 construction',
});
const VA_IT = masaRow({
  notice_id: '22222222222222222222222222222222',
  solicitation_number: '36C10B26Q0654',
  title: 'Archived VA IT',
  active: false,
  posted_date: '2026-02-01T00:00:00+00:00',
  response_deadline: '2026-03-01T00:00:00+00:00',
  archive_date: '2026-03-15T00:00:00+00:00',
  description: '36C10B26Q0654 VA IT',
});

const CORPUS = [ORIGINAL, AMD3, SN0033, MASAN, OPEN_CTRL, END_V1, END_V2, END_V3, CONSTRUCTION, VA_IT];

function ilikeMatch(value: unknown, pat: string): boolean {
  const hay = String(value ?? '').toLowerCase();
  const needle = pat.replace(/^%/, '').replace(/%$/, '').replace(/\\/g, '').toLowerCase();
  return hay.includes(needle);
}

function makeDb(opts?: {
  sam?: typeof CORPUS;
  pipeline?: Array<{ user_email: string; notice_id: string; title?: string; agency?: string }>;
  docs?: Array<{ user_email: string; notice_id: string; filename?: string }>;
}) {
  const sam = opts?.sam ?? CORPUS;
  const pipeline = opts?.pipeline ?? [];
  const docs = opts?.docs ?? [];
  const tables: Record<string, unknown[]> = {
    sam_opportunities: sam,
    user_pipeline: pipeline,
    pursuit_documents: docs,
    user_saved_opportunities: [],
  };

  return {
    from(table: string) {
      let rows = [...(tables[table] || [])] as Record<string, unknown>[];
      const q: Record<string, unknown> = {};
      const self = q as {
        select: () => unknown;
        eq: (c: string, v: unknown) => unknown;
        in: (c: string, v: unknown[]) => unknown;
        ilike: (c: string, p: string) => unknown;
        or: (expr: string) => unknown;
        textSearch: (c: string, t: string) => unknown;
        order: () => unknown;
        limit: () => unknown;
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
      };
      self.select = () => self;
      self.order = () => self;
      self.limit = () => self;
      self.eq = (col, val) => {
        rows = rows.filter((r) => String(r[col] ?? '') === String(val));
        return self;
      };
      self.in = (col, vals) => {
        const set = new Set(vals.map(String));
        rows = rows.filter((r) => set.has(String(r[col] ?? '')));
        return self;
      };
      self.ilike = (col, pat) => {
        rows = rows.filter((r) => ilikeMatch(r[col], pat));
        return self;
      };
      self.or = (expr) => {
        rows = rows.filter((r) => {
          const hay = `${r.agency_hierarchy || ''} ${JSON.stringify(r.office_address || {})} ${r.sub_tier || ''} ${r.description || ''} ${r.title || ''}`.toLowerCase();
          const needles = [...expr.matchAll(/%([^%]+)%/g)].map((m) => m[1].toLowerCase());
          return needles.some((n) => hay.includes(n));
        });
        return self;
      };
      self.textSearch = (_col, token) => {
        const t = String(token).toLowerCase();
        rows = rows.filter((r) =>
          String(r.title || '').toLowerCase().includes(t) ||
          String(r.description || '').toLowerCase().includes(t) ||
          String(r.solicitation_number || '').toLowerCase().includes(t),
        );
        return self;
      };
      self.then = (resolve, reject) =>
        Promise.resolve({ data: rows, error: table === 'user_saved_opportunities' ? null : null }).then(resolve, reject);
      return self;
    },
  };
}

describe('solicitation intent routing (short-circuits FIND)', () => {
  it('CURRENT_FIND: VA IT market hunt → find_opportunities', () => {
    const q = 'I sell IT services and want to work with the VA.';
    expect(classifySolicitationIntent(q)).toBe('CURRENT_FIND');
    expect(firstTurnToolFor(q)).toBe('find_opportunities');
  });

  it('HISTORICAL: Navy manufacturing bid at Indian Head → lookup_solicitation, not FIND', () => {
    const q = 'I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?';
    expect(classifySolicitationIntent(q)).toBe('HISTORICAL');
    expect(firstTurnToolFor(q)).toBe('lookup_solicitation');
  });

  it('KNOWN_ID: solicitation number / UUID → lookup_solicitation', () => {
    expect(firstTurnToolFor('Show me N0017426R1003.')).toBe('lookup_solicitation');
    expect(classifySolicitationIntent('Show me N0017426R1003.')).toBe('KNOWN_ID');
    expect(firstTurnToolFor(AMD3_ID)).toBe('lookup_solicitation');
  });

  it('host instructions short-circuit FIND before P2 FIND-first', () => {
    const idxHist = P2_FIRST_TURN_INSTRUCTIONS.indexOf('lookup_solicitation');
    const idxFind = P2_FIRST_TURN_INSTRUCTIONS.indexOf('Call find_opportunities ONCE using the user\'s words');
    expect(idxHist).toBeGreaterThanOrEqual(0);
    expect(idxFind).toBeGreaterThan(idxHist);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Do not call FIND first and then lookup/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(P2_FIRST_TURN_INSTRUCTIONS);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/HISTORICAL \/ KNOWN_ID SHORT-CIRCUIT/i);
  });
});

describe('lookup ranking + collapse (unit)', () => {
  it('does not treat the word "it" in "find it" as a capability', () => {
    expect(parseLookupQuery('I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?').capability)
      .toEqual(['manufacturing']);
  });
  it('does not collapse MASA with Masan or SN0033', () => {
    const collapsed = collapseLookupRows([AMD3, ORIGINAL, SN0033, MASAN] as never);
    const sols = collapsed.map((r) => r.solicitation_number).sort();
    expect(sols).toEqual(['N0017425RFPREQIHDMDept0002', 'N0017426SN0033', 'W912QR26R0001'].sort());
    const masa = collapsed.filter((r) => r.solicitation_number === MASA_SOL);
    expect(masa).toHaveLength(1);
    expect(masa[0].notice_id).toBe(AMD3_ID);
  });

  it('USER_PURSUIT outranks public corpus', () => {
    expect(rankScore(['user_pursuit', 'strong_title'], null, NOW)).toBeGreaterThan(
      rankScore(['buyer_capability_date'], null, NOW),
    );
  });

  it('program acronym does not match Masan as MASA', () => {
    const whyMasa = whyMatchedFor(AMD3 as never, {
      identifiers: [],
      acronyms: ['MASA'],
      capability: ['manufacturing'],
      buyerGeo: ['Indian Head'],
      buyerOrg: ['NAVY'],
      recentlyDays: 120,
      tokens: ['manufacturing'],
    }, { fromHistory: false, fromFilename: false });
    const whyMasan = whyMatchedFor(MASAN as never, {
      identifiers: [],
      acronyms: ['MASA'],
      capability: ['manufacturing'],
      buyerGeo: ['Indian Head'],
      buyerOrg: ['NAVY'],
      recentlyDays: 120,
      tokens: ['masa'],
    }, { fromHistory: false, fromFilename: false });
    expect(whyMasa).toContain('program_acronym');
    expect(whyMasan).not.toContain('program_acronym');
  });
});

describe('lookupSolicitation blinds A–G (stub corpus)', () => {
  it('A. MASA without number is MATCHED_CANDIDATE, not silently identity', async () => {
    const result = await lookupSolicitation({
      query: 'I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?',
      client: makeDb() as never,
      now: NOW,
    });
    expect(result.intent).toBe('HISTORICAL');
    const masa = result.items.find((i) => i.notice_id === AMD3_ID || i.identifiers.includes(MASA_SOL));
    expect(masa).toBeTruthy();
    expect(masa!.kind).toBe('MATCHED_CANDIDATE');
    expect(masa!.title).toMatch(/MASA/);
    expect(masa!.not_biddable).toBe(true);
    expect(masa!.award_status).toBe('AWARD_NOT_ESTABLISHED');
    expect(masa!.latest_amendment).toMatch(/0003/);
    expect(masa!.status).toBe('archived');
    expect(result.items.every((i) => i.kind !== 'RESOLVED_SOLICITATION')).toBe(true);
    expect(result._meta.sow_text_used).toBe(false);
    expect(result._meta.external_api).toBe(false);
  });

  it('B. Endformers multi-version collapses to one candidate', async () => {
    const result = await lookupSolicitation({
      query: 'N00174-26-RFPREQ-M22-0011',
      client: makeDb() as never,
      now: NOW,
    });
    expect(result.intent).toBe('KNOWN_ID');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe('RESOLVED_SOLICITATION');
    expect(result.items[0].notice_id).toBe(END_V3.notice_id);
    expect(result.items[0].version_count).toBe(3);
  });

  it('C. Archived construction N4008526R0187', async () => {
    const result = await lookupSolicitation({
      query: 'N4008526R0187',
      client: makeDb() as never,
      now: NOW,
    });
    expect(result.items[0].kind).toBe('RESOLVED_SOLICITATION');
    expect(result.items[0].not_biddable).toBe(true);
    expect(result.items[0].status).not.toBe('open');
    expect(result.items[0].award_status).toBe('AWARD_NOT_ESTABLISHED');
  });

  it('D. Archived VA IT 36C10B26Q0654', async () => {
    const result = await lookupSolicitation({
      query: '36C10B26Q0654',
      client: makeDb() as never,
      now: NOW,
    });
    expect(result.items[0].identifiers.some((id) => /36C10B26Q0654/i.test(id))).toBe(true);
    expect(result.items[0].not_biddable).toBe(true);
    expect(result.items[0].status).not.toBe('open');
  });

  it('E. OPEN CONTROL remains OPEN / not_biddable=false', async () => {
    const result = await lookupSolicitation({
      query: '70RTAC26R00000007',
      client: makeDb() as never,
      now: NOW,
    });
    expect(result.items[0].status).toBe('open');
    expect(result.items[0].not_biddable).toBe(false);
  });

  it('F. MASA vs Masan stay separate candidates', async () => {
    const result = await lookupSolicitation({
      query: 'What happened with MASA?',
      client: makeDb() as never,
      now: NOW,
    });
    const masa = result.items.filter((i) => (i.title || '').includes('(MASA)'));
    const masan = result.items.filter((i) => (i.title || '').includes('Masan'));
    expect(masa.length).toBeGreaterThan(0);
    expect(masa[0].kind).toBe('MATCHED_CANDIDATE');
    if (masan.length) {
      expect(masan[0].notice_id).not.toBe(masa[0].notice_id);
      expect(masan[0].identifiers.some((id) => id === MASA_SOL)).toBe(false);
    }
  });

  it('G. authenticated caller history ranks ahead of public corpus; other caller isolated', async () => {
    const db = makeDb({
      pipeline: [
        { user_email: CALLER_A, notice_id: ORIG_ID, title: 'Manufacturing ', agency: null },
      ],
      docs: [
        { user_email: CALLER_A, notice_id: ORIG_ID, filename: 'MASA_N0017426R1003.pdf' },
      ],
    });
    const a = await lookupSolicitation({
      query: 'I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?',
      userEmail: CALLER_A,
      client: db as never,
      now: NOW,
    });
    expect(a.items[0].why_matched).toContain('user_pursuit');
    expect(a.items[0].notice_id).toBe(AMD3_ID);
    expect(JSON.stringify(a)).not.toMatch(/@example\.test/i);

    const b = await lookupSolicitation({
      query: 'I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?',
      userEmail: CALLER_B,
      client: db as never,
      now: NOW,
    });
    expect(b.items[0].why_matched).not.toContain('user_pursuit');
    expect(b._meta.history_matches).toBe(0);
  });

  it('confirm upgrades MATCHED_CANDIDATE to RESOLVED current truth', async () => {
    const result = await lookupSolicitation({
      query: 'yes that is the one',
      confirm_notice_id: ORIG_ID,
      client: makeDb() as never,
      now: NOW,
    });
    expect(result.items[0].kind).toBe('RESOLVED_SOLICITATION');
    expect(result.items[0].notice_id).toBe(AMD3_ID);
    expect(result.items[0].latest_amendment).toMatch(/0003/);
    expect(result.items[0].contact?.name).toBe('Diane Hicks');
    expect(result.items[0].identifiers.some((id) => /N0017426R1003/i.test(id))).toBe(true);
  });
});

describe('lookup tool contract', () => {
  it('is a 5-credit scan tool, not FIND', () => {
    expect(isMcpTool('lookup_solicitation')).toBe(true);
    expect(creditsFor('lookup_solicitation')).toBe(5);
    expect(TOOL_CREDITS.lookup_solicitation).toBe(5);
    expect(TOOL_CREDITS.find_opportunities).toBe(10);
    expect(listMcpTools().map((t) => (t.function as { name: string }).name)).toContain('lookup_solicitation');
    const def = listMcpTools().find((t) => (t.function as { name: string }).name === 'lookup_solicitation') as {
      function: { parameters: { properties: Record<string, unknown> } };
    };
    expect(def.function.parameters.properties.email).toBeUndefined();
  });

  it('does not invent awards in handoff', () => {
    const item: LookupItem = {
      kind: 'RESOLVED_SOLICITATION',
      title: MASA_TITLE,
      identifiers: [MASA_SOL],
      status: 'archived',
      award_status: 'AWARD_NOT_ESTABLISHED',
      latest_amendment: 'Amendment 0003',
      response_deadline: AMD3.response_deadline,
      posted_date: AMD3.posted_date,
      archive_date: AMD3.archive_date,
      buyer: 'NSWC INDIAN HEAD DIVISION',
      office_dodaac: 'N00174',
      naics: '332710',
      psc: '1377',
      contact: { name: 'Diane Hicks', email: 'diane.hicks@navy.mil', phone: null },
      notice_id: AMD3_ID,
      why_matched: ['program_acronym'],
      provenance: 'sam_opportunities',
      not_biddable: true,
      version_count: 4,
    };
    const prompt = pickHandoff([item], false);
    expect(prompt).toMatch(/award isn't in Mindy yet/i);
    expect(prompt).not.toMatch(/debrief/i);
  });
});
