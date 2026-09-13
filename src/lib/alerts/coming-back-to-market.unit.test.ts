import { describe, it, expect } from 'vitest';
import type { ExpiringContract } from '@/lib/recompete/query';
import {
  COMING_BACK_CAP,
  COMING_BACK_EXPLAIN,
  COMING_BACK_HEADING,
  COMING_BACK_PANEL_PATH,
  classifyNaicsRoles,
  renderComingBackSection,
  selectComingBackRows,
} from './coming-back-to-market';

function row(partial: Partial<ExpiringContract> & { contract_id: string }): ExpiringContract {
  return {
    contract_id: partial.contract_id,
    piid: partial.piid ?? partial.contract_id,
    incumbent_name: partial.incumbent_name ?? 'ACME LLC',
    incumbent_uei: partial.incumbent_uei ?? null,
    awarding_agency: partial.awarding_agency ?? 'Department of Defense',
    awarding_sub_agency: partial.awarding_sub_agency ?? null,
    naics_code: partial.naics_code ?? '561720',
    naics_description: partial.naics_description ?? null,
    psc_code: partial.psc_code ?? 'S201',
    description: partial.description === undefined ? null : partial.description,
    total_obligation: partial.total_obligation ?? 100_000,
    potential_total_value: partial.potential_total_value ?? 100_000,
    period_of_performance_start: partial.period_of_performance_start ?? '2024-01-01',
    period_of_performance_current_end: partial.period_of_performance_current_end ?? '2027-06-01',
    place_of_performance_state: partial.place_of_performance_state ?? null,
    place_of_performance_city: partial.place_of_performance_city ?? null,
    set_aside_type: partial.set_aside_type ?? null,
    competition_type: partial.competition_type ?? null,
    number_of_offers: partial.number_of_offers ?? null,
    estimated_recompete_date: partial.estimated_recompete_date ?? null,
    lead_time_months: partial.lead_time_months ?? 12,
    recompete_likelihood: partial.recompete_likelihood ?? null,
  };
}

describe('Coming Back to Market — omit vs show', () => {
  it('omits when the query failed and never says 0', () => {
    const out = selectComingBackRows({
      contracts: [],
      count: 0,
      degraded: true,
      naicsCodes: ['561720'],
    });
    expect(out).toEqual({ kind: 'omit', reason: 'query_failed' });
    expect(renderComingBackSection(out, { panelUrl: 'https://getmindy.ai/app?panel=recompetes' })).toBe('');
    expect(renderComingBackSection(out, { panelUrl: 'https://getmindy.ai/app?panel=recompetes' })).not.toMatch(/0 recompete/i);
  });

  it('omits when count is unknown rather than treating it as 0', () => {
    const out = selectComingBackRows({
      contracts: [row({ contract_id: 'has-rows-but-count-unknown', lead_time_months: 12 })],
      count: null,
      naicsCodes: ['561720'],
    });
    expect(out).toEqual({ kind: 'omit', reason: 'unknown_count' });
    expect(renderComingBackSection(out, { panelUrl: 'https://getmindy.ai/app?panel=recompetes' })).toBe('');
  });

  it('omits when nothing qualifies and does not render a zero section', () => {
    const out = selectComingBackRows({
      contracts: [row({ contract_id: 'too-far', lead_time_months: 24 })],
      count: 1,
      naicsCodes: ['561720'],
    });
    expect(out).toEqual({ kind: 'omit', reason: 'none_qualify' });
    expect(renderComingBackSection(out, { panelUrl: 'https://getmindy.ai/app?panel=recompetes' })).toBe('');
  });

  it('omits when the profile has no NAICS market', () => {
    const out = selectComingBackRows({
      contracts: [row({ contract_id: 'x', lead_time_months: 12 })],
      count: 10,
      naicsCodes: [],
      keywords: ['janitorial'],
    });
    expect(out).toEqual({ kind: 'omit', reason: 'no_naics_market' });
  });
});

describe('Coming Back to Market — rank and cap', () => {
  it('from thousands of market matches still emits 5, with 6–18 leading', () => {
    const contracts: ExpiringContract[] = [];
    for (let i = 0; i < 2500; i++) {
      contracts.push(
        row({
          contract_id: `soon-${i}`,
          incumbent_name: `Soon Incumbent ${i}`,
          lead_time_months: 2,
          potential_total_value: 90_000_000 + i,
          awarding_agency: 'Department of the Interior',
        }),
      );
    }
    for (let i = 0; i < 1500; i++) {
      contracts.push(
        row({
          contract_id: `lead-${i}`,
          incumbent_name: `Lead Incumbent ${i}`,
          lead_time_months: 9,
          potential_total_value: 1_000_000 + i,
          awarding_agency: 'Department of Defense',
        }),
      );
    }
    const out = selectComingBackRows({
      contracts,
      count: 4000,
      naicsCodes: ['561720'],
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows).toHaveLength(COMING_BACK_CAP);
    expect(out.rows.every((r) => r.window === 'lead_6_18')).toBe(true);
    expect(out.rows[0].incumbent).toBe('Lead Incumbent 1499');
    expect(out.rows.some((r) => (r.incumbent || '').startsWith('Soon '))).toBe(false);
  });

  it('shows N when fewer than five qualify', () => {
    const out = selectComingBackRows({
      contracts: [
        row({ contract_id: 'a', incumbent_name: 'Alpha', lead_time_months: 10, potential_total_value: 3 }),
        row({ contract_id: 'b', incumbent_name: 'Beta', lead_time_months: 11, potential_total_value: 2 }),
      ],
      count: 2,
      naicsCodes: ['561720'],
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows).toHaveLength(2);
    expect(out.rows.map((r) => r.incumbent)).toEqual(['Alpha', 'Beta']);
  });

  it('keeps a row with an empty description and does not invent one', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'no-desc',
          incumbent_name: 'No Desc LLC',
          description: null,
          lead_time_months: 12,
        }),
      ],
      count: 1,
      naicsCodes: ['561720'],
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('No Desc LLC');
    const html = renderComingBackSection(out, { panelUrl: `https://getmindy.ai${COMING_BACK_PANEL_PATH}` });
    expect(html).toContain('No Desc LLC');
    expect(html).not.toMatch(/undefined|TODO|Lorem/i);
  });

  it('does not let keyword interior collapse the list to Department of the Interior', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'doi-soon-huge',
          incumbent_name: 'Interior Janitorial Co',
          awarding_agency: 'Department of the Interior',
          lead_time_months: 2,
          potential_total_value: 50_000_000,
        }),
        row({
          contract_id: 'army-lead',
          incumbent_name: 'Army Grounds LLC',
          awarding_agency: 'Department of the Army',
          lead_time_months: 10,
          potential_total_value: 400_000,
        }),
      ],
      count: 2,
      naicsCodes: ['561720'],
      keywords: ['interior', 'janitorial'],
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('Army Grounds LLC');
    expect(out.rows[0].agency).toBe('Department of the Army');
    expect(out.rows.some((r) => /Interior/i.test(r.agency || '') && r.window === 'lead_6_18')).toBe(false);
  });

  it('still returns NAICS-market rows for a user with no keywords', () => {
    const out = selectComingBackRows({
      contracts: [row({ contract_id: 'nk', incumbent_name: 'No Keywords Inc', naics_code: '541512', lead_time_months: 14 })],
      count: 1,
      naicsCodes: ['541512'],
      keywords: [],
    });
    expect(out).toMatchObject({
      kind: 'show',
      rows: [{ incumbent: 'No Keywords Inc', naics: '541512' }],
    });
  });
});

describe('Coming Back to Market — email copy', () => {
  it('renders the section heading, capture caveat, provenance, and panel link without a hard market total', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'c1',
          incumbent_name: 'Central Plains Janitorial',
          awarding_agency: 'Department of Agriculture',
          naics_code: '561720',
          potential_total_value: 250_000,
          period_of_performance_current_end: '2027-03-15',
          lead_time_months: 8,
        }),
      ],
      count: 5876,
      naicsCodes: ['561720', '561210'],
    });
    const html = renderComingBackSection(out, { panelUrl: `https://getmindy.ai${COMING_BACK_PANEL_PATH}` });
    expect(html).toContain(COMING_BACK_HEADING);
    expect(html).toContain(COMING_BACK_EXPLAIN);
    expect(html).toContain('Central Plains Janitorial');
    expect(html).toContain('NAICS 561720');
    expect(html).toContain('Expires Mar 15, 2027');
    expect(html).toContain('/app?panel=recompetes');
    expect(html).toContain('View the full market');
    expect(html).not.toContain('5876');
    expect(html).not.toMatch(/5,876/);
    expect(html).not.toMatch(/0 recompete/i);
    expect(html).toMatch(/not confirmed solicitations/i);
    expect(html).toMatch(/Potential value \(ceiling\)/);
    expect(html).not.toMatch(/the entire amount will be recompeted/i);
  });
});

describe('Coming Back to Market — targeting', () => {
  it('treats the majority 3-digit family as core and a lone 561210 as secondary', () => {
    expect(classifyNaicsRoles(['541512', '541611', '541330', '561210', '541511'])).toEqual({
      core: ['541512', '541611', '541330', '541511'],
      secondary: ['561210'],
    });
    expect(classifyNaicsRoles(['561210', '561720', '561730', '561790', '238990'])).toEqual({
      core: ['561210', '561720', '561730', '561790'],
      secondary: ['238990'],
    });
  });

  it('does not let secondary 561210 value outrank a core IT recompete', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'sandia',
          incumbent_name: 'NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC',
          awarding_agency: 'Department of Energy',
          naics_code: '561210',
          potential_total_value: 43_200_000_000,
          lead_time_months: 8,
        }),
        row({
          contract_id: 'it-prime',
          incumbent_name: 'Radus Fit Software LLC',
          awarding_agency: 'Department of the Air Force',
          naics_code: '541512',
          potential_total_value: 2_400_000,
          lead_time_months: 11,
        }),
      ],
      count: 2,
      naicsCodes: ['541512', '541611', '541330', '561210', '541511'],
      profile: {
        storedNaics: ['541512', '541611', '541330', '561210', '541511'],
        naicsSource: null,
        businessType: null,
      },
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('Radus Fit Software LLC');
    expect(out.rows[0].naicsRole).toBe('core');
    expect(out.rows[0].fit).toBe('prime');
    expect(out.rows[0].why).toMatch(/Core NAICS 541512/);
    expect(out.rows.some((r) => r.contract_id === 'sandia' && r.fit === 'teaming')).toBe(true);
  });

  it('on a facilities profile keeps 561210 but demotes DOE nuclear M&O behind size-fit primes', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'sandia',
          incumbent_name: 'NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC',
          awarding_agency: 'Department of Energy',
          naics_code: '561210',
          potential_total_value: 43_200_000_000,
          lead_time_months: 8,
        }),
        row({
          contract_id: 'cns',
          incumbent_name: 'CONSOLIDATED NUCLEAR SECURITY, LLC',
          awarding_agency: 'Department of Energy',
          naics_code: '561210',
          potential_total_value: 34_700_000_000,
          lead_time_months: 13,
        }),
        row({
          contract_id: 'janitorial',
          incumbent_name: 'Prairie Janitorial LLC',
          awarding_agency: 'Department of the Army',
          naics_code: '561720',
          potential_total_value: 420_000,
          lead_time_months: 10,
        }),
      ],
      count: 3,
      naicsCodes: ['561210', '561720', '561730'],
      profile: {
        storedNaics: ['561210', '561720', '561730'],
        naicsSource: 'user_confirmed',
        businessType: 'Small Business',
        keywords: ['janitorial', 'grounds maintenance', 'facility support'],
      },
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('Prairie Janitorial LLC');
    expect(out.rows[0].fit).toBe('prime');
    expect(out.rows.filter((r) => r.fit === 'teaming' && r.nuclearMo).length).toBeLessThan(5);
    expect(out.rows[0].why).toMatch(/Core NAICS 561720/);
  });

  it('labels a small-business mega vehicle as teaming and does not present it as the best prime', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'mega',
          incumbent_name: 'Whale Facilities Inc',
          awarding_agency: 'Department of Defense',
          naics_code: '561210',
          potential_total_value: 800_000_000,
          lead_time_months: 9,
        }),
        row({
          contract_id: 'fit',
          incumbent_name: 'Local Facilities LLC',
          awarding_agency: 'Department of the Army',
          naics_code: '561210',
          potential_total_value: 1_200_000,
          lead_time_months: 12,
        }),
      ],
      count: 2,
      naicsCodes: ['561210'],
      profile: {
        storedNaics: ['561210'],
        businessType: 'Small Business',
      },
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('Local Facilities LLC');
    expect(out.rows[0].fit).toBe('prime');
    const mega = out.rows.find((r) => r.contract_id === 'mega');
    expect(mega?.fit).toBe('teaming');
    const html = renderComingBackSection(out, { panelUrl: `https://getmindy.ai${COMING_BACK_PANEL_PATH}` });
    expect(html).toContain('Teaming opportunity');
  });

  it('diversifies so one NAICS cannot occupy all five slots when other core codes qualify', () => {
    const contracts = [
      ...[0, 1, 2, 3, 4].map((i) =>
        row({
          contract_id: `fac-${i}`,
          incumbent_name: `Facilities Whale ${i}`,
          naics_code: '561210',
          potential_total_value: 10_000_000 + i,
          lead_time_months: 10,
        }),
      ),
      row({
        contract_id: 'jan-a',
        incumbent_name: 'Janitorial Alpha',
        naics_code: '561720',
        potential_total_value: 500_000,
        lead_time_months: 11,
      }),
      row({
        contract_id: 'jan-b',
        incumbent_name: 'Janitorial Beta',
        naics_code: '561720',
        potential_total_value: 400_000,
        lead_time_months: 12,
      }),
    ];
    const out = selectComingBackRows({
      contracts,
      count: 7,
      naicsCodes: ['561210', '561720'],
      profile: { storedNaics: ['561210', '561720'], businessType: 'Small Business' },
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows).toHaveLength(5);
    const byNaics = out.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.naics || ''] = (acc[r.naics || ''] || 0) + 1;
      return acc;
    }, {});
    expect(byNaics['561210']).toBeLessThanOrEqual(3);
    expect(byNaics['561720']).toBeGreaterThanOrEqual(2);
    expect(out.rows.some((r) => r.incumbent === 'Janitorial Alpha')).toBe(true);
  });

  it('treats a $250M+ vehicle as teaming when business type is unknown', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'embassy',
          incumbent_name: 'BL Harbert Mega',
          naics_code: '236220',
          potential_total_value: 442_000_000,
          lead_time_months: 6,
        }),
        row({
          contract_id: 'local',
          incumbent_name: 'Blue Cord Local',
          naics_code: '236220',
          potential_total_value: 18_700_000,
          lead_time_months: 6,
        }),
      ],
      count: 2,
      naicsCodes: ['236220'],
      profile: { storedNaics: ['236220'], businessType: null },
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('Blue Cord Local');
    expect(out.rows.find((r) => r.contract_id === 'embassy')?.fit).toBe('teaming');
  });

  it('does not let a $90M weak-relevance vehicle beat a core 6–18 match', () => {
    const out = selectComingBackRows({
      contracts: [
        row({
          contract_id: 'weak',
          incumbent_name: 'Interior Janitorial Co',
          awarding_agency: 'Department of the Interior',
          naics_code: '561210',
          potential_total_value: 90_000_000,
          lead_time_months: 9,
        }),
        row({
          contract_id: 'core',
          incumbent_name: 'Custom Software LLC',
          awarding_agency: 'Department of the Navy',
          naics_code: '541512',
          potential_total_value: 350_000,
          lead_time_months: 14,
        }),
      ],
      count: 2,
      naicsCodes: ['541512', '541611', '541330', '541990', '561210'],
      keywords: ['interior'],
      profile: {
        storedNaics: ['541512', '541611', '541330', '541990', '561210'],
        naicsSource: 'system_default',
      },
    });
    expect(out.kind).toBe('show');
    if (out.kind !== 'show') return;
    expect(out.rows[0].incumbent).toBe('Custom Software LLC');
    expect(out.rows[0].value).toBe(350_000);
  });
});
