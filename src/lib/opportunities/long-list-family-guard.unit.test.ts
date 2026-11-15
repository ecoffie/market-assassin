import { describe, it, expect } from 'vitest';
import { interpretMarket } from './market-interpretation';
import { labelOpenRow } from './find-opportunities';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';

/**
 * Long-list family guard (Agent 3, 2026-11-15). Diagnosis: Agent 4's v7 RC3 preview + the holdout runner on the
 * Nov 14 snapshot. Every title below is a real open notice that sat in a long phrasing's top 20 as DIRECT. Business
 * descriptions are Agent 4's public benchmark phrasings (queries_v4.json). One describe per rule.
 */
const CTX = { today: '2026-11-15', fiscalYear: 2027 };
const PAVING = 'We are a paving and site work contractor. We mill and pave asphalt, repair parking lots and roads, pour concrete curbs and sidewalks, stripe pavement and do grading and drainage.';
const MEDICAL = 'We are a medical supply distributor. We provide medical, surgical, dental and laboratory supplies and consumables such as gloves, syringes, dressings, reagents and lab equipment to hospitals and clinics.';
const PARTS = 'We are a supplier of industrial and defense replacement parts. We source and deliver spare parts, components and assemblies for military equipment, vehicles, aircraft and industrial machinery, identified by NSN and part number.';
const JANITORIAL = 'We are a commercial cleaning company. We provide janitorial and custodial services for office buildings: daily cleaning, restroom sanitation, trash removal, floor care, carpet cleaning and window washing.';
const IT = 'We are an IT hardware reseller. We sell laptops, desktops, servers, monitors, networking equipment, storage and peripherals, including installation and warranty support.';
const label = (q: string, title: string, psc: string | null) =>
  labelOpenRow({ title, psc_code: psc, description: '' }, buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX), interpretMarket(q, null).capability, null);

describe('one list word in the title, wrong code family → RELATED, not DIRECT', () => {
  it('paving: "mill", "pave" and "concrete" in a product or R&D notice', () => {
    for (const [t, psc] of [['MITR Chemically Milled Plate', '9650'], ['STABILIZER BAR DAMPER ASSEMBLY / 27F, HH-60 ALL VARIATIONS PAVE HAWK', '1615'], ['Concrete Shield Blocks', 'AJ13']] as const) {
      const l = label(PAVING, t, psc);
      expect(l.cls, t).toBe('RELATED_MARKET_CANDIDATE');
      expect(l.basis[0]).toBe('single_list_word');
    }
  });
  it('medical: "consumables" and "dressings" outside the medical FSC groups', () => {
    expect(label(MEDICAL, 'PERCUSSION CONSUMABLES', '7720').cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(label(MEDICAL, 'FCC TUCSON - Q2 FY27 NATIONAL MENU - DRESSING AND CONDIMENTS', '8950').cls).toBe('RELATED_MARKET_CANDIDATE');
  });
  it('the same word in the business\'s own family stays DIRECT', () => {
    expect(label(PAVING, 'Asphalt Services at Carr Creek Lake', 'Z2LB').cls).toBe('DIRECT_MATCH');
    expect(label(PAVING, 'LOADING DOCK CONCRETE REPAIRS', 'Z1DA').cls).toBe('DIRECT_MATCH');
    expect(label(MEDICAL, '6550--Blood Type IVD Reagents', '6550').cls).toBe('DIRECT_MATCH');
  });
  it('two or more list words stay DIRECT whatever the code', () => {
    expect(label(PAVING, 'Z1DA--528A5-27-504 Seal and Stripe Parking Lots', 'Z1DA').cls).toBe('DIRECT_MATCH');
    expect(label(JANITORIAL, 'TRASH REMOVAL AND HAULING SERVICES-FCI MCKEAN', 'S205').cls).toBe('DIRECT_MATCH');
  });
  it('"we provide … services" is a service business, not a supplier (service codes agree)', () => {
    expect(label(JANITORIAL, '637TRSS Carpet Cleaning', 'S214').cls).toBe('DIRECT_MATCH');
    expect(label(JANITORIAL, '93--HEAD WINDOW ASSY', '9340').cls).toBe('RELATED_MARKET_CANDIDATE');
  });
  it('a missing code is not evidence against', () => {
    expect(label(PAVING, 'Paving Acquisition Vehicle - Rockies (PAV-R) IDIQ Sources Sought', null).cls).toBe('DIRECT_MATCH');
  });
});

describe('words that only say who the parts are FOR never make a notice DIRECT ("parts … for vehicles")', () => {
  it('whole-vehicle buys are RELATED for a parts supplier', () => {
    for (const [t, psc] of [['Supply and delivery of 2 x new Right-Hand Vehicles', '2310'], ['Armored Vehicles (SUVs) - U.S. Embassy Quito', '2320'], ['25--TURRET,COMBAT VEHICLE', '25']] as const) {
      const l = label(PARTS, t, psc);
      expect(l.cls, t).toBe('RELATED_MARKET_CANDIDATE');
      expect(l.basis[0]).toBe('single_list_word');
    }
  });
  it('an item named by a core list word stays DIRECT', () => {
    expect(label(PARTS, 'Procurement of Gearbox Assemblies for HC-130J Aircraft', '1620').cls).toBe('DIRECT_MATCH');
  });
});

describe('scope: short phrasings, trades and strict presets are untouched; rows are never dropped', () => {
  it('a short sentence keeps today\'s behaviour (the guard needs more than 15 words)', () => {
    expect(label('We mill and pave asphalt roads.', 'MITR Chemically Milled Plate', '9650').cls).toBe('DIRECT_MATCH');
  });
  it('IT hardware long: services notices were already not DIRECT (strict item rule); the guard does not change that', () => {
    expect(label(IT, 'IT Lifecycle Support Services IDIQ', 'DA01').cls).not.toBe('DIRECT_MATCH');
    expect(label(IT, 'Dell Latitude 5430 Rugged Laptops', '7E20').cls).toBe('DIRECT_MATCH');
  });
  it('a guarded row keeps a reason and a RELATED tier (shown, not removed)', () => {
    const l = label(PAVING, 'MITR Chemically Milled Plate', '9650');
    expect(l.tier).toBeGreaterThan(0);
    expect(l.tier).toBeLessThan(2);
  });
});
