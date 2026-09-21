import { describe, it, expect } from 'vitest';
import {
  mapNasaRow, nasaStatus, nasaNaics, nasaValueMin, nasaCell, NASA_COL,
  NASA_SOURCE_OWNED_FIELDS, NASA_DERIVED_FIELDS, NASA_LEGACY_REPAIR_FIELDS,
} from './nasa-parse';

/** A row shaped like the real 46-column NASA sheet. */
const row = (over: Partial<Record<number, unknown>> = {}): unknown[] => {
  const r = new Array(46).fill(null);
  r[NASA_COL.buyingOffice] = 'KSC';
  r[NASA_COL.acquisitionStatus] = 'Revised';
  r[NASA_COL.awardedOrWithdrawn] = 'N/A';
  r[NASA_COL.sourceId] = 1139;
  r[NASA_COL.title] = 'COMET Follow-On';
  r[NASA_COL.technicalPocEmail] = 'nicholas.s.reinert@nasa.gov';
  r[NASA_COL.technicalPocName] = 'Reinert, Nick (KSC-LXB00)';
  r[NASA_COL.naics] = '541715';
  r[NASA_COL.naicsDesc] = 'Research and Development in the Physical, Engineering and Life Sciences';
  r[NASA_COL.pscCode] = 'AR15';
  r[NASA_COL.pscDesc] = 'SPACE R&D SVCS';
  r[NASA_COL.missionDirectorate] = 'Human Exploration and Operations Mission Directorate';
  r[NASA_COL.sbSpecialistName] = 'Sims, Tamara A. (KSC-OP000)';
  r[NASA_COL.sbSpecialistEmail] = 'ksc-smallbusiness@mail.nasa.gov';
  r[NASA_COL.description] = 'Full requirement description, long form.';
  r[NASA_COL.summary] = 'Short summary.';
  r[NASA_COL.estValue] = '$250M - $500M';
  for (const [k, v] of Object.entries(over)) r[Number(k)] = v;
  return r;
};

describe('A. NAICS description — the official NAICS title, never a PSC description', () => {
  it('naics_description comes from NAICS Description[16]', () => {
    const m = mapNasaRow(row())!;
    expect(m.fields.naics_description).toBe('Research and Development in the Physical, Engineering and Life Sciences');
  });
  it('a PSC description can NEVER leak into naics_description', () => {
    const m = mapNasaRow(row({ [NASA_COL.pscDesc]: 'MAINT/REPAIR/REBUILD OF EQUIPMENT- ELECTRICAL' }))!;
    expect(m.fields.naics_description).not.toBe('MAINT/REPAIR/REBUILD OF EQUIPMENT- ELECTRICAL');
    expect(m.fields.psc_description).toBe('MAINT/REPAIR/REBUILD OF EQUIPMENT- ELECTRICAL');
  });
  it('naics_code is the 6-digit code', () => {
    expect(nasaNaics('541715')).toBe('541715');
    expect(nasaNaics('236220--Commercial Building')).toBe('236220');
  });
});

describe('B. PSC mapping lands in the PSC fields', () => {
  it('PSC Code -> psc_code, PSC Code Description -> psc_description', () => {
    const m = mapNasaRow(row())!;
    expect(m.fields.psc_code).toBe('AR15');
    expect(m.fields.psc_description).toBe('SPACE R&D SVCS');
  });
});

describe('C. POC role — the named technical contact, NOT the small-business mailbox', () => {
  it('poc_email/poc_name come from TechnicalPOC', () => {
    const m = mapNasaRow(row())!;
    expect(m.fields.poc_email).toBe('nicholas.s.reinert@nasa.gov');
    expect(m.fields.poc_name).toBe('Reinert, Nick (KSC-LXB00)');
  });
  it('SmallBusinessSpecialist must NOT populate poc_*', () => {
    const m = mapNasaRow(row())!;
    expect(m.fields.poc_email).not.toBe('ksc-smallbusiness@mail.nasa.gov');
    expect(m.fields.poc_name).not.toBe('Sims, Tamara A. (KSC-OP000)');
    expect(Object.values(m.fields)).not.toContain('ksc-smallbusiness@mail.nasa.gov');
  });
});

describe('D. Organisation — the Center, never the Mission Directorate', () => {
  it('bureau/contracting_office/program_office all hold the Center', () => {
    const m = mapNasaRow(row())!;
    expect(m.fields.bureau).toBe('KSC');
    expect(m.fields.contracting_office).toBe('KSC');
    expect(m.fields.program_office).toBe('KSC');
  });
  it('HQMissionDirectorate is UNMODELLED — it overwrites nothing', () => {
    const m = mapNasaRow(row())!;
    expect(Object.values(m.fields)).not.toContain('Human Exploration and Operations Mission Directorate');
  });
});

describe('E. Lifecycle precedence', () => {
  it('explicit Withdrawn wins from either column', () => {
    expect(nasaStatus('Withdrawn', 'Withdrawn')).toBe('Withdrawn');
    expect(nasaStatus('N/A', 'Withdrawn')).toBe('Withdrawn');
    expect(nasaStatus('Withdrawn', 'Revised')).toBe('Withdrawn');
  });
  it('SourceID 10072: only AcquisitionStatus says Awarded -> Awarded', () => {
    expect(nasaStatus('N/A', 'Awarded')).toBe('Awarded');
  });
  it('otherwise the acquisition state carries through', () => {
    expect(nasaStatus('N/A', 'Revised')).toBe('Revised');
    expect(nasaStatus('N/A', 'New')).toBe('New');
    expect(nasaStatus(null, 'Revised')).toBe('Revised');   // SourceID 10126
  });
  it('Withdrawn outranks Awarded when both appear', () => {
    expect(nasaStatus('Awarded', 'Withdrawn')).toBe('Withdrawn');
  });
});

describe('description — Description[43] only', () => {
  it('uses Description, never Summary', () => {
    const m = mapNasaRow(row())!;
    expect(m.fields.description).toBe('Full requirement description, long form.');
  });
  it('an empty Description does NOT fall back to Summary', () => {
    const m = mapNasaRow(row({ [NASA_COL.description]: null }))!;
    expect(m.fields.description).toBeNull();
    expect(Object.values(m.fields)).not.toContain('Short summary.');
  });
});

describe('field contracts', () => {
  it('derived and repair fields are separated from source-owned', () => {
    for (const f of NASA_DERIVED_FIELDS) expect(NASA_SOURCE_OWNED_FIELDS as readonly string[]).not.toContain(f);
    for (const f of NASA_LEGACY_REPAIR_FIELDS) expect(NASA_SOURCE_OWNED_FIELDS as readonly string[]).toContain(f);
  });
  it('enrichment is never source-owned', () => {
    for (const f of ['map_lat', 'map_lng', 'map_loc_source', 'last_synced_at', 'estimated_value_max']) {
      expect(NASA_SOURCE_OWNED_FIELDS as readonly string[]).not.toContain(f);
    }
  });
  it('a row without SourceID is rejected, never given a fallback identity', () => {
    expect(mapNasaRow(row({ [NASA_COL.sourceId]: null }))).toBeNull();
    expect(mapNasaRow(row({ [NASA_COL.sourceId]: '  ' }))).toBeNull();
  });
  it('TBD / N/A normalise to null rather than being stored as text', () => {
    expect(nasaCell('To Be Determined')).toBeNull();
    expect(nasaCell('TBD')).toBeNull();
    expect(nasaCell('N/A')).toBeNull();
  });
  it('value band parses to the minimum', () => {
    expect(nasaValueMin('$250M - $500M')).toBe(250_000_000);
    expect(nasaValueMin('$2.1M - $5M')).toBe(2_100_000);
    expect(nasaValueMin('$251K - $500K')).toBe(251_000);
  });
});
