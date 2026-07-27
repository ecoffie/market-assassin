/**
 * Filter-parity guard (2026-07-26): every VISIBLE filter control on the Opportunity Map must
 * be honored by the active dataset's endpoint — no dead controls (ground-in-real-data). This
 * pins the per-mode top-bar disable matrix (`disabledIdsFor`) and the deep-panel visibility
 * markup (`mfv-<mode>` classes + `data-mfsec` grouping) so a future edit can't silently
 * re-enable a control a dataset's endpoint doesn't back — or silently disable one it does.
 *
 * Measured column evidence (recompete_opportunities, 2026-07-26, quality_flag IS NULL AND
 * map_lat IS NOT NULL, n=125,917):
 *   place_of_performance_state populated 125,830 (99.9%)
 *   awarding_sub_agency        populated 125,914 (100.0%)
 *   potential_total_value > 0  populated 125,917 (100.0%)
 *   psc_code                   populated       0 (0.0%)  <- NEVER wire PSC for Awarded
 * federal_contacts (buyers), 2026-07-26, usable base n=98,024:
 *   department_ind_agency      populated  98,024 (100.0%)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return routeSrc.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

describe('opportunity-map filter parity — top-bar disable matrix', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disabledIdsFor = new Function(`${extractFn('disabledIdsFor')}; return disabledIdsFor;`)() as (
    mode: string,
  ) => string[];

  it('open: nothing disabled — Notice type/NAICS/Set-aside all fire on the open-opp endpoint', () => {
    expect(disabledIdsFor('open')).toEqual([]);
  });

  it('recompete (Awarded): Notice type disabled (no notice_type column), NAICS + Set-aside stay live', () => {
    const d = disabledIdsFor('recompete');
    expect(d).toContain('fltNotice');
    expect(d).not.toContain('naicsBtn');
    expect(d).not.toContain('saselBtn');
  });

  it('companies: Notice type disabled, NAICS + Set-aside stay live (searchRecipients honors both)', () => {
    const d = disabledIdsFor('companies');
    expect(d).toContain('fltNotice');
    expect(d).not.toContain('naicsBtn');
    expect(d).not.toContain('saselBtn');
  });

  it('buyers: Notice type + NAICS + Set-aside all disabled (contacts have no notice/naics/set-aside)', () => {
    const d = disabledIdsFor('buyers');
    expect(d).toEqual(expect.arrayContaining(['fltNotice', 'naicsBtn', 'saselBtn']));
  });
});

describe('opportunity-map filter parity — deep-panel mfv-<mode> visibility classes', () => {
  // The mfv-<mode> classes live on the WRAPPING <label class="mf-field mfv-...">, not on the
  // input/select itself (which carries its OWN class="mf-in" right next to id="mfNaics") — find
  // the id, then the FURTHEST preceding `class="..."` attribute within the same <label ...> open
  // tag (i.e. the first class= after the last '<label' before the id).
  function fieldClasses(id: string): string {
    const idIdx = routeSrc.indexOf(`id="${id}"`);
    expect(idIdx, `field #${id} must exist`).toBeGreaterThan(-1);
    const before = routeSrc.slice(Math.max(0, idIdx - 400), idIdx);
    const labelIdx = before.lastIndexOf('<label');
    expect(labelIdx, `no wrapping <label before #${id}`).toBeGreaterThan(-1);
    const labelTag = before.slice(labelIdx);
    const m = labelTag.match(/class="([^"]*)"/);
    expect(m, `no class= found on the <label wrapping #${id}`).toBeTruthy();
    return m![1];
  }

  it('NAICS fires on open/recompete/companies, NOT buyers (contacts have no NAICS column)', () => {
    const cls = fieldClasses('mfNaics');
    expect(cls).toContain('mfv-open');
    expect(cls).toContain('mfv-recompete');
    expect(cls).toContain('mfv-companies');
    expect(cls).not.toContain('mfv-buyers');
  });

  it('PSC fires ONLY on open — recompete psc_code is measured 0% populated, never wired', () => {
    const cls = fieldClasses('mfPsc');
    expect(cls).toContain('mfv-open');
    expect(cls).not.toContain('mfv-recompete');
    expect(cls).not.toContain('mfv-companies');
    expect(cls).not.toContain('mfv-buyers');
  });

  it('Agency fires on open/recompete/buyers, NOT companies (searchRecipients has no agency param)', () => {
    const cls = fieldClasses('mfAgency');
    expect(cls).toContain('mfv-open');
    expect(cls).toContain('mfv-recompete');
    expect(cls).toContain('mfv-buyers');
    expect(cls).not.toContain('mfv-companies');
  });

  it('Sub-agency fires on open/recompete only (awarding_sub_agency has no companies/buyers equivalent)', () => {
    const cls = fieldClasses('mfSubAgency');
    expect(cls).toContain('mfv-open');
    expect(cls).toContain('mfv-recompete');
    expect(cls).not.toContain('mfv-companies');
    expect(cls).not.toContain('mfv-buyers');
  });

  it('State fires on all 4 datasets — every dataset has a real state column/derivation', () => {
    const cls = fieldClasses('mfState');
    expect(cls).toContain('mfv-open');
    expect(cls).toContain('mfv-recompete');
    expect(cls).toContain('mfv-companies');
    expect(cls).toContain('mfv-buyers');
  });

  it('Country/HasDocs/HasContact/Posted fire ONLY on open (opp-shaped fields, no equivalent elsewhere)', () => {
    for (const id of ['mfCountry', 'mfHasDocs', 'mfHasContact', 'mfPosted']) {
      const cls = fieldClasses(id);
      expect(cls, id).toContain('mfv-open');
      expect(cls, id).not.toContain('mfv-recompete');
      expect(cls, id).not.toContain('mfv-companies');
      expect(cls, id).not.toContain('mfv-buyers');
    }
  });

  it('Value range (#mfValue) is tagged recompete-only', () => {
    // #mfValue is a bare <select class="..." id="mfValue">, not wrapped in a <label> —
    // its own class attribute carries the mfv- tag directly.
    const m = routeSrc.match(/class="([^"]*)"[^>]*id="mfValue"/);
    expect(m, 'class= must exist on the #mfValue select').toBeTruthy();
    const cls = m![1];
    expect(cls).toContain('mf-value');
    expect(cls).toContain('mfv-recompete');
    expect(cls).not.toContain('mfv-open');
    expect(cls).not.toContain('mfv-companies');
    expect(cls).not.toContain('mfv-buyers');
  });
});

describe('opportunity-map filter parity — fetchView param wiring', () => {
  it('recompete (Awarded) branch sends state + subAgency, never psc', () => {
    // Anchor on the specific fetchView block (contains the `url+=` param-append lines) —
    // `if(MODE==='recompete')` also appears earlier in updateSourceBadge, so anchor past that.
    const anchor = "if(MODE==='recompete'){\n      if(FILT.state)";
    const start = routeSrc.indexOf(anchor);
    expect(start, 'expected the fetchView recompete param block').toBeGreaterThan(-1);
    const end = routeSrc.indexOf('}', start);
    const block = routeSrc.slice(start, end);
    expect(block).toContain("FILT.state");
    expect(block).toContain("FILT.subAgency");
    expect(block).not.toContain('psc');
  });

  it('the contacts-map branch (Companies/Buyers) sends naics only for companies, agency only for buyers', () => {
    const start = routeSrc.indexOf('if(isContactMode(MODE)){');
    expect(start).toBeGreaterThan(-1);
    const end = routeSrc.indexOf('return;\n    }', start);
    const block = routeSrc.slice(start, end);
    expect(block).toContain("_ctNaics=(MODE==='companies')");
    expect(block).toContain("_ctAgency=(MODE==='buyers')");
  });
});

describe('recompete-map route — new params backed by measured-populated columns only', () => {
  const recomputeSrc = readFileSync(
    join(__dirname, '../api/app/recompete-map/route.ts'),
    'utf8',
  );

  it('wires state, subAgency, minValue/maxValue', () => {
    expect(recomputeSrc).toContain("place_of_performance_state', state");
    expect(recomputeSrc).toContain("awarding_sub_agency', `%${subAgency}%`");
    expect(recomputeSrc).toContain("potential_total_value', minValue");
    expect(recomputeSrc).toContain("potential_total_value', maxValue");
  });

  it('never wires a psc filter (measured 0/125,917 populated) — no query call touches psc_code', () => {
    // The route legitimately DISCUSSES psc_code in a comment (the measured-0% evidence); what
    // must never exist is a Supabase filter call applied to it (.eq/.or/.like/.ilike).
    expect(recomputeSrc).not.toMatch(/\.(eq|or|like|ilike)\([^)]*psc_code/);
    const pscParam = recomputeSrc.match(/const\s+psc\s*=\s*p\.get/);
    expect(pscParam, 'no psc query param should be read at all').toBeNull();
  });
});

describe('contacts-map route — naics (companies) + agency (buyers) filter parity', () => {
  const contactsSrc = readFileSync(
    join(__dirname, '../api/app/contacts-map/route.ts'),
    'utf8',
  );

  it('companiesPins threads naics into searchRecipients (both branches)', () => {
    const start = routeSrc.length; // no-op to keep lints quiet about unused
    expect(start).toBeGreaterThan(0);
    const matches = contactsSrc.match(/naics: params\.naics \|\| undefined/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('buyersPins filters department_ind_agency by ilike', () => {
    expect(contactsSrc).toContain("q.ilike('department_ind_agency', `%${params.agency}%`)");
  });
});
