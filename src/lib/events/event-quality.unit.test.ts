/**
 * Event data quality rules. Every rejected value below is a real sam_events string measured
 * 2026-11-07; every accepted one is a real place from the same table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { imatchClause } from '@/lib/discovery/matcher';
import { join } from 'node:path';
import {
  classifyEventText,
  cleanEventLocation,
  eventAgencyOrClause,
  extractEventLocation,
  resolveEventAgencyScope,
} from './event-quality';

describe('cleanEventLocation: only a recognisable place is shown', () => {
  it.each([
    'ION     VIRTUAL INDUSTRY DAY NOTICE',
    'erial & Waste Disposal This is a SOURCES SOUGHT ANNOUNCEMENT ONLY',
    'ION (RFI) / SOURCES SOUGHT NOTICE IS ISSUED SOLELY FOR INFORMATION AND PLANNING PURPOSES',
    'ion', 'ion (RFI)', 'ion, an', 'ION AVAILABLE AT THIS TIME', 'TACHED DOCUMENT FOR MORE INFORMATION',
    'ARE ABLE TO MANUFACTURE THE ITEM', 'OR FACILITY AT KEESLER AIR FORCE BASE, BI', 'Surf City, No', 'OR, EN',
    // cut-off state names: Malmstrom AFB is in Montana; the Ga is the start of Gainesville
    'MALMSTROM AIR FORCE BASE, MO', 'Malcom Randall VA Medical Center, Ga', 'Orlando, FL',
    'ion Number: N6134027R1002', 'e', '', null, undefined,
  ])('withholds %j', (v) => {
    expect(cleanEventLocation(v)).toBeNull();
  });

  it.each(['Huntington, WV 25701', 'KENNEDY SPACE CENTER, FL 32899', 'Orlando, FL 32801-1234'])('keeps %j', (v) => {
    expect(cleanEventLocation(v)).toBe(v);
  });
});

describe('extractEventLocation: no bare "at" capture', () => {
  it('does not capture the tail of "solicitation" or "material"', () => {
    expect(extractEventLocation('VA AIR AMBULANCE BROKER PRESOLICITATION VIRTUAL INDUSTRY DAY NOTICE')).toBeNull();
    expect(extractEventLocation('Hazardous Material & Waste Disposal This is a SOURCES SOUGHT ANNOUNCEMENT ONLY')).toBeNull();
  });
  it('reads a labelled location or an address', () => {
    expect(extractEventLocation('Industry Day. Location: Orlando, FL 32801. Registration required.')).toBe('Orlando, FL 32801');
    expect(extractEventLocation('Location: Malmstrom AFB, Montana')).toBeNull();
    expect(extractEventLocation('The session will be held at 100 Main St, Huntington, WV 25701 on May 4.')).toBe('Huntington, WV 25701');
  });
});

describe('classifyEventText', () => {
  it('an RFI title stays an RFI even when the body mentions an industry day', () => {
    expect(classifyEventText('REQUEST FOR INFORMATION (RFI) FOR GROUP 1 AND GROUP 2 UAS TRAINING', 'An industry day may follow.')).toBe('rfi');
    expect(classifyEventText('NATO Request for Information: Space Domain Operational Functions', 'industry engagement')).toBe('rfi');
  });
  it('a title that names an industry day is one, even beside RFI wording', () => {
    expect(classifyEventText('V225--VA AIR AMBULANCE BROKER VIRTUAL INDUSTRY DAY NOTICE', null)).toBe('industry_day');
    expect(classifyEventText('RFI and Industry Day: Base Operations Support', null)).toBe('industry_day');
  });
  it('keywords match whole words: "airfield" is not an RFI', () => {
    expect(classifyEventText('Repair Airfield Electrical Systems', 'Repair the airfield lighting.')).toBeNull();
    expect(classifyEventText('FSC4730_BPA_RFI', null)).toBe('rfi');
  });
  it('plurals still match (industry days, webinars, forecasts)', () => {
    expect(classifyEventText('NAVSEA Industry Days 2027', null)).toBe('industry_day');
    expect(classifyEventText('Small Business Webinars', null)).toBe('webinar');
    expect(classifyEventText('FY27 Procurement Forecasts', null)).toBe('forecast');
  });
  it('body text still classifies when the title is silent', () => {
    expect(classifyEventText('Cloud Support Services', 'The Government will hold an industry day on May 4.')).toBe('industry_day');
  });
});

describe('agency scope', () => {
  it('resolves "VA" to the Veterans Affairs department, never a substring of NAVAL / SAVANNAH', () => {
    const s = resolveEventAgencyScope('VA');
    expect(s).toEqual({ key: 'VETERANS AFFAIRS', departmentOnly: true });
    expect(eventAgencyOrClause(s)).toBe(imatchClause('agency', '\\mVETERANS AFFAIRS\\M'));
  });
  it('a department request matches the department column only (no DLA ENERGY)', () => {
    const s = resolveEventAgencyScope('Department of Energy');
    expect(s).toEqual({ key: 'ENERGY', departmentOnly: true });
    expect(eventAgencyOrClause(s)).not.toMatch(/inferred_office/);
  });
  it('Department of Defense still matches the stored "DEPT OF DEFENSE"', () => {
    expect(resolveEventAgencyScope('Department of Defense')).toEqual({ key: 'DEFENSE', departmentOnly: true });
  });
  it('a sub-agency matches all three columns on word boundaries', () => {
    const s = resolveEventAgencyScope('Navy');
    expect(s.departmentOnly).toBe(false);
    const clause = eventAgencyOrClause(s);
    expect(clause).toMatch(/inferred_office\.imatch/);
    expect(clause).toContain(imatchClause('inferred_office', '\\mNAVY\\M'));
  });
  it('empty input gives no scope', () => {
    expect(eventAgencyOrClause(resolveEventAgencyScope(''))).toBe('');
  });
});

describe('wiring', () => {
  const query = readFileSync(join(__dirname, 'query.ts'), 'utf8');
  const cron = readFileSync(join(__dirname, '../../app/api/cron/extract-sam-events/route.ts'), 'utf8');
  it('the events query uses the shared scope and location guard', () => {
    expect(query).toMatch(/\.or\(agencyClause\)/);
    expect(query).toMatch(/location: cleanEventLocation\(row\.event_location\)/);
    expect(query).not.toMatch(/inferred_office\.ilike\.%\$\{term\}%/);
  });
  it('the extractor uses the shared classifier and location rules', () => {
    expect(cron).toMatch(/classifyEventText\(notice\.title, notice\.description\)/);
    expect(cron).toMatch(/extractEventLocation\(fullText\)/);
    expect(cron).not.toMatch(/function classifyEvent\(/);
  });
});
