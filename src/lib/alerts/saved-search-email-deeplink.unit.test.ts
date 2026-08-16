import { describe, it, expect } from 'vitest';
import { buildEmail } from './saved-search-email';

/**
 * The saved-search alert email must land the reader on THAT saved search, not the national map.
 *
 * The defect this pins: the email says "12 new matches for 'Construction — Open'" and every
 * map CTA in it pointed at a bare /opportunity-map — 136,879 unfiltered results. Measured
 * 2026-08-15. It is the same class already fixed on the watchlist side via ?ss= (see
 * opportunity-map/saved-search-deeplink.unit.test.ts): the map's ?ss= handler
 * (route.ts ~7165) loads the search by id and runs it through __applySavedSearch — the SAME
 * restorer the in-map picker uses. The email was the last surface still dropping the id.
 *
 * Root cause worth remembering: SavedSearchLite was typed `{ name: string }`, so the id was
 * discarded at the TYPE BOUNDARY even though the cron selects it and passes the whole row.
 * A type too narrow to express the fix hides the bug.
 */

const SEARCH = { id: '58cedd75-3da7-419e-aa6d-df4a18d29bd2', name: '236,237,238 — Open' };
const OPPS = [
  { notice_id: 'abc123', title: 'Roof replacement', department: 'VETERANS AFFAIRS, DEPARTMENT OF', naics_code: '236220', response_deadline: '2026-09-01' },
  { notice_id: 'def456', title: 'Site grading', department: 'DEPT OF DEFENSE', naics_code: '237310', response_deadline: '2026-09-05' },
];

describe('saved-search alert email deep-links back to the search', () => {
  it('sends every map CTA to ?ss=<id>, never a bare /opportunity-map', () => {
    const { html } = buildEmail(SEARCH, OPPS);
    // The primary "Open the map" button.
    expect(html).toContain(`/opportunity-map?ss=${SEARCH.id}`);
    // No CTA may point at the unfiltered map. Match the href boundary so ?ss= links don't
    // count as a bare hit (a plain `includes('/opportunity-map')` would pass either way).
    expect(html).not.toMatch(/href="[^"]*\/opportunity-map"/);
  });

  it('tags the source so the funnel can attribute the click', () => {
    const { html } = buildEmail(SEARCH, OPPS);
    expect(html).toContain('src=saved_search_alert');
  });

  it('deep-links the plain-text CTA too (text/plain readers are not second-class)', () => {
    const { text } = buildEmail(SEARCH, OPPS);
    expect(text).toContain(`/opportunity-map?ss=${SEARCH.id}`);
    expect(text).not.toMatch(/\/opportunity-map\s*$/);
  });

  it('carries the search id through the "+ N more" overflow link', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...OPPS[0], notice_id: `n${i}` }));
    const { html } = buildEmail(SEARCH, many);
    expect(html).toContain('view all on the map');
    // The overflow link is the one a user with many matches actually clicks.
    const overflow = html.match(/\+ 5 more[\s\S]{0,220}?href="([^"]+)"/);
    expect(overflow?.[1]).toContain(`ss=${SEARCH.id}`);
  });

  it('per-card links keep the opportunity AND the search context (?opp= and ?ss= compose)', () => {
    const { html } = buildEmail(SEARCH, OPPS);
    // The map applies opp= and ss= in independent IIFEs, so both can ride the same URL:
    // the drawer opens on the notice while the map behind it stays narrowed to the search.
    // Card hrefs are esc()'d at render, so they must carry a RAW '&' — passing '&amp;' here
    // would ship '&amp;amp;' and break the link. This assertion is what caught that.
    expect(html).toContain(`/opportunity-map?opp=abc123&amp;ss=${SEARCH.id}`);
    expect(html).not.toContain('&amp;amp;');
  });

  it('degrades honestly when no id is available rather than emitting ?ss=undefined', () => {
    // Older callers / previews may pass a name-only object. A broken param is worse than none.
    const { html, text } = buildEmail({ name: 'legacy' } as { id?: string; name: string }, OPPS);
    expect(html).not.toContain('ss=undefined');
    expect(text).not.toContain('ss=undefined');
  });
});
