import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptCurrentVersionDates, extractEvent, type RefreshNotice } from './refresh';

const NOV_9 = new Date('2026-11-09T12:00:00Z');

// TSA25-04-0644 — real text (original 2026-10-16, Amendment 1 posted as a NEW notice 2026-10-27).
const TSA_ORIGINAL: RefreshNotice = {
  notice_id: 'f98693bb', solicitation_number: 'TSA25-04-0644', notice_type: 'Special Notice', posted_date: '2026-10-16', response_deadline: '2026-11-13T20:00:00Z',
  title: 'Domestic Aviation Design Industry Day',
  description: 'Domestic Aviation Design Industry Day \n\n Important Dates: \n\n Industry Day Registration Deadline -- 3:00 PM EDT on Friday, November 13, 2026\n\n Industry Day -- 9:00 AM EDT on Tuesday, November 17, 2026\n\n 3. Event Description: \n\n Date : Tuesday, November 17, 2026 9:00 AM EDT\n\n Location : Virtual (Microsoft Teams)',
};
const TSA_AMENDMENT: RefreshNotice = {
  notice_id: 'db864acb', solicitation_number: 'TSA25-04-0644', notice_type: 'Special Notice', posted_date: '2026-10-27', response_deadline: '2026-11-13T20:00:00Z',
  title: 'Domestic Aviation Design Industry Day',
  description: 'Amendment 1 to Special Notice \n\n This amendment updates the date for the Domestic Aviation Design Industry Day.\n\n The Domestic Aviation Design Industry Day will be held at 9:00 a.m. EDT on Wednesday, November 18, 2026 .\n\n Industry Day -- 9:00 AM EDT on Tuesday, November 17, 2026 (Amendment 1 updated this date to November 18, 2026)',
};

const run = (events: RefreshNotice[], family: RefreshNotice[] = events) => {
  const extracted = events.map((n) => extractEvent(n, NOV_9)).filter((e): e is NonNullable<typeof e> => !!e);
  return adoptCurrentVersionDates(extracted, new Map(events.map((n) => [n.notice_id, n])), family, NOV_9);
};

describe('R3: amendments posted as new notices', () => {
  it('each TSA notice on its own: the original still says Nov 17 (the stale row)', () => {
    expect(extractEvent(TSA_ORIGINAL, NOV_9)?.event_date).toBe('2026-11-17');
    expect(extractEvent(TSA_AMENDMENT, NOV_9)?.event_date).toBe('2026-11-18');
  });

  it('TSA family: one pass gives BOTH rows Nov 18, and records the adoption', () => {
    const r = run([TSA_ORIGINAL, TSA_AMENDMENT]);
    expect(Object.fromEntries(r.events.map((e) => [e.notice_id, e.event_date]))).toEqual({ f98693bb: '2026-11-18', db864acb: '2026-11-18' });
    expect(r.adopted).toEqual([{ notice_id: 'f98693bb', from: '2026-11-17', to: '2026-11-18', current_notice_id: 'db864acb' }]);
    expect(r.events.find((e) => e.notice_id === 'f98693bb')?.adopted_from).toBe('db864acb');
  });

  it('the older notice adopts even when only the original is being written (amendment read as family)', () => {
    const r = run([TSA_ORIGINAL], [TSA_ORIGINAL, TSA_AMENDMENT]);
    expect(r.events[0].event_date).toBe('2026-11-18');
  });

  it('a newer version that does not repeat the event is NOT a cancellation', () => {
    const rfp: RefreshNotice = { ...TSA_AMENDMENT, notice_id: 'rfp00001', posted_date: '2026-11-05', notice_type: 'Solicitation', title: 'Domestic Aviation Design', description: 'Request for Proposal. Proposals due December 20, 2026.' };
    const r = run([TSA_ORIGINAL], [TSA_ORIGINAL, rfp]);
    expect(r.events[0].event_date).toBe('2026-11-17');
    expect(r.adopted).toEqual([]);
  });

  it('a newer version with a DIFFERENT event type does not overwrite the date', () => {
    const webinar: RefreshNotice = { ...TSA_AMENDMENT, notice_id: 'web00001', posted_date: '2026-11-05', title: 'Domestic Aviation Design Webinar', description: 'A webinar will be held on December 3, 2026.' };
    expect(run([TSA_ORIGINAL], [TSA_ORIGINAL, webinar]).events[0].event_date).toBe('2026-11-17');
  });

  it('notices without a confirmed solicitation number are never linked (GOCO bound)', () => {
    const a = { ...TSA_ORIGINAL, solicitation_number: null };
    const b = { ...TSA_AMENDMENT, solicitation_number: null };
    const r = run([a, b]);
    expect(r.events.find((e) => e.notice_id === 'f98693bb')?.event_date).toBe('2026-11-17');
    expect(r.adopted).toEqual([]);
  });

  it('the current version itself is never rewritten', () => {
    const r = run([TSA_AMENDMENT], [TSA_ORIGINAL, TSA_AMENDMENT]);
    expect(r.events[0]).toMatchObject({ notice_id: 'db864acb', event_date: '2026-11-18', adopted_from: null });
  });
});

describe('the extractor route reads everything it needs (R2) and stamps re-reads (R4)', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/app/api/cron/extract-sam-events/route.ts'), 'utf8');

  it('no longer stops at the 500 newest notices', () => {
    expect(SRC).not.toMatch(/\.order\('posted_date', \{ ascending: false \}\)\s*\.limit\(500\)/);
    expect(SRC).toMatch(/for \(let from = 0; from < MAX_CANDIDATES; from \+= PAGE\)/);
  });

  it('re-reads every notice behind an upcoming event row, even outside the candidate set', () => {
    expect(SRC).toMatch(/\.from\('sam_events'\)\s*\.select\('notice_id, event_type'\)/);
    expect(SRC).toMatch(/event_date\.gte\.\$\{todayStr\},event_date\.is\.null/);
    expect(SRC).toMatch(/const missing = upcomingIds\.filter/);
  });

  it('applies the family current-version rule before writing', () => {
    expect(SRC).toMatch(/adoptCurrentVersionDates\(extracted, byId, familyNotices, today\)/);
  });

  it('writes extracted_at on every upsert, in bounded statements', () => {
    expect(SRC).toMatch(/extracted_at: runAt/);
    expect(SRC).toMatch(/upsertInChunks\(events,/);
  });
});
