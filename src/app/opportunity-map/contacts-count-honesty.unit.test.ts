/**
 * Contacts (Companies/Buyers) count honesty — the "26 results / No contacts in view" bug.
 *
 * companiesPins/buyersPins returned only `totalForFilters` = the pre-bbox MATCH count (firms
 * matching search/naics across candidate states), but the map shows only pins that SURVIVED the
 * geocode+bbox filter. When a search matches off-viewport firms, the header claimed "26 results"
 * while the map rendered zero. Fix: return `totalInView` (= pins.length) and have the client show
 * the honest in-view count (+ a "· N match — zoom out" hint) for contacts mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, '../api/app/contacts-map/route.ts'), 'utf8');
const mapSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// Brace-match a named function's FULL body so these assertions don't break every time the fn
// grows by a comment (a fixed `slice(idx, idx+N)` window is brittle — it silently truncated the
// contactCard block when the card-parity pass added ~900 chars of comments, Eric 2026-07-28).
function fnBody(src: string, name: string): string {
  const start = src.indexOf('function ' + name);
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(start, i + 1); }
  }
  return src.slice(start);
}

describe('contacts-map returns totalInView (honest map count)', () => {
  it('BOTH companiesPins and buyersPins return totalInView alongside totalForFilters', () => {
    // Two return sites — one per pins builder. Both must carry totalInView now.
    const returns = [...routeSrc.matchAll(/return \{[^}]*pins[^}]*\}/g)].map((m) => m[0]);
    const withPins = returns.filter((r) => /\bpins\b/.test(r));
    expect(withPins.length).toBeGreaterThanOrEqual(2);
    for (const r of withPins) {
      expect(r, r).toContain('totalInView');
      expect(r, r).toContain('totalForFilters');
    }
  });

  it('totalInView is pins.length (what actually rendered), never the broader match total', () => {
    expect(routeSrc).toContain('totalInView: pins.length');
  });

  it('Companies headline is the corpus, not the 6 camera-inferred states', () => {
    // Eric 2026-08-13: Player type showed 8.9K companies (sum of ≤6 viewport states)
    // against 118.4K gov buyers (the whole federal_contacts table). Open already
    // counts the filtered set ignoring bbox; Companies must too.
    const fn = routeSrc.slice(routeSrc.indexOf('async function companiesPins'), routeSrc.indexOf('async function buyersPins'));
    expect(fn).toContain('limit: 1');
    expect(fn).toContain('corpusCountP');
    expect(fn).toContain('totalForFilters: wantBuckets.size ? placed.length : (corpusTotal || pins.length)');
    expect(fn).not.toContain('total += t');
  });
});

describe('client shows the honest in-view count for contacts mode', () => {
  it('renders a "N match — zoom out" hint when 0 are in view but matches exist', () => {
    // Guards the specific "26 results / No contacts in view" contradiction from recurring.
    expect(mapSrc).toContain('isContactMode(MODE) && n===0 && TOTAL>0');
    expect(mapSrc).toContain('zoom out');
  });
});

describe('company Overview enriched to Open-drawer density (6-cell grid)', () => {
  it('companyHead grid adds "Active since" (first–last award year) and "Primary buyer" cells', () => {
    // Was a 4-cell grid (Total won / Awards / Agencies / NAICS); Open leads with a 6-cell grid, so
    // the firm grid now also carries its active span + #1 agency — all real fields, no fabrication.
    const idx = mapSrc.indexOf('function companyHead');
    expect(idx).toBeGreaterThan(-1);
    const block = mapSrc.slice(idx, idx + 2500);
    expect(block).toContain('Active since');
    expect(block).toContain('Primary buyer');
    expect(block).toContain('firstActionDate');
    expect(block).toContain('lastActionDate');
  });
});

describe('company deep-link syncs the sort scope (no stale "Deadline" label)', () => {
  it('?company= path forces company sort scope even when already in companies mode', () => {
    // setMapMode early-returns when mode already matches → __setSortScope was skipped → the header
    // showed a meaningless "Deadline (soonest)" for a firm. The deep-link now forces it.
    // Anchor on the deep-link IIFE (its match regex is unique in the file), then confirm the
    // sort-scope force sits within it.
    const idx = mapSrc.indexOf('/[?&]company=([^&]+)/');
    expect(idx, 'company deep-link IIFE must exist').toBeGreaterThan(-1);
    const block = mapSrc.slice(idx, idx + 800);
    expect(block).toContain("__setSortScope('company')");
  });
});

describe('company/buyer list cards match the Awarded card polish', () => {
  const mapSrc2 = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  it('contactCard renders the .stats facts grid + .cfoot footer + Review Opportunity (like cardHTML)', () => {
    const block = fnBody(mapSrc2, 'contactCard');
    expect(block).not.toBe('');
    expect(block).toContain("class=\"stats\"");
    expect(block).toContain("class=\"st\"");
    expect(block).toContain("class=\"cfoot\"");
    expect(block).toContain("Review Opportunity");
  });
  it('company card grid uses real fields (totalObligated / awardCount / distinctAgencyCount)', () => {
    const block = fnBody(mapSrc2, 'contactCard');
    expect(block).toContain('o.totalObligated');
    expect(block).toContain('o.awardCount');
    expect(block).toContain('o.distinctAgencyCount');
  });
  it('company chip row VARIES per firm — certs + a scale-tier pill, no repeated generic word', () => {
    // Eric 2026-07-28: "the chip should be unique, no repetitive word." The company card must NOT
    // carry a fixed label that reads the same on every row (dropped "Contractor"/"Federal awardee"/
    // "Active vendor"). It leads with the firm's real SAM certs (SB-or-not distinguisher) + a
    // right-aligned SCALE-TIER pill from real total_obligated (Top tier / Mid / Emerging, fixed $
    // bands). Both vary per firm; neither is a generic constant.
    const block = fnBody(mapSrc2, 'contactCard');
    expect(block).not.toContain('>Contractor<');           // no repeated dataset word
    expect(block).not.toContain('Active vendor');          // constant pill removed
    expect(block).toContain('setAsideChips(o.setAsides,true)'); // real certs (soft chips)
    expect(block).toContain('companyScaleTierChip(o.totalObligated)'); // varying scale tier
    // The tier VALUE helper: fixed $ bands, hidden when unknown.
    const tierVal = fnBody(mapSrc2, 'companyScaleTier');
    expect(tierVal).toContain('Top tier');
    expect(tierVal).toContain('Emerging');
    expect(tierVal).toContain('if(v<=0)return');           // 0/unknown → no tier
    // Zillow parity (Eric 2026-07-28): the CARD pill is CLEAN — no ™/brand on the number itself.
    const tierChip = fnBody(mapSrc2, 'companyScaleTierChip');
    expect(tierChip).not.toContain('dl-tm');               // no ™ badge on the card
    // The BRAND + methodology live in the DRAWER only (like Zillow's Zestimate explainer), and it
    // states plainly this is NOT an official SBA size ruling (SBA size = receipts/headcount we lack).
    const method = fnBody(mapSrc2, 'companyScaleMethodology');
    expect(method).toContain('M-Scale');
    expect(method).toContain('How we calculate');
    expect(method).toContain('NOT');
    expect(method).toMatch(/SBA/);
  });
  it('gov-buyer card leads with the person\'s REAL role (government\'s own job-title language)', () => {
    // Card-parity for the 4th dataset (Eric 2026-07-28: "what about the gov buyers card"). A buyer
    // had NO chip row — now it leads with the real contact_title (buyerRoleChip), authority roles
    // (KO/Contracting Officer) tinted red. No invented word; the role is the govt's own vocabulary.
    const block = fnBody(mapSrc2, 'contactCard');
    expect(block).toContain('buyerRoleChip(o.role)');
    const role = fnBody(mapSrc2, 'buyerRoleChip');
    expect(role).toContain("if(!t)return ''");             // no title → no chip (never a filler)
    expect(role).toContain('contracting officer');         // authority detection
    expect(role).toContain("'ko'");                        // red decision-maker tint class
  });
});
