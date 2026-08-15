/**
 * Scoped events — the best-match hierarchy behind "events on the opportunity card /
 * market research / network" (Eric 2026-08-14).
 *
 * THE RULE (Eric, verbatim): "Do not stack agency-level events underneath notice-level
 * events by default, because that dilutes relevance and makes the drawer feel noisy."
 * So `queryScopedEvents` RETURNS on the first tier that hits — a result set is always
 * SINGLE-TIER — and every surface shows WHY it matched.
 *
 * MEASURED BEFORE BUILDING (rule: measure before you build a data feature):
 *   · 3,948 sam_events rows, but 3,451 are event_type='rfi' — sources-sought NOTICES
 *     that are already opportunities. Listing them as "events" restates the map.
 *   · 497 attendable (industry_day/forecast/webinar/conference), 91 upcoming.
 *   · Of those 91: 91 notice_id, 91 agency, 68 location, 45 office, **0 registration_url**
 *     — so a "Register" button would be dead on every row; we never render one.
 *   · **72 of 91 carry the department-level agency "DEPT OF DEFENSE"** — which is why
 *     agency is the LAST tier and is flagged `broad` (the same inflation the TMR events
 *     count already hit on 2026-06-29, where every DoD office inherited the whole-DoD
 *     number).
 */
import { describe, it, expect } from 'vitest';
import { eventMatchLabel, eventsSummary, type ScopedEventsResult, type ScopedEvent } from './query';

const ev = (over: Partial<ScopedEvent> = {}): ScopedEvent => ({
  title: 'Industry Day Announcement For Navy Fielded Training Systems Support VI',
  event_type: 'industry_day',
  event_date: '2026-08-18',
  location: 'Orlando, FL',
  agency: 'DEPT OF DEFENSE',
  office: 'NAWCTSD',
  notice_id: '1065d8f60a454a768b28ee873f10d2ee',
  solicitation_number: 'N6134026R0001',
  tier: 'notice',
  broad: false,
  ...over,
});

describe('event match label — the surface must say WHY it matched', () => {
  it('names each tier honestly', () => {
    expect(eventMatchLabel('notice')).toBe('Matched to this solicitation');
    expect(eventMatchLabel('office')).toBe('Matched to buying office');
    expect(eventMatchLabel('agency')).toBe('Matched to agency');
  });

  it('a department-level agency match is labelled department-wide, not "matched"', () => {
    // 72/91 upcoming events are "DEPT OF DEFENSE". Calling that a match would imply a
    // Navy shipbuilding notice is relevant to an Army IT event.
    expect(eventMatchLabel('agency', true)).toBe('Department-wide event');
  });

  it('no match → no label (nothing renders)', () => {
    expect(eventMatchLabel(null)).toBe('');
  });
});

describe('events summary — compact by default, expandable', () => {
  it('a single event shows its own title and date', () => {
    const r: ScopedEventsResult = { events: [ev()], bestTier: 'notice', degraded: false };
    const s = eventsSummary(r)!;
    expect(s.count).toBe(1);
    expect(s.headline).toContain('Navy Fielded Training');
    expect(s.sub).toContain('Aug 18, 2026');
    expect(s.sub).toContain('Matched to this solicitation');
  });

  it('several at the SAME tier collapse to "N upcoming events" + the soonest date', () => {
    // Eric: "If multiple events exist at the same highest relevance level, show a compact
    // '2 Upcoming Events' summary with an option to view all."
    const r: ScopedEventsResult = {
      events: [ev(), ev({ title: 'Second', event_date: '2026-09-02' })],
      bestTier: 'notice',
      degraded: false,
    };
    const s = eventsSummary(r)!;
    expect(s.count).toBe(2);
    expect(s.headline).toBe('2 upcoming events');
    expect(s.sub).toContain('Next Aug 18, 2026');   // soonest, not the last
  });

  it('an empty result renders NOTHING — never a dead empty-state', () => {
    expect(eventsSummary({ events: [], bestTier: null, degraded: false })).toBeNull();
  });

  it('dates are formatted in UTC — an ISO date must not slip a day in a west timezone', () => {
    const r: ScopedEventsResult = { events: [ev({ event_date: '2026-01-01' })], bestTier: 'office', degraded: false };
    expect(eventsSummary(r)!.sub).toContain('Jan 1, 2026');
  });

  it('an undated event says "Date TBD" rather than inventing a day', () => {
    const r: ScopedEventsResult = { events: [ev({ event_date: null })], bestTier: 'agency', degraded: false };
    expect(eventsSummary(r)!.sub).toContain('Date TBD');
  });
});

describe('the source contract: best-match, RFI-free, honest-empty', () => {
  const src = readSrc();
  function readSrc() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs');
    return readFileSync(require('node:path').join(__dirname, 'query.ts'), 'utf8');
  }

  it('RFIs can never surface as events (they are opportunities)', () => {
    expect(src).toMatch(/ATTENDABLE_TYPES\s*=\s*\['industry_day',\s*'forecast',\s*'webinar',\s*'conference'\]/);
    expect(src).toMatch(/\.in\('event_type',\s*ATTENDABLE_TYPES\)/);
  });

  it('each tier RETURNS on hit — tiers are never concatenated', () => {
    const fn = src.slice(src.indexOf('export async function queryScopedEvents'));
    // Three early returns (notice/office/agency) + the honest-empty return.
    expect((fn.match(/return \{ events: data\.map/g) || []).length).toBe(3);
    expect(fn).toMatch(/return \{ events: \[\], bestTier: null, degraded \}/);
    // The tell for cumulative matching would be pushing into a shared array across tiers.
    expect(fn).not.toMatch(/events\.push\(/);
  });

  it('only UPCOMING events, and the agency tier is last', () => {
    const fn = src.slice(src.indexOf('export async function queryScopedEvents'));
    expect(fn).toMatch(/\.gte\('event_date', todayStr\)/);
    expect(fn.indexOf("eq('notice_id'")).toBeLessThan(fn.indexOf("eq('inferred_dodaac'"));
    expect(fn.indexOf("eq('inferred_dodaac'")).toBeLessThan(fn.indexOf("ilike('agency'"));
  });

  it('a failed read is degraded, not a fake empty list', () => {
    const fn = src.slice(src.indexOf('export async function queryScopedEvents'));
    expect(fn).toMatch(/if \(error\) degraded = true;/);
  });
});
