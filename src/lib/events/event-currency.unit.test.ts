/**
 * Event currency — T1–T4 of tasks/intelligence-infrastructure-audit-2026-11-09.md §7, on the pure
 * functions, with REAL notice text captured read-only from production (2026-11-17):
 *   TSA `TSA25-04-0644`  original (Nov 17 in its text) + Amendment 1 posted as a new notice (Nov 18)
 *   SIMO `80KSC027R0001` the two newest versions (a sources-sought notice, not an industry day)
 *   VA Air Ambulance    `36C26027Q0095` "December 10-11, 2026" (once stored as the Dec 5 deadline)
 */
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/event-currency-notices.json';
import {
  computeEventDrift,
  familyKeyOf,
  isRetiredSource,
  isUnlistableRow,
  hiddenReason,
  findFutureConfirmations,
  catalogNameMatches,
  readNoticeEvent,
  reconcileFamilyEvents,
  type EventSourceNotice,
} from './event-currency';
import { buildCandidateSet, planEvents, planRetirements, pruneMode, RETIRE_MAX_ROWS } from './extract-run';
import { notInList } from './event-currency-live';

const N = Object.fromEntries((fixture.notices as EventSourceNotice[]).map((n) => [n.notice_id, n]));
const TSA_ORIGINAL = N.f98693bbb744490cb7920e8b2651c1d7;
const TSA_AMD1 = N.db864acb24374165a33376f5511301c4;
const SIMO_NOV2 = N.fff15eda49e84966ac21f547b34e2afe;
const SIMO_NOV9 = N['9271c779de8b440e84c796d57f22f1a0'];
const VA = N.da74fba251794157a586b821fd45573e;
const AUDIT_DAY = new Date('2026-11-09T12:00:00Z');

const notice = (over: Partial<EventSourceNotice>): EventSourceNotice => ({
  notice_id: 'x', title: 'Notice', description: '', notice_type: 'Special Notice',
  posted_date: '2026-11-01', response_deadline: null, solicitation_number: null, active: true, ...over,
});

describe('fixtures read as the audit recorded', () => {
  it('each TSA notice, alone, says its own date', () => {
    expect(readNoticeEvent(TSA_ORIGINAL, AUDIT_DAY)).toEqual({ type: 'industry_day', date: '2026-11-17' });
    expect(readNoticeEvent(TSA_AMD1, AUDIT_DAY)).toEqual({ type: 'industry_day', date: '2026-11-18' });
  });
  it('VA Air Ambulance reads its own industry-day date, not the Dec 5 response deadline', () => {
    expect(readNoticeEvent(VA, AUDIT_DAY)).toEqual({ type: 'industry_day', date: '2026-12-10' });
  });
  it('SIMO is a sources-sought notice: no April 1, 2027 "Industry Engagement" event', () => {
    for (const n of [SIMO_NOV2, SIMO_NOV9]) {
      const r = readNoticeEvent(n, AUDIT_DAY);
      expect(r?.type).toBe('rfi');
      expect(r?.date).not.toBe('2027-04-01');
    }
  });
});

describe('T1 — TSA family: one event, one date', () => {
  it('after one extractor pass both stored rows say Nov 18', () => {
    const planned = planEvents([TSA_ORIGINAL, TSA_AMD1], [], AUDIT_DAY);
    expect(planned.map((p) => [p.notice.notice_id, p.event.date])).toEqual([
      [TSA_ORIGINAL.notice_id, '2026-11-18'],
      [TSA_AMD1.notice_id, '2026-11-18'],
    ]);
    expect(planned[0].event.adoptedFrom).toBe(TSA_AMD1.notice_id);
    expect(planned[1].event.adoptedFrom).toBeNull();
  });

  it('the original adopts the amendment even when only the original is a candidate (amendment in the family pool)', () => {
    const r = reconcileFamilyEvents([TSA_ORIGINAL], [TSA_AMD1], AUDIT_DAY);
    expect(r.get(TSA_ORIGINAL.notice_id)?.date).toBe('2026-11-18');
  });

  it('identity is the solicitation number, case/space-insensitive — never the title', () => {
    const lower = { ...TSA_AMD1, notice_id: 'lower', solicitation_number: ' tsa25-04-0644 ', posted_date: '2026-10-28T00:00:00+00:00' };
    expect(reconcileFamilyEvents([TSA_ORIGINAL], [lower], AUDIT_DAY).get(TSA_ORIGINAL.notice_id)?.adoptedFrom).toBe('lower');
    // Same title, blank solicitation number: no family, no adoption (title merges are forbidden).
    const sameTitle = { ...TSA_AMD1, notice_id: 'no-sol', solicitation_number: null };
    const orphan = { ...TSA_ORIGINAL, notice_id: 'orphan', solicitation_number: '' };
    expect(reconcileFamilyEvents([orphan], [sameTitle], AUDIT_DAY).get('orphan')).toEqual({ type: 'industry_day', date: '2026-11-17', adoptedFrom: null });
    expect(familyKeyOf('')).toBeNull();
  });
});

describe('T2 — a frozen row is re-read', () => {
  it('a notice posted 30 days ago behind a listed event is in the candidate set, ahead of 500 newer notices, and gets today\'s reading', () => {
    const newer = Array.from({ length: 600 }, (_, i) => notice({ notice_id: `new-${i}`, posted_date: '2026-11-19' }));
    const today = new Date('2026-11-20T07:00:00Z'); // VA was posted 2026-10-21
    const candidates = buildCandidateSet([VA], newer);
    expect(candidates.length).toBe(601);
    expect(candidates.slice(0, 500).map((n) => n.notice_id)).toContain(VA.notice_id);
    const planned = planEvents(candidates, [], today).find((p) => p.notice.notice_id === VA.notice_id);
    expect(planned?.event).toEqual({ type: 'industry_day', date: '2026-12-10', adoptedFrom: null });
  });

  it('a notice listed and also active appears once', () => {
    expect(buildCandidateSet([VA], [VA, TSA_AMD1]).map((n) => n.notice_id)).toEqual([VA.notice_id, TSA_AMD1.notice_id]);
  });
});

describe('T3 — the newest version not repeating the event is NOT a cancellation', () => {
  it('older row keeps its own date when the current version omits the event', () => {
    const rfp = notice({ notice_id: 'rfp', notice_type: 'Solicitation', title: 'Domestic Aviation Design', description: 'Request for proposals. See attached.', posted_date: '2026-11-05', solicitation_number: 'TSA25-04-0644' });
    const r = reconcileFamilyEvents([TSA_AMD1], [TSA_ORIGINAL, rfp], AUDIT_DAY);
    expect(r.get(TSA_AMD1.notice_id)).toEqual({ type: 'industry_day', date: '2026-11-18', adoptedFrom: null });
  });

  it('a current version with the event but no date does not erase a dated row', () => {
    const undated = notice({ notice_id: 'undated', title: 'Domestic Aviation Design Industry Day', description: 'The industry day date will be announced.', posted_date: '2026-11-05', solicitation_number: 'TSA25-04-0644' });
    expect(reconcileFamilyEvents([TSA_AMD1], [undated], AUDIT_DAY).get(TSA_AMD1.notice_id)?.date).toBe('2026-11-18');
  });

  it('a notice (rfi) never adopts another version\'s date', () => {
    const r = reconcileFamilyEvents([SIMO_NOV2], [SIMO_NOV9], AUDIT_DAY);
    expect(r.get(SIMO_NOV2.notice_id)?.adoptedFrom).toBeNull();
  });
});

describe('R5 — retired source notices', () => {
  const today = new Date('2026-11-17T00:00:00Z');
  it('inactive AND past the response window is retired', () => {
    expect(isRetiredSource({ active: false, response_deadline: '2026-11-01T00:00:00Z' }, today)).toBe(true);
  });
  it('inactive alone is not (future window, or no window known); active never is', () => {
    expect(isRetiredSource({ active: false, response_deadline: '2026-12-01' }, today)).toBe(false);
    expect(isRetiredSource({ active: false, response_deadline: null }, today)).toBe(false);
    expect(isRetiredSource({ active: true, response_deadline: '2026-01-01' }, today)).toBe(false);
    expect(isRetiredSource(null, today)).toBe(false);
  });
  it('an UNDATED industry day behind a closed notice is not listed; a dated one is judged by its own date', () => {
    const closed = { active: true, response_deadline: '2026-11-01' };
    expect(isUnlistableRow({ event_type: 'industry_day', event_date: null }, closed, today)).toBe(true);
    expect(isUnlistableRow({ event_type: 'industry_day', event_date: '2026-12-01' }, closed, today)).toBe(false);
    expect(isUnlistableRow({ event_type: 'industry_day', event_date: null }, { active: true, response_deadline: '2026-12-01' }, today)).toBe(false);
    expect(isUnlistableRow({ event_type: 'industry_day', event_date: null }, { active: true, response_deadline: null }, today)).toBe(false);
    expect(isUnlistableRow({ event_type: 'rfi', event_date: null }, closed, today)).toBe(false);
  });
  it('the exclusion list is a safe PostgREST literal', () => {
    expect(notInList(['abc123', 'bad id', 'd-e_f'])).toBe('(abc123,d-e_f)');
    expect(notInList([])).toBeNull();
    expect(notInList(null)).toBeNull();
  });
});

describe('R5 safeguard — never hide an independently confirmed future event', () => {
  const today = new Date('2026-11-17T00:00:00Z');
  const closed = { active: true, response_deadline: '2026-11-01' };
  const undated = { notice_id: 'old', title: 'Widget Industry Day', event_type: 'industry_day', event_date: null, source: 'sam_gov', solicitation_number: 'W912PL26R0001' };

  it('records the reason it hides', () => {
    expect(hiddenReason(undated, closed, today)).toBe('undated_closed_notice');
    expect(hiddenReason({ event_type: 'industry_day', event_date: '2026-12-01' }, { active: false, response_deadline: '2026-11-01' }, today)).toBe('retired_source');
  });

  it('a NEWER notice in the same solicitation family with a future date confirms it', () => {
    const newer = { notice_id: 'new', title: 'Widget Industry Day (Amendment 1)', event_type: 'industry_day', event_date: '2026-12-03', source: 'sam_gov', solicitation_number: 'w912pl26r0001' };
    const posted = new Map([['old', '2026-10-01'], ['new', '2026-10-20']]);
    const c = findFutureConfirmations([undated], { rows: [undated, newer], postedById: posted, catalog: [] }, today);
    expect(c.get('old')).toEqual({ kind: 'family_newer_notice', date: '2026-12-03', ref: 'new' });
    expect(hiddenReason(undated, closed, today, c.get('old'))).toBeNull();
  });

  it('an OLDER family notice, a past date, or a different family does not confirm it', () => {
    const older = { notice_id: 'older', title: 'x', event_type: 'industry_day', event_date: '2026-12-03', source: 'sam_gov', solicitation_number: 'W912PL26R0001' };
    const past = { notice_id: 'past', title: 'x', event_type: 'industry_day', event_date: '2026-11-10', source: 'sam_gov', solicitation_number: 'W912PL26R0001' };
    const other = { notice_id: 'other', title: 'x', event_type: 'industry_day', event_date: '2026-12-03', source: 'sam_gov', solicitation_number: 'N0017426R1003' };
    const posted = new Map([['old', '2026-10-01'], ['older', '2026-09-01'], ['past', '2026-10-20'], ['other', '2026-10-20']]);
    expect(findFutureConfirmations([undated], { rows: [undated, older, past, other], postedById: posted, catalog: [] }, today).size).toBe(0);
  });

  it('a curated catalog next_occurrence in the future that names the event confirms it', () => {
    const nvsbe = { ...undated, notice_id: 'va', title: 'VA OSDBU NVSBE 2026 Vendor Outreach Session', solicitation_number: null };
    const c = findFutureConfirmations([nvsbe], { rows: [nvsbe], postedById: new Map(), catalog: [{ name: 'National Veterans Small Business Engagement (NVSBE)', start: '2026-12-08' }] }, today);
    expect(c.get('va')).toEqual({ kind: 'catalog', date: '2026-12-08', ref: 'National Veterans Small Business Engagement (NVSBE)' });
    expect(catalogNameMatches('Small business forum', 'National Veterans Small Business Engagement (NVSBE)')).toBe(false);
    expect(findFutureConfirmations([nvsbe], { rows: [nvsbe], postedById: new Map(), catalog: [{ name: 'National Veterans Small Business Engagement (NVSBE)', start: '2026-10-01' }] }, today).size).toBe(0);
  });

  it('another source\'s row for the same event with a future date confirms it; a low-confidence one does not', () => {
    const ai = { notice_id: 'ai-1', title: 'Widget Industry Day', event_type: 'industry_day', event_date: '2026-12-10', source: 'ai_web_search', confidence: 0.9, solicitation_number: null };
    expect(findFutureConfirmations([undated], { rows: [undated, ai], postedById: new Map(), catalog: [] }, today).get('old')).toEqual({ kind: 'other_source', date: '2026-12-10', ref: 'ai-1' });
    const weak = { ...ai, confidence: 0.4 };
    expect(findFutureConfirmations([undated], { rows: [undated, weak], postedById: new Map(), catalog: [] }, today).size).toBe(0);
  });
});

describe('R6 — drift', () => {
  it('stored rows that disagree with the current family version are drift; corrected rows are not', () => {
    const stored = [
      { notice_id: TSA_ORIGINAL.notice_id, event_type: 'industry_day', event_date: '2026-11-13', solicitation_number: 'TSA25-04-0644' },
      { notice_id: TSA_AMD1.notice_id, event_type: 'industry_day', event_date: '2026-11-18', solicitation_number: 'TSA25-04-0644' },
      { notice_id: SIMO_NOV2.notice_id, event_type: 'industry_day', event_date: '2027-04-01', solicitation_number: '80KSC027R0001' },
    ];
    const r = computeEventDrift(stored, [TSA_ORIGINAL, TSA_AMD1, SIMO_NOV2], [SIMO_NOV9], AUDIT_DAY);
    expect(r.drift.map((d) => [d.notice_id, d.reason])).toEqual([
      [TSA_ORIGINAL.notice_id, 'date'],
      [SIMO_NOV2.notice_id, 'type'],
    ]);
    expect(r.countable).toBe(2);
  });

  it('blank-solicitation drift is reported but excluded from the count; retired sources are not drift', () => {
    const blank = notice({ notice_id: 'goco', title: 'GOCO Industry Day', description: 'Industry Day on November 19, 2026.' });
    const dead = notice({ notice_id: 'dead', title: 'Old Industry Day', active: false, response_deadline: '2026-10-01', solicitation_number: 'W912PL26R0001' });
    const r = computeEventDrift(
      [
        { notice_id: 'goco', event_type: 'industry_day', event_date: '2026-11-20' },
        { notice_id: 'dead', event_type: 'industry_day', event_date: '2026-12-01' },
      ],
      [blank, dead], [], AUDIT_DAY,
    );
    expect(r.drift).toHaveLength(1);
    expect(r.blankSolBound).toBe(1);
    expect(r.countable).toBe(0);
    expect(r.retiredSourceHidden).toBe(1);
  });
});

describe('R6 — drift waits for the next run, not forever', () => {
  it('an amendment stored after the last extractor run is pending, not countable; once a run has passed it counts', () => {
    const stored = [{ notice_id: TSA_ORIGINAL.notice_id, event_type: 'industry_day', event_date: '2026-11-17', solicitation_number: 'TSA25-04-0644' }];
    const amd = { ...TSA_AMD1, created_at: '2026-10-27T09:00:00Z' };
    const before = computeEventDrift(stored, [TSA_ORIGINAL], [amd], AUDIT_DAY, '2026-10-27T07:00:00Z');
    expect(before.drift).toHaveLength(1);
    expect(before.pendingNextRun).toBe(1);
    expect(before.countable).toBe(0);
    const after = computeEventDrift(stored, [TSA_ORIGINAL], [amd], AUDIT_DAY, '2026-10-28T07:00:00Z');
    expect(after.countable).toBe(1);
  });
});

describe('retirement guard', () => {
  const src = (id: string, description = 'text') => notice({ notice_id: id, description });
  const row = (id: string, source: string | null = 'sam_gov') => ({ id: `row-${id}`, notice_id: id, event_type: 'industry_day', event_date: null, source });
  it('proposes listed rows the extractor no longer reads as events, with id and reason', () => {
    const listed = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const plan = planRetirements(listed.map((id) => row(id)), listed.map((id) => src(id)), new Set(listed.slice(2)));
    expect(plan.proposals.map((p) => [p.id, p.notice_id, p.reason])).toEqual([['row-n0', 'n0', 'no_event_on_reread'], ['row-n1', 'n1', 'no_event_on_reread']]);
    expect(plan.skipped).toBeNull();
  });
  it('a title-only reading (no description) is never proposed; AI rows are never proposed', () => {
    const plan = planRetirements([row('a'), row('b'), row('c'), row('d'), row('e', 'ai_web_search')], [src('a', ''), src('b'), src('c'), src('d'), src('e')], new Set(['b', 'c', 'd']));
    expect(plan.proposals).toEqual([]);
  });
  it('a mass "no longer an event" result proposes nothing and says why (classifier regression guard)', () => {
    const listed = Array.from({ length: 1000 }, (_, i) => `n${i}`);
    const plan = planRetirements(listed.map((id) => row(id)), listed.map((id) => src(id)), new Set());
    expect(plan.proposals).toEqual([]);
    expect(plan.wouldRetire).toBe(1000);
    expect(plan.skipped).toContain(String(RETIRE_MAX_ROWS));
  });
  it('pruning is report-only unless SAM_EVENTS_PRUNE is exactly "apply"', () => {
    expect(pruneMode({})).toBe('report');
    expect(pruneMode({ SAM_EVENTS_PRUNE: 'true' })).toBe('report');
    expect(pruneMode({ SAM_EVENTS_PRUNE: 'APPLY' })).toBe('report');
    expect(pruneMode({ SAM_EVENTS_PRUNE: 'apply' })).toBe('apply');
  });
});
