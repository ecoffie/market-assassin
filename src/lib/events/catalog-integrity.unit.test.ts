import { describe, it, expect } from 'vitest';
import catalog from '@/data/federal-events-sources.json';
import { getFederalEventSeries } from '@/mcp/tools/event-series';

/**
 * The curated catalog is hand-edited. These checks keep an edit from silently making an entry look
 * current: every entry carries its own verification, every date carries where and when it was read,
 * and the catalog may never be "all verified" just because the file changed.
 */
type Occ = { start: string; end: string; verified_at: string; source_url: string; registration_url: string | null };
type Ver = { status: string; checked_at: string; source_url: string; note?: string };
type Entry = { name: string; url?: string; one_off?: boolean; next_occurrence?: Occ; verification?: Ver };

const STATUSES = ['verified_upcoming', 'link_ok', 'no_next_announced', 'unverifiable', 'paused', 'not_found', 'unverified'];
const data = catalog as unknown as { eventSources: Record<string, Entry>; majorAnnualConferences: Entry[] };
const all: Entry[] = [...Object.values(data.eventSources), ...data.majorAnnualConferences];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('federal events catalog integrity', () => {
  it('every entry has a verification with a known status, a date and an https source', () => {
    for (const e of all) {
      expect(e.verification, e.name).toBeDefined();
      expect(STATUSES, e.name).toContain(e.verification!.status);
      expect(e.verification!.checked_at, e.name).toMatch(DATE);
      expect(e.verification!.source_url, e.name).toMatch(/^https:\/\//);
    }
  });

  it('every dated occurrence records where and when it was read, and is well-formed', () => {
    for (const e of all.filter((x) => x.next_occurrence)) {
      const o = e.next_occurrence!;
      expect(o.start, e.name).toMatch(DATE);
      expect(o.end, e.name).toMatch(DATE);
      expect(o.end >= o.start, e.name).toBe(true);
      expect(o.verified_at, e.name).toMatch(DATE);
      expect(o.source_url, e.name).toMatch(/^https:\/\//);
      if (o.registration_url !== null) expect(o.registration_url, e.name).toMatch(/^https:\/\//);
    }
  });

  it('a dated one-off event always has its date', () => {
    for (const e of all.filter((x) => x.one_off)) expect(e.next_occurrence, e.name).toBeDefined();
  });

  it('only verified_upcoming entries may carry a date', () => {
    for (const e of all.filter((x) => x.next_occurrence)) expect(e.verification!.status, e.name).toBe('verified_upcoming');
  });

  it('is never all-verified: unreachable and undated entries keep their own status', () => {
    const counts = getFederalEventSeries({})._meta.catalog_verification;
    expect(counts.verified_upcoming).toBeLessThan(all.length);
    expect(counts.never_checked).toBeUndefined();
  });

  it('URLs found dead or moved on 2026-11-09 are gone', () => {
    const urls = all.map((e) => e.url);
    for (const dead of [
      'https://www.apexaccelerators.us/events',
      'https://www.afcea.org/site/Events',
      'https://events.afcea.org/TechNetCyber',
      'https://events.afcea.org/AFCEAWest',
      'https://www.pscouncil.org/vision',
      'https://www.dhs.gov/small-business',
      'https://www.afwerx.com/events',
      'https://www.secnav.navy.mil/smallbusiness/',
      'https://www.gsa.gov/about-us/organization/office-of-small-disadvantaged-business-utilization',
      'https://business.defense.gov/Events/',
    ]) expect(urls, dead).not.toContain(dead);
  });

  it('NVSBE is preserved exactly', () => {
    const nvsbe = data.majorAnnualConferences.find((c) => c.name.startsWith('National Veterans Small Business Engagement'))!;
    expect(nvsbe.next_occurrence).toEqual({
      start: '2026-12-08',
      end: '2026-12-09',
      location: 'Huntington Convention Center, Cleveland, OH',
      registration_url: 'https://portal.vetbiz.va.gov/nvsbe/2026/reg-fees/',
      verified_at: '2026-11-07',
      source_url: 'https://www.va.gov/osdbu/nvsbe/',
    });
  });

  it('PSC Vision and ACT-IAC ELC carry the organizer dates', () => {
    const by = (n: string) => data.majorAnnualConferences.find((c) => c.name === n)!.next_occurrence!;
    expect(by('PSC Vision Federal Market Forecast')).toMatchObject({ start: '2026-12-08', end: '2026-12-09' });
    expect(by('ACT-IAC Imagine Nation ELC')).toMatchObject({ start: '2026-12-10', end: '2026-12-11' });
  });

  it('one-off events are not labelled annual', () => {
    const dot = getFederalEventSeries({ query: 'DOT Veteran-Owned Small Business Summit' }).series[0];
    expect(dot.cadence).toMatch(/^dated event/);
  });
});
