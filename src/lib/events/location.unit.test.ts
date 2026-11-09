import { describe, it, expect } from 'vitest';
import { cleanEventLocation, extractLocation } from './location';

describe('cleanEventLocation — drops corrupted values', () => {
  // Every value below was returned verbatim by search_federal_events for the VA on 2026-11-09.
  it.each([
    'ION     VIRTUAL INDUSTRY DAY NOTICE',
    'ion announcement',
    'ion announcement nor a request for proposals or quotes and does not obligate the Government to award a contract',
    'tached',
    'tachment',
    'ed at 5075 Westheimer Road, Ga',
    'ed at 10000 Bay Pines Blvd, Ba',
    'ement of Work (SOW) below',
    'ion only',
    'ion (VHA), Ne',
    'e and Replace Remaining ATS\'s',
    'ion Number: N6134027R1002',
  ])('%s → null', (v) => {
    expect(cleanEventLocation(v)).toBeNull();
  });

  it.each([
    'ION VIRTUAL',
    'ED AT 5075 WESTHEIMER ROAD',
    'TACHED',
    'EMENT OF WORK',
    'IONAL CEMETERY',
  ])('uppercase fragment %s → null', (v) => {
    expect(cleanEventLocation(v)).toBeNull();
  });

  it('empty / missing / over-long → null', () => {
    expect(cleanEventLocation(null)).toBeNull();
    expect(cleanEventLocation(undefined)).toBeNull();
    expect(cleanEventLocation('   ')).toBeNull();
    expect(cleanEventLocation('A'.repeat(61))).toBeNull();
  });
});

describe('cleanEventLocation — keeps real locations', () => {
  it.each([
    'Huntington Convention Center, Cleveland, OH',
    'Cleveland, OH',
    'Orlando, FL',
    'Arlington, VA',
    'Portland, OR',
    'Edwards AFB, CA',
    'Iona College, New Rochelle, NY',
    'Fort Bragg, NC 28310',
  ])('physical: %s', (v) => {
    expect(cleanEventLocation(v)).toBe(v);
  });

  it.each(['Virtual', 'VIRTUAL', 'Virtual (Microsoft Teams)', 'Online', 'Webinar'])('virtual: %s', (v) => {
    expect(cleanEventLocation(v)).toBe(v);
  });
});

describe('extractLocation — "at" must be a whole word', () => {
  it('does not split inside words', () => {
    expect(extractLocation('This is not a solicitation announcement.')).toBeNull();
    expect(extractLocation('See the Attached statement of work.')).toBeNull();
    expect(extractLocation('VA AIR AMBULANCE BROKER VIRTUAL INDUSTRY DAY NOTICE')).toBeNull();
  });

  it('still extracts a standalone "at" place', () => {
    expect(extractLocation('The industry day will be held at Huntington Convention Center, Cleveland, OH.')).toBe(
      'Huntington Convention Center',
    );
    expect(extractLocation('Held at 5075 Westheimer Road, Galveston TX')).toBe('5075 Westheimer Road');
    expect(extractLocation('Meet at Orlando, FL for the event')).toBe('Orlando, FL');
  });

  it('still extracts location: / venue: labels', () => {
    expect(extractLocation('Location: Virtual\nTime: 10:00')).toBe('Virtual');
    expect(extractLocation('Venue: Orlando, FL')).toBe('Orlando, FL');
  });
});
