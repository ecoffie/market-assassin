import { describe, it, expect } from 'vitest';
import { cleanPscLabel, composeCapabilitySummary, money } from './psc-label';

describe('cleanPscLabel', () => {
  it('returns null for empty/missing input rather than a placeholder', () => {
    // A wrong capability label is worse than none — callers must handle null.
    expect(cleanPscLabel(null)).toBeNull();
    expect(cleanPscLabel(undefined)).toBeNull();
    expect(cleanPscLabel('')).toBeNull();
    expect(cleanPscLabel('   ')).toBeNull();
  });

  it('uses the curated override when one exists', () => {
    expect(cleanPscLabel('SUPPORT- PROFESSIONAL: OTHER')).toBe('Professional services');
    expect(cleanPscLabel('HOUSEKEEPING- GUARD')).toBe('Security guard services');
    // Curated lookup is case-insensitive on the raw government string.
    expect(cleanPscLabel('housekeeping- guard')).toBe('Security guard services');
  });

  it('leads with the verb for action-shaped categories (not a trailing parenthetical)', () => {
    // Regression: the first pass emitted "… (maintenance & Repair Of)" which read terribly.
    expect(cleanPscLabel('MAINT/REPAIR/REBUILD OF EQUIPMENT- ELECTRICAL AND ELECTRONIC EQUIPMENT COMPONENTS'))
      .toBe('Maintenance & repair of electrical and electronic equipment components');
    expect(cleanPscLabel('INSTALLATION OF EQUIPMENT- ELECTRICAL AND ELECTRONIC EQUIPMENT COMPONENTS'))
      .toBe('Installation of electrical and electronic equipment components');
  });

  it('sentence-cases rather than title-cases, preserving acronyms', () => {
    const out = cleanPscLabel('NATIONAL DEFENSE R&D SERVICES; DEPARTMENT OF DEFENSE - MILITARY; APPLIED RESEARCH');
    expect(out).toBe('Applied research (national defense R&D services)');
    // R&D must survive lower-casing.
    expect(out).toContain('R&D');
  });

  it('keeps the domain and the most specific segment from semicolon forms, dropping the funding middle', () => {
    // The middle segment is the funding agency — not a capability.
    expect(cleanPscLabel('NATIONAL DEFENSE R&D SERVICES; DEFENSE-RELATED ACTIVITIES; APPLIED RESEARCH'))
      .toBe('Applied research (national defense R&D services)');
  });

  it('drops uninformative qualifiers', () => {
    // ": OTHER" carries no signal, so the category is the label.
    expect(cleanPscLabel('SUPPORT- MANAGEMENT: OTHER')).toBe('Management support services');
    // A leading "MISCELLANEOUS" adds nothing.
    expect(cleanPscLabel('MISCELLANEOUS OFFICE MACHINES')).toBe('Office machines');
  });

  it('caps length at a word boundary without leaving a dangling separator', () => {
    const long = cleanPscLabel('MAINT/REPAIR/REBUILD OF EQUIPMENT- REFRIGERATION, AIR CONDITIONING, AND AIR CIRCULATING EQUIPMENT');
    expect(long!.length).toBeLessThanOrEqual(73);
    expect(long!.endsWith('…')).toBe(true);
    // must not end with a stranded separator before the ellipsis
    expect(long).not.toMatch(/[\s(,&/-]…$/);
  });

  it('recovers a label when every segment is OTHER/MISCELLANEOUS (regression: 11 nulls per 3k)', () => {
    // Over-aggressive stripping of OTHER/MISCELLANEOUS used to blank these entirely.
    expect(cleanPscLabel('TRANSPORTATION/TRAVEL/RELOCATION- OTHER: OTHER')).toBe('Transportation/travel/relocation');
    expect(cleanPscLabel('TECHNICAL REPRESENTATIVE- MISCELLANEOUS')).toBe('Technical representative');
    expect(cleanPscLabel('EQUIPMENT AND MATERIALS TESTING- MISCELLANEOUS')).toBe('Equipment and materials testing');
    // Leading "OTHER" is dropped only when something substantive survives — and QC stays upper.
    expect(cleanPscLabel('OTHER QC/TEST/INSPECT- MISCELLANEOUS')).toBe('QC/test/inspect');
  });

  it('promotes a trailing parenthetical when the middle segments carry no detail', () => {
    // "DEFENSE OTHER: OTHER" is detail-free; "(BASIC RESEARCH)" is the only real signal.
    expect(cleanPscLabel('R&D- DEFENSE OTHER: OTHER (BASIC RESEARCH)')).toBe('Basic research (R&D)');
  });

  it('collapses a duplicated parenthetical and a double parenthetical', () => {
    // Regression: "Relocation (relocation)" and "… (labor) (IT & telecom)".
    expect(cleanPscLabel('RELOCATION- RELOCATION')).toBe('Relocation');
    const it2 = cleanPscLabel('IT AND TELECOM - IT MANAGEMENT SUPPORT SERVICES (LABOR)')!;
    expect((it2.match(/\(/g) || []).length).toBeLessThanOrEqual(1);
  });

  it('never invents a token absent from the source string', () => {
    // Output must be a re-cased/re-ordered form of the input words — no new claims.
    const raw = 'ENVIRONMENTAL SYSTEMS PROTECTION- ENVIRONMENTAL REMEDIATION';
    const out = cleanPscLabel(raw)!;
    for (const w of out.toLowerCase().replace(/[()&…,]/g, ' ').split(/[\s/-]+/).filter(Boolean)) {
      expect(raw.toLowerCase()).toContain(w.replace(/…$/, ''));
    }
  });
});

describe('composeCapabilitySummary', () => {
  const base = {
    capability_label: 'Custodial & janitorial services',
    specialty_tier: 'specialist' as const,
    specialty_score: 0.92,
    award_count: 14,
    total_obligated: 19_500_000,
    top_agencies: [{ agency: 'Department of Defense', share: 0.61 }],
    top_pscs: [{ description: 'HOUSEKEEPING- CUSTODIAL JANITORIAL' }],
    last_award_date: '2026-06-01',
    set_asides_won: ['SMALL BUSINESS SET ASIDE - TOTAL'],
  };

  it('returns null without a label (never a fabricated summary)', () => {
    expect(composeCapabilitySummary({ ...base, capability_label: null })).toBeNull();
  });

  it('states the concentration as a measured percentage, not an adjective', () => {
    const s = composeCapabilitySummary(base)!;
    expect(s).toContain('92% of contract dollars');
    expect(s).not.toMatch(/highly|leading|premier|best/i);
  });

  it('includes award count and dollars', () => {
    expect(composeCapabilitySummary(base)).toContain('14 awards · $19.5M');
  });

  it('describes set-asides as work WON, never as a held certification', () => {
    const s = composeCapabilitySummary(base)!;
    expect(s).toContain('has won set-aside work');
    // Must not imply the firm holds a cert — recipient_certifications is the source of truth.
    expect(s).not.toMatch(/certified|SDVOSB|8\(a\)|HUBZone|WOSB/i);
  });

  it('ignores the "NO SET ASIDE USED" sentinel', () => {
    const s = composeCapabilitySummary({ ...base, set_asides_won: ['NO SET ASIDE USED.'] })!;
    expect(s).not.toContain('set-aside work');
  });

  it('omits the top agency when concentration is below 40% (it would be noise)', () => {
    const s = composeCapabilitySummary({ ...base, top_agencies: [{ agency: 'Dept of Energy', share: 0.22 }] })!;
    expect(s).not.toContain('Dept of Energy');
  });

  it('preserves acronyms in the diversified "led by" clause (regression: r&D / it & telecom)', () => {
    const rd = composeCapabilitySummary({
      ...base, specialty_tier: 'diversified', specialty_score: 0.3,
      capability_label: 'R&D administrative expenses',
      top_pscs: [{ description: 'A' }, { description: 'B' }],
    })!;
    expect(rd).toContain('led by R&D administrative expenses');
    expect(rd).not.toContain('r&D');

    const it = composeCapabilitySummary({
      ...base, specialty_tier: 'diversified', specialty_score: 0.3,
      capability_label: 'IT management support services',
      top_pscs: [{ description: 'A' }, { description: 'B' }],
    })!;
    expect(it).toContain('led by IT management');
  });

  it('does not embed an ellipsis-truncated label mid-summary', () => {
    const s = composeCapabilitySummary({
      ...base,
      capability_label: 'Business application/application development software as a service (IT…',
    })!;
    expect(s).not.toContain('(IT…');
    expect(s).toContain('specialist —');
  });

  it('phrases diversified firms as led-by rather than claiming a specialty', () => {
    const s = composeCapabilitySummary({
      ...base, specialty_tier: 'diversified', specialty_score: 0.3,
      top_pscs: [{ description: 'A' }, { description: 'B' }],
    })!;
    expect(s).toMatch(/^Diversified, led by/);
    expect(s).not.toContain('specialist');
  });

  it('singularizes a single award', () => {
    expect(composeCapabilitySummary({ ...base, award_count: 1 })).toContain('1 award ·');
  });
});

describe('money', () => {
  it('formats at sane magnitudes', () => {
    expect(money(1_234_567_890)).toBe('$1.2B');
    expect(money(19_500_000)).toBe('$19.5M');
    expect(money(45_000)).toBe('$45K');
    expect(money(500)).toBe('$500');
  });
  it('treats null/undefined as zero rather than throwing', () => {
    expect(money(null)).toBe('$0');
    expect(money(undefined)).toBe('$0');
  });
});
