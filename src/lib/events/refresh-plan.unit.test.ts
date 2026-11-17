import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractEvent, adoptCurrentVersionDates, type RefreshNotice, type ExtractedEvent } from './refresh';
import { planRefresh, selectWrites, refreshMode, parseApplyCategories, parseNoticeAllowlist, summarize, type StoredEvent } from './refresh-plan';
import { VERIFIED_BY_NOTICE, VERIFIED_CORRECTIONS, type VerifiedCorrection } from './verified-corrections';

const NOV_10 = new Date('2026-11-10T12:00:00Z');
const ev = (notice_id: string, event_type: string, event_date: string | null, adopted_from: string | null = null): ExtractedEvent => ({ notice_id, event_type, event_date, adopted_from });
const st = (event_type: string, event_date: string | null): StoredEvent => ({ event_type, event_date });
const plan = (events: ExtractedEvent[], stored: Record<string, StoredEvent>, opts: { notices?: RefreshNotice[]; family?: RefreshNotice[]; verified?: ReadonlyMap<string, VerifiedCorrection> } = {}) =>
  planRefresh({ events, stored: new Map(Object.entries(stored)), noticesById: new Map((opts.notices ?? []).map((n) => [n.notice_id, n])), familyNotices: opts.family ?? [], verified: opts.verified ?? new Map(), today: NOV_10 });

const ID = (c: string) => c.repeat(32);
const MIXED = plan(
  [ev(ID('a'), 'industry_day', '2026-12-01'), ev(ID('b'), 'industry_day', '2026-12-02'), ev(ID('c'), 'rfi', '2026-12-03'), ev(ID('d'), 'industry_day', '2026-12-04', ID('9')), ev(ID('e'), 'webinar', '2026-12-05'), ev(ID('f'), 'industry_day', null)],
  { [ID('b')]: st('industry_day', '2026-12-09'), [ID('c')]: st('industry_day', '2026-12-03'), [ID('d')]: st('industry_day', '2026-12-01'), [ID('e')]: st('webinar', '2026-12-05'), [ID('f')]: st('industry_day', '2026-11-20') },
);

describe('categories', () => {
  it('classifies each proposed change into exactly one category', () => {
    expect(Object.fromEntries(MIXED.map((c) => [c.notice_id[0], c.category]))).toEqual({ a: 'new', b: 'date', c: 'type', d: 'adoption', e: 'unchanged', f: 'uncertain' });
    expect(MIXED.find((c) => c.notice_id === ID('f'))?.uncertain_reason).toBe('clears_stored_date');
    expect(summarize(MIXED).type).toEqual({ total: 1, upcoming: 1 });
  });
});

describe('report-only default', () => {
  it('unset, empty or unrecognised SAM_EVENTS_REFRESH means report', () => {
    for (const v of [undefined, '', 'yes', 'APPLY ']) expect(refreshMode(v)).toBe(v === 'APPLY ' ? 'apply' : 'report');
    expect(refreshMode('off')).toBe('off');
  });

  it('report and off write nothing, whatever the allowlists say', () => {
    const all = parseApplyCategories('new,date,adoption,type,restamp');
    const ids = new Set(MIXED.map((c) => c.notice_id));
    expect(selectWrites(MIXED, 'report', all, ids)).toEqual([]);
    expect(selectWrites(MIXED, 'off', all, ids)).toEqual([]);
  });

  it('apply with no categories and no ids writes nothing', () => {
    expect(selectWrites(MIXED, 'apply', new Set(), new Set())).toEqual([]);
  });
});

describe('reviewed batches', () => {
  it('applies only the listed categories', () => {
    expect(selectWrites(MIXED, 'apply', parseApplyCategories('date'), new Set()).map((c) => c.notice_id[0])).toEqual(['b']);
    expect(selectWrites(MIXED, 'apply', parseApplyCategories('new, adoption'), new Set()).map((c) => c.notice_id[0])).toEqual(['a', 'd']);
    expect(selectWrites(MIXED, 'apply', parseApplyCategories('restamp'), new Set()).map((c) => c.notice_id[0])).toEqual(['e']);
  });

  it('type changes are never written unless `type` is listed (no uncontrolled reclassification)', () => {
    const noType = parseApplyCategories('new,date,adoption,restamp,types,typo');
    expect(noType.has('type')).toBe(false);
    expect(selectWrites(MIXED, 'apply', noType, new Set()).some((c) => c.category === 'type')).toBe(false);
  });

  it('uncertain records need an explicit notice id; an id writes that record whatever its category', () => {
    const all = parseApplyCategories('new,date,adoption,type,restamp');
    expect(selectWrites(MIXED, 'apply', all, new Set()).some((c) => c.category === 'uncertain')).toBe(false);
    expect(selectWrites(MIXED, 'apply', new Set(), parseNoticeAllowlist(`${ID('f')}, ${ID('c')}, not-an-id`)).map((c) => c.notice_id[0])).toEqual(['c', 'f']);
  });
});

describe('verified corrections are preserved', () => {
  const all = parseApplyCategories('new,date,adoption,type,restamp');

  it('covers the 22 corrected rows, keyed by notice id', () => {
    expect(VERIFIED_CORRECTIONS).toHaveLength(22);
    expect(VERIFIED_BY_NOTICE.size).toBe(22);
  });

  it('SIMO: extractor says rfi 2026-12-07, the verified row says industry_day with no date → uncertain, not written', () => {
    const simo = 'fff15eda49e84966ac21f547b34e2afe';
    const p = plan([ev(simo, 'rfi', '2026-12-07')], { [simo]: st('industry_day', null) }, { verified: VERIFIED_BY_NOTICE });
    expect(p[0]).toMatchObject({ category: 'uncertain', underlying: 'type', uncertain_reason: 'conflicts_verified_correction', verified: { superseded: false } });
    expect(selectWrites(p, 'apply', all, new Set())).toEqual([]);
  });

  it('GOCO older notices: blank solicitation number, own text says Nov 17 → NOT reverted from the verified Nov 18', () => {
    for (const id of ['0a11491ad132434dbd30e7268c2fcb5c', '447081bac39c4b89ada28ea770794510']) {
      const own: RefreshNotice = { notice_id: id, solicitation_number: '(blank)', notice_type: 'Special Notice', posted_date: '2026-10-15', response_deadline: null, title: 'GOCO Industry Day', description: 'The GOCO Industry Day will be held on November 17, 2026.' };
      const newer: RefreshNotice = { ...own, notice_id: ID('7'), posted_date: '2026-11-12', description: 'The GOCO Industry Day will be held on November 20, 2026.' };
      const p = plan([extractEvent(own, NOV_10)!], { [id]: st('industry_day', '2026-11-18') }, { notices: [own], family: [own, newer], verified: VERIFIED_BY_NOTICE });
      expect(p[0]).toMatchObject({ category: 'uncertain', proposed: { event_date: '2026-11-17' }, verified: { superseded: false } }); // blank sol # → never linked
      expect(selectWrites(p, 'apply', all, new Set())).toEqual([]);
    }
  });

  it('a verified row the refresh agrees with is just unchanged (TSA original adopts Nov 18)', () => {
    const tsa = 'f98693bbb744490cb7920e8b2651c1d7';
    const p = plan([ev(tsa, 'industry_day', '2026-11-18', 'db864acb24374165a33376f5511301c4')], { [tsa]: st('industry_day', '2026-11-18') }, { verified: VERIFIED_BY_NOTICE });
    expect(p[0].category).toBe('unchanged');
  });

  it('marks a conflict SUPERSEDED when a newer notice in the confirmed family states another date', () => {
    const v: VerifiedCorrection = { notice_id: ID('1'), event_type: 'industry_day', event_date: '2026-11-18', verified_on: '2026-11-09', evidence: 't' };
    const src: RefreshNotice = { notice_id: ID('1'), solicitation_number: 'TSA25-04-0644', notice_type: 'Special Notice', posted_date: '2026-10-16', response_deadline: null, title: 'Domestic Aviation Design Industry Day', description: 'Industry Day -- November 17, 2026' };
    const amend2: RefreshNotice = { ...src, notice_id: ID('2'), posted_date: '2026-11-12', description: 'Amendment 2. The Domestic Aviation Design Industry Day will be held on December 2, 2026.' };
    const extracted = [extractEvent(src, NOV_10)!];
    const adopted = adoptCurrentVersionDates(extracted, new Map([[src.notice_id, src]]), [src, amend2], NOV_10).events;
    const p = plan(adopted, { [src.notice_id]: st('industry_day', '2026-11-18') }, { notices: [src], family: [src, amend2], verified: new Map([[v.notice_id, v]]) });
    expect(p[0]).toMatchObject({ category: 'uncertain', proposed: { event_date: '2026-12-02' }, verified: { superseded: true, superseded_by: ID('2') } });
    expect(selectWrites(p, 'apply', all, new Set())).toEqual([]); // even superseded: reviewed by notice id
  });
});

describe('the route writes only what selectWrites returns', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/api/cron/extract-sam-events/route.ts'), 'utf8');
  it('reads the mode from SAM_EVENTS_REFRESH and lets dry_run only narrow it', () => {
    expect(SRC).toMatch(/refreshMode\(process\.env\.SAM_EVENTS_REFRESH\)/);
    expect(SRC).toMatch(/const mode = dryRun \? 'report' : envMode;/);
  });
  it('builds rows only for selected writes and upserts only in apply mode', () => {
    expect(SRC).toMatch(/if \(!writeIds\.has\(e\.notice_id\)\) continue;/);
    expect(SRC).toMatch(/if \(mode === 'apply' && events\.length > 0\)/);
    expect(SRC).not.toMatch(/!dryRun && events\.length/);
    expect((SRC.match(/\.from\('sam_events'\)\s*\.upsert/g) || []).length).toBe(1);
  });
  it('protects the verified corrections', () => {
    expect(SRC).toMatch(/verified: VERIFIED_BY_NOTICE/);
  });
});
