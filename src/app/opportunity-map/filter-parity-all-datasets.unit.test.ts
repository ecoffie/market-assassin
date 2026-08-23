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

  // NOTE (2026-07-27): the top-bar Notice-type (fltNotice) AND Set-aside (saselBtn) selects were both
  // REMOVED — those filter only via the Filters panel now. The top bar is: Active · Value · Agency ·
  // Industry · Filters. Value pill (valBtn) hides where there's no $ axis (Companies/Buyers). Industry
  // (naicsBtn) hides on Buyers (no NAICS on a contact). Agency pill (agencyBtn) hides on Companies
  // (searchRecipients/BigQuery has no agency filter; it fires on open/awarded/buyers).
  it('open: nothing disabled — Value/Agency/Industry all fire on the open-opp endpoint', () => {
    expect(disabledIdsFor('open')).toEqual([]);
  });

  it('recompete (Awarded): nothing disabled — Value + Agency + Industry live', () => {
    const d = disabledIdsFor('recompete');
    expect(d).not.toContain('valBtn');
    expect(d).not.toContain('naicsBtn');
    expect(d).not.toContain('agencyBtn');
  });

  it('companies: Value hidden (no ask-price axis); Industry + Agency stay live (sells-to-agency, 2026-08-03)', () => {
    const d = disabledIdsFor('companies');
    expect(d).toContain('valBtn');
    expect(d).not.toContain('agencyBtn'); // companies CAN filter by agency (searchRecipients awards scan)
    expect(d).not.toContain('naicsBtn');
  });

  it('buyers: Value + Industry hidden; Agency STAYS (department_ind_agency ilike)', () => {
    const d = disabledIdsFor('buyers');
    expect(d).toEqual(expect.arrayContaining(['valBtn', 'naicsBtn']));
    expect(d).not.toContain('agencyBtn'); // buyers CAN filter by agency
  });

  it('the removed top-bar selects (fltNotice, saselBtn) never appear in the disable matrix', () => {
    for (const m of ['open', 'recompete', 'companies', 'buyers']) {
      expect(disabledIdsFor(m)).not.toContain('fltNotice');
      expect(disabledIdsFor(m)).not.toContain('saselBtn');
    }
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

  it('Agency fires on open/recompete/buyers/companies (2026-08-03: searchRecipients scans awards by agency)', () => {
    const cls = fieldClasses('mfAgency');
    expect(cls).toContain('mfv-open');
    expect(cls).toContain('mfv-recompete');
    expect(cls).toContain('mfv-buyers');
    expect(cls).toContain('mfv-companies');
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

  it('Country/Posted fire ONLY on open (opp-shaped fields, no equivalent elsewhere)', () => {
    for (const id of ['mfCountry', 'mfPosted']) {
      const cls = fieldClasses(id);
      expect(cls, id).toContain('mfv-open');
      expect(cls, id).not.toContain('mfv-recompete');
      expect(cls, id).not.toContain('mfv-companies');
      expect(cls, id).not.toContain('mfv-buyers');
    }
  });

  it('HasDocs/HasContact Refine rows are open-only (redesign PR3 — now segmented controls, not labels)', () => {
    // The docs/contact controls became Zillow segmented controls (Any | Only these). The hidden
    // checkbox is the state; the VISIBLE .mf-trirow carries the mfv-open visibility class. Assert the
    // open-only intent survives the restructure (the whole Refine block is open-shaped).
    const trirows = routeSrc.match(/<div class="mf-trirow[^"]*"/g) || [];
    expect(trirows.length, 'two Refine segmented rows').toBeGreaterThanOrEqual(2);
    for (const t of trirows) expect(t).toContain('mfv-open');
    // The hidden checkboxes still exist (the wiring the filter JS reads).
    expect(routeSrc).toContain('id="mfHasDocs"');
    expect(routeSrc).toContain('id="mfHasContact"');
    // and the segmented control offers exactly the two REAL states (no dead "Hide" — endpoint has no
    // exclude). Scope the "no Hide" check to the segmented buttons themselves, not the whole file.
    expect(routeSrc).toContain('data-seg="mfHasDocs"');
    expect(routeSrc).toContain('>Only these<');
    const segButtons = (routeSrc.match(/<button type="button" class="mf-segb[^>]*>[^<]*<\/button>/g) || []).join(' ');
    expect(segButtons).toContain('>Any<');
    expect(segButtons).toContain('>Only these<');
    expect(segButtons).not.toContain('>Hide<'); // no dead exclude state on the segmented control
  });

  it('Recompete signals (buying-style / likelihood / expiring-within) are recompete-only', () => {
    // The three Awarded-only filters (contract_type SAP-friendly, recompete_likelihood, lead_time)
    // sit in a .mfv-recompete section. Their <label> fields carry the tag; assert none leak to open.
    for (const id of ['mfSap', 'mfLikelihood', 'mfLead']) {
      const cls = fieldClasses(id);
      expect(cls, id).toContain('mfv-recompete');
      expect(cls, id).not.toContain('mfv-open');
      expect(cls, id).not.toContain('mfv-companies');
      expect(cls, id).not.toContain('mfv-buyers');
    }
  });

  it('SAP-friendly BUYER (mfSapBuyer) is OPEN-only — open opps have no contract_type (redesign PR3: pills)', () => {
    // Became a Zillow single-select PILL group (redesign PR3). The hidden #mfSapBuyer select is the
    // state; the visible .mf-pillsel carries the mfv-open visibility class. Assert open-only survives.
    const m = routeSrc.match(/<div class="mf-pillsel[^"]*" data-mfsec="buyerstyle" data-sel="mfSapBuyer">/);
    expect(m, 'mfSapBuyer pill group must exist').toBeTruthy();
    expect(m![0]).toContain('mfv-open');
    expect(m![0]).not.toContain('mfv-recompete');
    expect(m![0]).not.toContain('mfv-companies');
    expect(m![0]).not.toContain('mfv-buyers');
  });

  it('SAP-friendly BUYER offers the three honest tiers (most/somewhat/vehicle) as pills, not a toggle', () => {
    // The pill group + the hidden select mirror MUST both carry the three tiers.
    const grp = routeSrc.match(/data-sel="mfSapBuyer">([\s\S]*?)<\/div>/);
    expect(grp, 'mfSapBuyer pill group body').toBeTruthy();
    expect(grp![1]).toContain('data-v="most"');
    expect(grp![1]).toContain('data-v="somewhat"');
    expect(grp![1]).toContain('data-v="vehicle"');
    const sel = routeSrc.match(/id="mfSapBuyer"[^>]*>([\s\S]*?)<\/select>/);
    expect(sel, 'hidden mfSapBuyer select mirror').toBeTruthy();
    expect(sel![1]).toContain('value="most"');
    expect(sel![1]).toContain('value="somewhat"');
    expect(sel![1]).toContain('value="vehicle"');
  });

  it('recompete signals offer NO dead options — no "low" likelihood (0 rows fleet-wide)', () => {
    // recompete_likelihood measured high 51,591 / medium 92,011 / low 0 (2026-07-27). A "low"
    // option would be a dead control; the select must offer only "high".
    const m = routeSrc.match(/id="mfLikelihood">([\s\S]*?)<\/select>/);
    expect(m, 'mfLikelihood select must exist').toBeTruthy();
    expect(m![1]).toContain('value="high"');
    expect(m![1]).not.toContain('value="low"');
    expect(m![1]).not.toContain('value="medium"');
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
    // 2026-07-31: the per-mode fetchView param blocks moved into _buildOppUrl(m) (the Opportunities
    // map now MERGES horizons, so the URL builder is parameterized on `m`, not the global MODE).
    // Anchor on the recompete param block inside it.
    // Anchored on the block opener only. 2026-08-23: FILT.naics was added ABOVE FILT.state
    // (the header summed recompete's whole unfiltered corpus -- 114,354 shown vs 86 true),
    // and an anchor that pinned the FIRST line broke on a correct change.
    const anchor = "if(m==='recompete'){";
    const start = routeSrc.indexOf(anchor);
    expect(start, 'expected the _buildOppUrl recompete param block').toBeGreaterThan(-1);
    const end = routeSrc.indexOf('}', start);
    // Strip comments: the block now DOCUMENTS why psc is excluded, and a naive matcher would
    // fail on that explanation.
    const block = routeSrc.slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(block).toContain("FILT.state");
    expect(block).toContain("FILT.subAgency");
    // NAICS must be sent: without it the Awarded horizon returned its entire corpus while
    // the header summed every horizon's total.
    expect(block).toContain("FILT.naics");
    // PSC must NOT be: recompete_opportunities.psc_code is 5.7% populated (9,108/159,647),
    // so filtering on it would silently drop 94% of matching rows. A dead filter is worse
    // than no filter.
    expect(block).not.toContain('psc');
  });

  it('open branch sends sapBuyer (Open-only SAP-friendly-buyer tier)', () => {
    const anchor = "if(m==='open'){";
    const start = routeSrc.indexOf(anchor);
    expect(start, 'expected the _buildOppUrl open param block').toBeGreaterThan(-1);
    const end = routeSrc.indexOf("    if(m===", start + anchor.length);
    const block = routeSrc.slice(start, end);
    expect(block).toContain('FILT.sapBuyer');
    expect(block).toContain('sapBuyer=');
  });

  it('the contacts-map branch (Companies/Buyers) sends naics only for companies, agency for BOTH (2026-08-03)', () => {
    // 2026-07-31: Players (Companies + Gov Buyers) now MERGE on one map — the per-type filters moved
    // into _buildContactUrl(t), keyed on the fetched type `t`, not the global MODE.
    // 2026-08-03: agency is no longer buyers-only — companies-by-agency shipped, so the SAME FILT.agency
    // value goes out for both companies and buyers requests.
    const start = routeSrc.indexOf('function _buildContactUrl(t){');
    expect(start).toBeGreaterThan(-1);
    const end = routeSrc.indexOf('}', routeSrc.indexOf('return', start));
    const block = routeSrc.slice(start, end);
    expect(block).toContain("_naics=(t==='companies')");
    expect(block).toContain('_agency=FILT.agency');
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

  it('wires the SAP-friendly / likelihood / lead-time filters on real columns (2026-07-27)', () => {
    // contract_type: friendly = PO+BPA CALL (SB-winnable), gated = DELIVERY ORDER.
    expect(recomputeSrc).toContain("contract_type', ['PURCHASE ORDER', 'BPA CALL']");
    expect(recomputeSrc).toContain("contract_type', 'DELIVERY ORDER'");
    // recompete_likelihood: only 'high' is a real narrowing value.
    expect(recomputeSrc).toContain("recompete_likelihood', 'high'");
    // lead-time / expiring-within window. FM-U06 (2026-07-29): the stored lead_time_months is STALE
    // (often 0), so the filter now uses the LIVE relationship — PoP-end <= today + N months — matching
    // the shared queryExpiringContracts instead of the raw column.
    expect(recomputeSrc).toContain("period_of_performance_current_end', bound");
    expect(recomputeSrc).not.toContain("lead_time_months', leadMax"); // the stale-column filter is gone
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

  it('buyersPins filters department_ind_agency via the multi-agency OR (multiAgency + agencyOrExpr)', () => {
    // Agency is now a MULTI-select: pipe-joined needles OR'd across both word orders (agencyOrExpr),
    // not a single ilike. The filter must still target department_ind_agency, and still be gated so an
    // empty (all-checked) selection applies no narrowing.
    expect(contactsSrc).toContain("agencyOrExpr('department_ind_agency', multiAgency(params.agency");
    expect(contactsSrc).toMatch(/if\s*\(agencyExpr\)\s*q = q\.or\(agencyExpr\)/);
  });
});

/**
 * Regression (2026-07-27): the deep Filters panel rendered bare section HEADINGS —
 * "Codes", "Buyer", "Location" — with NO inputs under them. NAICS, PSC, Agency, State and
 * the Only-show checkboxes were all in the markup but invisible.
 *
 * Cause: syncFilterVis() hid every [data-mfsec] element whose OWN classList lacked
 * `mfv-<mode>`. Section HEADINGS carry those tags, but the CONTAINERS (mf-grid2 /
 * mf-checks) do not — their mode tags live on the child <label> fields. So the container
 * was display:none while its heading stayed visible. 5 of 8 containers were affected.
 *
 * The fix: a container counts as visible when it OR any descendant carries the mode class.
 * These tests pin BOTH halves — the markup shape (containers may be untagged) and the
 * logic (it must look at descendants) — so the panel can't silently empty out again.
 */
describe('deep filter panel — containers must not hide their own fields', () => {
  // NOTE: 'syncFilterVis' first appears in a COMMENT above the markup, so slicing to its
  // first index yields a negative range. Anchor on the panel open → the function DEFINITION.
  const panelStart = routeSrc.indexOf('id="morePanel"');
  const panelEnd = routeSrc.indexOf('function syncFilterVis(');
  const panel = routeSrc.slice(panelStart, panelEnd > panelStart ? panelEnd : routeSrc.length);

  it('the show/hide decision itself consults DESCENDANTS, not just the element', () => {
    // Pin the EXACT decision line, not the whole function: the section-collapse block
    // below it also calls querySelector('.'+cls), so a function-wide match still passed
    // with the real bug reintroduced (verified — the assertion has to be this specific).
    const fn = extractFn('syncFilterVis');
    const showLine = fn.split('\n').find((l) => /var\s+show\s*=/.test(l)) || '';
    expect(showLine, 'syncFilterVis must compute `show`').toBeTruthy();
    expect(showLine).toMatch(/querySelector\(\s*['"]\.['"]\s*\+\s*cls\s*\)/);
  });

  it('every section that has a heading also has a reachable container', () => {
    // Headings and containers share a data-mfsec key; a heading with a permanently hidden
    // container is the exact bug (visible label, no fields).
    const keys = [...panel.matchAll(/data-mfsec="(\w+)"/g)].map((m) => m[1]);
    for (const k of ['codes', 'buyer', 'location', 'onlyshow']) {
      expect(keys.filter((x) => x === k).length, `section ${k} needs heading + container`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('the NAICS and PSC inputs exist in the Codes section', () => {
    // Eric's report named these two specifically.
    expect(panel).toMatch(/id="mfNaics"/);
    expect(panel).toMatch(/id="mfPsc"/);
  });

  it('simulates open mode: untagged containers still resolve visible', () => {
    // Mirror the real logic against the real markup rather than trusting a regex.
    const containers = [...panel.matchAll(/<div class="(mf-grid2|mf-checks)([^"]*)" data-mfsec="(\w+)"/g)]
      .map((m) => ({ cls: (m[1] + m[2]).trim(), key: m[3] }));
    expect(containers.length).toBeGreaterThan(4);

    // Fields tagged mfv-open exist for each of these sections, so under the FIXED logic
    // (self OR descendant) each container must resolve visible in open mode.
    for (const key of ['codes', 'buyer', 'location', 'onlyshow']) {
      const c = containers.find((x) => x.key === key);
      expect(c, `container for ${key}`).toBeTruthy();
      const selfTagged = /\bmfv-open\b/.test(c!.cls);
      // Grab this container's markup slice and look for a child tagged mfv-open.
      const at = panel.indexOf(`data-mfsec="${key}"`, panel.indexOf('<div class="' + c!.cls));
      const slice = panel.slice(at, at + 1200);
      const childTagged = /mfv-open/.test(slice);
      expect(selfTagged || childTagged, `${key} must be visible in open mode`).toBe(true);
    }
  });
});
