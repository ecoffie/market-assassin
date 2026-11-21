import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEvent, extractEventDate } from './classify';
import { capNewEvents, expireIds, NEW_CALENDAR_EVENTS_PER_RUN, NEW_SAM_EVENTS_PER_RUN } from './capture-plan';
import { extractCapturedLinks, linkColumns, samNoticeSourceUrl } from './event-links';
import { collectSbaEvents, parseSbaDetail, parseSbaListing, sbaEventFromParts, sbaNoticeId } from './sba-calendar';

const TODAY = new Date('2026-11-18T12:00:00Z');
const listing = readFileSync(join(__dirname, '__fixtures__/sba-listing.html'), 'utf8');
const detailHtml = readFileSync(join(__dirname, '__fixtures__/sba-detail.html'), 'utf8');

describe('SAM notice phrases the extractor was missing', () => {
  it('a sources-sought briefing with its own date is an industry day, not the response deadline', () => {
    const title = 'Sources Sought for Cloud Hosting';
    const description = 'The agency will hold a sources sought briefing on December 3, 2026 for interested small businesses. Responses are due January 4, 2027.';
    const c = classifyEvent(title, description, TODAY);
    expect(c).toEqual({ type: 'industry_day', evidence: 'description_dated' });
    expect(extractEventDate(title, description, c!, null, TODAY)).toBe('2026-12-03');
  });

  it('a pre-solicitation conference dated in the body is attendable', () => {
    const title = 'Notice of upcoming acquisition';
    const description = 'A pre-solicitation conference will be held on January 12, 2027 at the contracting office.';
    const c = classifyEvent(title, description, TODAY);
    expect(c).toEqual({ type: 'industry_day', evidence: 'description_dated' });
    expect(extractEventDate(title, description, c!, null, TODAY)).toBe('2027-01-12');
  });

  it('a slide attachment that merely says briefing is not an event', () => {
    const title = 'Draft solicitation';
    const description = 'The briefing is attached. Responses are due December 3, 2026.';
    expect(classifyEvent(title, description, TODAY)?.type).not.toBe('industry_day');
  });

  it('matchmaking named in the title is an industry day', () => {
    expect(classifyEvent('Small Business Matchmaking', null, TODAY)).toEqual({ type: 'industry_day', evidence: 'title' });
  });
});

describe('event links', () => {
  const text = 'Register at https://events.example.gov/rsvp/123 . Join on Microsoft Teams at https://teams.microsoft.com/l/meetup-join/abc . The session is virtual.';

  it('keeps the register link, the meeting link, and the official notice link apart', () => {
    const links = extractCapturedLinks(text, 'https://sam.gov/opp/abc/view');
    expect(links.registrationUrl).toBe('https://events.example.gov/rsvp/123');
    expect(links.virtualUrl).toBe('https://teams.microsoft.com/l/meetup-join/abc');
    expect(links.location).toBe('Virtual');
    const cols = linkColumns(links);
    expect(cols.registration_url).toBe('https://events.example.gov/rsvp/123');
    expect(cols.contact_info).toContain('source_url=https://sam.gov/opp/abc/view');
    expect(cols.contact_info).toContain('virtual_url=https://teams.microsoft.com/l/meetup-join/abc');
  });

  it('a 32-hex notice with no ui_link still has an official SAM url', () => {
    const id = 'da74fba251794157a586b821fd45573e';
    expect(samNoticeSourceUrl(id, null)).toBe(`https://sam.gov/opp/${id}/view`);
    expect(samNoticeSourceUrl('sba:86550', null)).toBeNull();
  });
});

describe('insert cap', () => {
  it('updates every stored notice and inserts only up to the cap', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((notice_id) => ({ notice_id }));
    const { writes, deferred, fresh } = capNewEvents(events, new Set(['a', 'b']), 2);
    expect(writes.map((e) => e.notice_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(fresh).toBe(2);
    expect(deferred).toBe(1);
    expect(NEW_SAM_EVENTS_PER_RUN).toBeGreaterThan(0);
    expect(NEW_CALENDAR_EVENTS_PER_RUN).toBeGreaterThan(0);
  });

  it('an unknown existing-id set is not treated as empty, so updates are not dropped', () => {
    const events = [{ notice_id: 'a' }, { notice_id: 'b' }];
    expect(capNewEvents(events, null, 1).writes).toEqual(events);
  });

  it('past dates are selected for an expired_at mark and nothing is deleted', () => {
    const ids = expireIds([
      { id: 'past', event_date: '2026-11-01' },
      { id: 'today', event_date: '2026-11-18' },
      { id: 'future', event_date: '2026-12-01' },
      { id: 'undated', event_date: null },
    ], '2026-11-18');
    expect(ids).toEqual(['past']);
  });
});

describe('SBA calendar parser', () => {
  it('keeps matchmaking and contracting outreach and drops a generic class', () => {
    const teasers = parseSbaListing(listing);
    expect(teasers.map((t) => t.id)).toEqual(['86550', '34004', '91010']);
    const detail = parseSbaDetail(detailHtml);
    expect(detail).toMatchObject({
      date: '2026-12-15',
      location: '11800 Magnolia Parkway, Manvel, TX, 77578',
      host: 'San Jacinto College SBDC',
      registrationUrl: 'https://sbdc.example.gov/workshop.aspx?ekey=75460051',
      canonicalUrl: 'https://www.sba.gov/event/86550',
    });
    const row = sbaEventFromParts(teasers[0], detail, '2026-11-18T12:00:00.000Z');
    expect(row).toMatchObject({
      notice_id: 'sba:86550',
      event_type: 'industry_day',
      event_date: '2026-12-15',
      event_location: '11800 Magnolia Parkway, Manvel, TX, 77578',
      registration_url: 'https://sbdc.example.gov/workshop.aspx?ekey=75460051',
      inferred_office: 'San Jacinto College SBDC',
      agency: 'Small Business Administration',
      source: 'official_calendar',
      solicitation_number: null,
    });
    expect(row?.contact_info).toContain('source_url=https://www.sba.gov/event/86550');
    expect(sbaNoticeId('86550')).toBe('sba:86550');
  });

  it('an outlook safelink is not stored as the registration link', () => {
    const html = detailHtml.replace(
      'https://sbdc.example.gov/workshop.aspx?ekey=75460051',
      'https://gcc02.safelinks.protection.outlook.com/?url=https%3A%2F%2Furldefense.com%2Fbroken',
    );
    expect(parseSbaDetail(html).registrationUrl).toBeNull();
  });

  it('collects one new event from a fake fetch and does not call SAM', async () => {
    const calls: string[] = [];
    const empty = '<div class="sba-events-header"><p>of 0 events</p></div>';
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('/event/86550')) return new Response(detailHtml, { status: 200 });
      if (String(url).includes('keyword=matchmaking') && String(url).includes('page=0')) return new Response(listing, { status: 200 });
      return new Response(empty, { status: 200 });
    }) as typeof fetch;
    const result = await collectSbaEvents({
      fetchImpl, today: TODAY, runAt: '2026-11-18T12:00:00.000Z', cap: 5, budgetMs: 5_000,
      existingIds: new Set(['sba:91010']),
    });
    expect(result.status).toBe('ok');
    expect(result.relevant).toBeGreaterThan(0);
    expect(result.error).toBeNull();
    expect(result.events.map((e) => e.notice_id)).toEqual(['sba:86550']);
    expect(calls.some((u) => u.includes('api.sam.gov'))).toBe(false);
    expect(result.events[0].registration_url).toMatch(/^https:\/\//);
    expect(result.events[0].event_date).toBe('2026-12-15');
    expect(result.events[0].inferred_office).toBeTruthy();
  });

  it('a failed listing is unavailable, not zero events', async () => {
    const fetchImpl = (async () => new Response('upstream', { status: 503 })) as typeof fetch;
    const result = await collectSbaEvents({ fetchImpl, today: TODAY, runAt: '2026-11-18T12:00:00.000Z', budgetMs: 5_000 });
    expect(result.status).toBe('unavailable');
    expect(result.relevant).toBeNull();
    expect(result.deferred).toBeNull();
    expect(result.events).toEqual([]);
  });

  it('a 200 that is not the events page is unavailable, not an empty calendar', async () => {
    const fetchImpl = (async () => new Response('<html><body>Just a moment</body></html>', { status: 200 })) as typeof fetch;
    const result = await collectSbaEvents({ fetchImpl, today: TODAY, runAt: '2026-11-18T12:00:00.000Z', budgetMs: 5_000 });
    expect(result.status).toBe('unavailable');
    expect(result.relevant).toBeNull();
  });
});
