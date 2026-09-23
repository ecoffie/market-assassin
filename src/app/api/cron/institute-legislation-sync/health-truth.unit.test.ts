/**
 * Legislation HEALTH TRUTH — driven through the real GET handler in EXECUTE mode.
 * Congress, the database, ingest and derivation are faked; the document builder,
 * clock derivation, notes encoding and control-plane patch are real.
 *
 * Two production defects, 2026-09-23 (NDAA activation, health invariant step):
 *   1. 119-S1071-ENR has no version date; its bill record was edited 2026-09-22. The
 *      per-document watermark fell back to that updateDate and advanced
 *      lastSourceAdvance to 2026-09-22 ("healthy, 1 day") though the newest dated
 *      legislative publication was 2026-07-30.
 *   2. A successful run stamped the notes clock (2026-09-23) but never the control
 *      plane, which stayed at its seed time (2026-09-20).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { decodeLegislationClocks, legislativeSourceAdvance, legislationInstancePatch } from '@/lib/institute/legislation-clocks';

type Update = { table: string; patch: Record<string, unknown>; filter: [string, unknown] | null };
const updates: Update[] = [];
let instanceUpdateError: { message: string } | null = null;

function builder(table: string) {
  let pending: Update | null = null;
  const single = async () => {
    if (table === 'data_sources') return { data: { notes: 'human notes' }, error: null };
    if (table === 'institute_sources') return { data: { discovered_at: '2026-09-20T12:59:37Z' }, error: null };
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b, in: () => b, order: () => b, limit: () => b,
    maybeSingle: single,
    update: (patch: Record<string, unknown>) => { pending = { table, patch, filter: null }; return b; },
    eq: (col: string, val: unknown) => { if (pending) pending.filter = [col, val]; return b; },
    then: (res: (v: unknown) => unknown) => {
      if (pending) updates.push(pending);
      const error = pending && table === 'data_source_instances' ? instanceUpdateError : null;
      return Promise.resolve({ data: null, error }).then(res);
    },
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: async () => undefined }));
vi.mock('@/lib/institute/sources', () => ({
  ingestInstituteDocument: async () => ({ inserted: false, updated: ingestUpdates, error: null, instituteSourceId: 'id', resolution: { resolved: true } }),
}));
vi.mock('@/lib/strategic-intel/derive', () => ({ deriveFromInstituteSource: async () => ({ outcome: 'evidence_only_no_claim' }) }));

type Ref = { congress: number; billType: string; number: string; title: string; updateDate: string | null; originChamber: string | null };
const TITLE = 'National Defense Authorization Act for Fiscal Year 2026';
const refs: Ref[] = [
  // Bill record METADATA was edited on 2026-09-22 — that is not a publication.
  { congress: 119, billType: 'S', number: '1071', title: TITLE, updateDate: '2026-09-22', originChamber: 'Senate' },
  { congress: 119, billType: 'HR', number: '8800', title: 'National Defense Authorization Act for Fiscal Year 2027', updateDate: '2026-09-21', originChamber: 'House' },
];
let extraDatedVersion: string | null = null;
let ingestUpdates = false;

vi.mock('@/lib/institute/legislation-discovery', async (orig) => ({
  ...(await orig<typeof import('@/lib/institute/legislation-discovery')>()),
  discoverSince: async () => ({ pollOk: true, coverage: 'complete', scanned: 2, reportedTotal: 2, windowFrom: null, matched: refs, nextWatermark: '2026-09-23T00:00:00Z' }),
  knownMeasures: async () => ({ measures: [] }),
}));
vi.mock('@/lib/institute/legislation', async (orig) => {
  const real = await orig<typeof import('@/lib/institute/legislation')>();
  return {
    ...real,
    congressApiKey: () => 'test-key',
    collectBillDocuments: async (ref: Ref) => {
      const law = ref.number === '1071';
      const status = { latestActionDate: null, latestActionText: null, becameLaw: law, lawNumber: law ? '119-60' : null };
      const versions = law
        ? [
            { type: 'Introduced in Senate', date: '2025-03-14', formats: [] },
            { type: 'Enrolled Bill', date: null, formats: [] },   // the real undated ENR
          ]
        : [
            { type: 'Engrossed in House', date: '2026-07-30', formats: [] },
            ...(extraDatedVersion ? [{ type: 'Engrossed Amendment Senate', date: extraDatedVersion, formats: [] }] : []),
          ];
      return { documents: real.billVersionsToDocuments(ref, versions as never, status, '2026-09-23T00:00:00Z'), status };
    },
  };
});

import { GET } from './route';

async function run() {
  const res = await GET(new NextRequest('http://local/api/cron/institute-legislation-sync?password=pw'));
  return { status: res.status, body: await res.json() };
}
const notesClock = () => decodeLegislationClocks(updates.find((u) => u.table === 'data_sources')?.patch.notes as string);
const instance = () => updates.find((u) => u.table === 'data_source_instances');

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'pw';
  updates.length = 0;
  extraDatedVersion = null;
  ingestUpdates = false;
  instanceUpdateError = null;
});

describe('lastSourceAdvance is a defensible publication date, never bill-record metadata', () => {
  it('REGRESSION 2026-09-23: undated S1071-ENR + bill record edited 2026-09-22 + newest dated text 2026-07-30 → 2026-07-30', async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.documentsSeen).toBe(3);                 // the undated ENR is still held
    expect(body.clocks.lastSourceAdvance).toBe('2026-07-30');
    expect(notesClock()?.lastSourceAdvance).toBe('2026-07-30');
    expect(instance()?.patch.last_source_advance).toBe('2026-07-30T00:00:00.000Z');
  });

  it('an actually newer DATED legislative version advances the clock', async () => {
    extraDatedVersion = '2026-09-18';
    const { body } = await run();
    expect(body.clocks.lastSourceAdvance).toBe('2026-09-18');
    expect(instance()?.patch.last_source_advance).toBe('2026-09-18T00:00:00.000Z');
  });

  it('undated documents stay held and provenanced — the collector still records them', async () => {
    const real = await vi.importActual<typeof import('@/lib/institute/legislation')>('@/lib/institute/legislation');
    const [enr] = real.billVersionsToDocuments(refs[0], [{ type: 'Enrolled Bill', date: null, formats: [] }] as never,
      { latestActionDate: null, latestActionText: null, becameLaw: true, lawNumber: '119-60' }, '2026-09-23T00:00:00Z');
    expect(enr.documentNumber).toBe('119-S1071-ENR');
    expect(enr.publicationDate).toBeNull();            // no date is invented
    expect(enr.raw).toMatchObject({ versionCode: 'ENR', lawStatusAtIngestion: 'enacted' });
    expect(legislativeSourceAdvance([enr])).toBeNull(); // unknown, not the record's updateDate
  });

  it('metadata-only activity never moves the clock; absence of any date is unknown', () => {
    expect(legislativeSourceAdvance([{ publicationDate: '2026-07-30' }, { publicationDate: null }])).toBe('2026-07-30');
    expect(legislativeSourceAdvance([{ publicationDate: null }, { publicationDate: null }])).toBeNull();
    expect(legislativeSourceAdvance([])).toBeNull();
  });
});

describe('one successful execution stamps BOTH views with the same clocks', () => {
  it('REGRESSION 2026-09-23: control-plane last_poll equals the notes lastPoll from the same run', async () => {
    const { body } = await run();
    const n = notesClock()!;
    const i = instance()!;
    expect(i.filter).toEqual(['source_key', 'institute_legislation']);
    expect(i.patch.last_poll).toBe(n.lastPoll);
    expect(i.patch.last_successful_check).toBe(n.lastPoll);
    expect(i.patch.last_verified_ingest).toBe(n.lastPoll);
    expect(body).toMatchObject({ clocksStamped: true, controlPlaneStamped: true });
  });

  it('keeps the four clocks distinct: no corpus change → last_data_advance untouched', async () => {
    await run();
    expect(instance()!.patch).not.toHaveProperty('last_data_advance');
  });

  it('a real corpus change advances last_data_advance', async () => {
    ingestUpdates = true;
    await run();
    expect(instance()!.patch.last_data_advance).toBe(notesClock()!.lastPoll);
  });

  it('never writes the operator-owned parked state', async () => {
    await run();
    const keys = Object.keys(instance()!.patch);
    for (const k of ['source_state', 'intervention_state', 'manual_action_type']) expect(keys).not.toContain(k);
  });

  it('a failed control-plane write is reported, never claimed', async () => {
    instanceUpdateError = { message: 'boom' };
    const { body } = await run();
    expect(body.controlPlaneStamped).toBe(false);
  });

  it('pure patch: incomplete coverage does not claim a successful check', () => {
    const p = legislationInstancePatch({ pollAt: '2026-09-27T13:40:00Z', coverageComplete: false, corpusChanged: false, sourceAdvance: null });
    expect(p).not.toHaveProperty('last_successful_check');
    expect(p.last_source_advance).toBeNull();
  });
});
