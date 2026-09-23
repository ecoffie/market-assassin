/**
 * Opportunity share metadata — the object, not "Mindy Map", is the hero, and nothing is invented.
 *
 * Fixtures are the real sam_opportunities rows (read 2026-09-23), trimmed to the selected columns.
 * The production-before state these guard against: /opportunity-map?opp=<id> served no og:/twitter:
 * tags at all and `<title>Mindy Map</title>`, so Facebook showed "GETMINDY.AI / Mindy Map" + the
 * purple logo for every shared opportunity.
 */
import { describe, it, expect } from 'vitest';
import {
  buildOppShareMeta, formatAgencyName, formatPlaceOfPerformance, deadlineParts, isNoticeId, renderOppShareHead,
  type OppShareRow,
} from './share-metadata';

const NOW = Date.parse('2026-09-23T12:00:00Z');

// Product/equipment — the mower Eric shared. PoP WV, deadline issued as 09:00 EDT.
const MOWER: OppShareRow = {
  notice_id: '0fdb5f972b2a46648adf2e2b8a6558ce', title: 'CES Hillside Mower',
  department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', office: null,
  notice_type: 'Combined Synopsis/Solicitation', solicitation_number: 'W50S9J-26-Q-0013',
  response_deadline: '2026-09-29T13:00:00+00:00', responseDeadLine: '2026-09-29T09:00:00-04:00',
  active: true, pop_city: null, pop_state: 'WV', pop_country: null,
};
// Overseas product with a +02:00 deadline: the UTC column and SAM's issued date agree here, but the rule is tested below.
const SLOPE: OppShareRow = {
  notice_id: 'ba730adc21234f578e6d62e3cc3374eb', title: 'High Reach Slope Mower',
  department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE AIR FORCE', notice_type: 'Combined Synopsis/Solicitation',
  solicitation_number: 'FA560626QA071', response_deadline: '2026-09-28T10:00:00+00:00',
  responseDeadLine: '2026-09-28T12:00:00+02:00', active: true, pop_city: 'Spangdahlem', pop_state: 'DE-RP', pop_country: 'DEU',
};
// Service + 255-char (column-capped) title.
const LONG_SERVICE: OppShareRow = {
  notice_id: '96e7da693095480eb79946afc6803c9a',
  title: 'Design-Build (DB) and Design-Bid-Build (DBB) Firm Fixed Price (FFP), Indefinite Delivery /Indefinite Quantity (IDIQ), Multiple Award Construction Contract (MACC) for new construction, renovation, and demolition for general construction projects for the NA',
  department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE NAVY', notice_type: 'Solicitation',
  solicitation_number: null, response_deadline: '2026-10-20T18:00:00+00:00', responseDeadLine: null,
  active: true, pop_city: null, pop_state: null, pop_country: null,
};
// No deadline + award notice; the inverted department name.
const AWARD_NO_DEADLINE: OppShareRow = {
  notice_id: 'd4060e67df8945d091673bf61cc53c3f', title: '24--MI-DETROIT RIVER INTERNAT-0 TURN MOWER',
  department: 'INTERIOR, DEPARTMENT OF THE', sub_tier: 'US FISH AND WILDLIFE SERVICE', notice_type: 'Award Notice',
  solicitation_number: '140F1G26Q0083', response_deadline: null, responseDeadLine: null,
  active: true, pop_city: null, pop_state: null, pop_country: null,
};
// Archived (active=false) service, foreign PoP with a country code we don't map.
const ARCHIVED: OppShareRow = {
  notice_id: 'bc2f02ae49114facb65b7af23429fe6f', title: 'RFQ 19DR8626Q0056 AVR Maintenance Solicitation',
  department: 'STATE, DEPARTMENT OF', sub_tier: 'STATE, DEPARTMENT OF', notice_type: 'Solicitation',
  solicitation_number: '19DR8626Q0056', response_deadline: '2026-08-28T20:30:00+00:00',
  responseDeadLine: '2026-08-28T16:30:00-04:00', active: false, pop_city: 'SANTO DOMINGO', pop_state: 'DO-01', pop_country: 'XYZ',
};

describe('buildOppShareMeta — the opportunity is the hero', () => {
  it('product/equipment (the shared mower): title, buyer, PoP, deadline, solicitation — all verified', () => {
    const m = buildOppShareMeta(MOWER, NOW);
    expect(m.title).toBe('CES Hillside Mower — Government Opportunity');
    expect(m.title).not.toMatch(/Mindy Map/);
    expect(m.card.buyer).toBe('Dept. of the Army · Dept. of Defense');
    expect(m.card.location).toBe('West Virginia');
    expect(m.card.deadline).toBe('Sep 29, 2026');
    expect(m.card.deadlineLabel).toBe('Responses due');
    expect(m.card.closed).toBe(false);
    expect(m.description).toBe(
      'Dept. of the Army · Dept. of Defense · Place of performance: West Virginia · Responses due Sep 29, 2026 · Solicitation W50S9J-26-Q-0013 · Combined Synopsis/Solicitation',
    );
  });

  it('overseas place of performance names the country, never the APO buying office', () => {
    const m = buildOppShareMeta(SLOPE, NOW);
    expect(m.card.location).toBe('Spangdahlem, Germany');
    expect(m.card.buyer).toBe('Dept. of the Air Force · Dept. of Defense');
  });

  it('service opportunity with a 255-char title keeps the full title in og:title; unknown fields are OMITTED', () => {
    const m = buildOppShareMeta(LONG_SERVICE, NOW);
    expect(m.title.startsWith('Design-Build (DB)')).toBe(true);
    expect(m.card.location).toBeNull();
    expect(m.card.solicitation).toBeNull();
    expect(m.description).not.toMatch(/Place of performance|Solicitation [A-Z0-9]/);
    // deadline falls back to the UTC column (no raw string) — still a real field
    expect(m.card.deadline).toBe('Oct 20, 2026');
  });

  it('missing deadline → no deadline anywhere (never a guessed date); award notice is not presented as open', () => {
    const m = buildOppShareMeta(AWARD_NO_DEADLINE, NOW);
    expect(m.card.deadline).toBeNull();
    expect(m.card.deadlineLabel).toBeNull();
    expect(m.description).not.toMatch(/due|closed/i);
    expect(m.card.closed).toBe(true);
    expect(m.card.buyer).toBe('US Fish and Wildlife Service · Department of the Interior');
  });

  it('archived/closed: says closed + archived, keeps the real date, passes an unknown country code through verbatim', () => {
    const m = buildOppShareMeta(ARCHIVED, NOW);
    expect(m.card.closed).toBe(true);
    expect(m.card.deadlineLabel).toBe('Responses closed');
    expect(m.card.deadline).toBe('Aug 28, 2026');
    expect(m.description).toContain('Archived on SAM.gov');
    expect(m.card.location).toBe('Santo Domingo, XYZ');
    // same sub-tier and department → not repeated
    expect(m.card.buyer).toBe('Department of State');
  });
});

describe('field helpers', () => {
  it('deadline date is the date SAM issued, not the UTC-shifted date', () => {
    // 21:30 EDT on Oct 1 is Oct 2 in UTC — the card must still say Oct 1.
    const p = deadlineParts({ response_deadline: '2026-10-02T01:30:00+00:00', responseDeadLine: '2026-10-01T21:30:00-04:00' });
    expect(p?.ymd).toBe('2026-10-01');
  });
  it('unparseable deadline → null, not a fabricated date', () => {
    expect(deadlineParts({ response_deadline: 'TBD', responseDeadLine: null })).toBeNull();
  });
  it('agency casing', () => {
    expect(formatAgencyName('DEPT OF THE NAVY')).toBe('Dept. of the Navy');
    expect(formatAgencyName('AGRICULTURE, DEPARTMENT OF')).toBe('Department of Agriculture');
    expect(formatAgencyName('Veterans Affairs')).toBe('Veterans Affairs');
    expect(formatAgencyName('')).toBeNull();
  });
  it('place of performance is never inferred', () => {
    expect(formatPlaceOfPerformance({ pop_city: null, pop_state: null, pop_country: null })).toBeNull();
    expect(formatPlaceOfPerformance({ pop_city: 'Savannah', pop_state: 'GA', pop_country: 'USA' })).toBe('Savannah, GA');
  });
  it('only 32-hex notice ids get object metadata', () => {
    expect(isNoticeId(MOWER.notice_id)).toBe(true);
    expect(isNoticeId('fc-123')).toBe(false);
    expect(isNoticeId(null)).toBe(false);
    expect(isNoticeId('0fdb5f972b2a46648adf2e2b8a6558ce"><script>')).toBe(false);
  });
});

describe('renderOppShareHead — what the crawler parses', () => {
  const head = renderOppShareHead(buildOppShareMeta(MOWER, NOW), 'https://getmindy.ai');
  const tag = (attr: string, key: string) => head.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`))?.[1];

  it('emits every tag Facebook, LinkedIn and X read', () => {
    expect(head).toContain('<title>CES Hillside Mower — Government Opportunity</title>');
    expect(tag('property', 'og:title')).toBe('CES Hillside Mower — Government Opportunity');
    expect(tag('property', 'og:url')).toBe('https://getmindy.ai/opportunity-map?opp=0fdb5f972b2a46648adf2e2b8a6558ce');
    expect(tag('property', 'og:image')).toBe('https://getmindy.ai/opportunity-map/og/0fdb5f972b2a46648adf2e2b8a6558ce');
    expect(tag('property', 'og:image:width')).toBe('1200');
    expect(tag('property', 'og:image:height')).toBe('630');
    expect(tag('name', 'twitter:card')).toBe('summary_large_image');
    expect(tag('name', 'twitter:image')).toBe(tag('property', 'og:image'));
    expect(tag('property', 'og:description')).toContain('Responses due Sep 29, 2026');
  });

  it('the image is NOT under /api/ (robots.txt disallows /api/ and Twitterbot obeys it)', () => {
    expect(tag('property', 'og:image')).not.toMatch(/\/api\//);
  });

  it('escapes attribute-breaking characters from SAM titles', () => {
    const h = renderOppShareHead(buildOppShareMeta({ ...MOWER, title: 'Tools "Heavy" <Duty> & Parts' }, NOW), 'https://getmindy.ai');
    expect(h).toContain('Tools &quot;Heavy&quot; &lt;Duty&gt; &amp; Parts — Government Opportunity');
    expect(h).not.toContain('<Duty>');
  });
});
