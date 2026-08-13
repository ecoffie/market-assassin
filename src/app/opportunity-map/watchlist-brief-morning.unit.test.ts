/**
 * Watchlist "Morning Brief" redesign — grounded assertions (Eric 2026-08-05 critique).
 *
 * Two surfaces are locked here so the redesign can't silently regress:
 *   1. The ENDPOINT (api/app/watchlist-brief/route.ts) computes closingWeek + the Today's-Story
 *      strand tallies + the recent-CHANGE tallies over REAL fields (response_deadline,
 *      opportunity_dna_keys, pursuit_change_log) — never a fabricated number. We assert the
 *      grounding shape on the SHIPPED source (the query .select() + the tally arithmetic).
 *   2. The PAGE (opportunity-map/saved/route.ts) client helpers — name-cleaning, dynamic CTA,
 *      the render-when-real Today's-Story block. cleanName/naicsChip are pure, so we EXTRACT and
 *      eval them (the pursuits-derivations technique — track the shipped source, not a copy).
 *
 * Grounding rule: a 0 count HIDES its line; last_modified is NOT the amendment source (100% NULL) —
 * the pursuit_change_log diff cron is. No emoji anywhere (inline SVG only).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = readFileSync(join(process.cwd(), 'src/app/api/app/watchlist-brief/route.ts'), 'utf8');
const PAGE = readFileSync(join(process.cwd(), 'src/app/opportunity-map/saved/route.ts'), 'utf8');

// Strip // line-comments + /* block */ comments so "no leaked language" checks read the SHIPPED
// code, not the comments that deliberately NAME the excluded features (the repo-gate convention:
// a fix that QUOTES the banned pattern while explaining it must not trip the check).
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const PAGE_CODE = stripComments(PAGE);
const ENDPOINT_CODE = stripComments(ENDPOINT);

// Pull `function <name>(...) { ... }` out of the PAGE template literal, brace-matched, and un-escape
// the one template-literal level (\\ -> \). Same technique as pursuits-derivations.unit.test.ts.
function extract(name: string): string {
  const start = PAGE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const open = PAGE.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return PAGE.slice(start, i).replace(/\\\\/g, '\\');
}
function buildHelpers() {
  const names = ['cleanName', 'naicsChip'];
  const body = names.map(extract).join('\n') + `\n; return { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(body)() as Record<string, (...a: unknown[]) => unknown>;
}
const H = buildHelpers();

describe('ENDPOINT — closingWeek + story strands + changes are grounded from real fields', () => {
  it('selects the real columns needed for the strands (opportunity_dna_keys, notice_type)', () => {
    expect(ENDPOINT).toMatch(/\.select\('notice_id, response_deadline, intel_value_range, department, sub_tier, opportunity_dna_keys, notice_type'\)/);
  });

  it('closingWeek counts deadlines within the next 7 days (today..today+7 inclusive), grounded on response_deadline', () => {
    expect(ENDPOINT).toContain('weekEnd.setDate(weekEnd.getDate() + 7)');
    // the inclusive Y-M-D window test on the real deadline
    expect(ENDPOINT).toMatch(/if \(dy >= today && dy <= weekEndYmd\) closingWeek\+\+/);
    expect(ENDPOINT).toContain('totals.closingWeek += closingWeek');
  });

  it('story strand counts are tallied from opportunity_dna_keys; early_stage absorbs sources_sought OR early_cycle', () => {
    expect(ENDPOINT).toContain("if (keys.includes('repeat_buyer')) story.repeat_buyer++");
    expect(ENDPOINT).toContain("if (keys.includes('sb_friendly')) story.sb_friendly++");
    expect(ENDPOINT).toContain("if (keys.includes('sources_sought') || keys.includes('early_cycle')) story.early_stage++");
    expect(ENDPOINT).toContain("if (keys.includes('closes_soon')) story.closes_soon++");
    // a null/absent opportunity_dna_keys is treated as empty (skipped), never a phantom count
    expect(ENDPOINT).toContain('Array.isArray(row.opportunity_dna_keys) ? row.opportunity_dna_keys : []');
  });

  it('newCount is unique notice_ids via the shared helper (not a 300−200 cap remainder)', () => {
    expect(ENDPOINT).toContain('unseenUniqueNoticeIds');
    expect(ENDPOINT).toContain('SAVED_SEARCH_MATCH_CAP');
    expect(ENDPOINT).toContain('kpiFresh.add(id)');
    expect(ENDPOINT).toContain('totals.newListings = kpiFresh.size');
    expect(ENDPOINT).not.toContain('totals.newListings += newCount');
    expect(ENDPOINT).not.toMatch(/if \(seen\.size && nid && !seen\.has\(nid\)\) newCount\+\+/);
  });

  it('the amendment/change line is grounded in pursuit_change_log, NOT last_modified', () => {
    expect(ENDPOINT).toContain("from('pursuit_change_log')");
    // scoped to THIS user + last 7 days + unacknowledged + the search's matched notices
    expect(ENDPOINT).toContain(".eq('user_email', email)");
    expect(ENDPOINT).toContain(".eq('acknowledged', false)");
    expect(ENDPOINT).toContain(".in('notice_id', matchedNoticeIds)");
    // 'closed' is EXCLUDED from the change types (not an amendment/change to act on)
    expect(ENDPOINT).not.toMatch(/CHANGE_TYPES = \[[^\]]*'closed'/);
    // last_modified must NOT be used to build an amendment count (it is 100% NULL on active opps).
    // It appears only in explanatory comments; the SHIPPED code never references it.
    expect(ENDPOINT_CODE).not.toContain('last_modified');
  });
});

describe('PAGE — name-cleaning strips a trailing "Search" but NOT "Open"/other words', () => {
  it('strips a trailing standalone "Search"', () => {
    expect(H.cleanName('Cybersecurity Search', { naics: ['541512'] })).toBe('Cybersecurity');
    expect(H.cleanName('Janitorial services Search', {})).toBe('Janitorial services');
  });
  it('leaves generic names UNCHANGED (never strips "Open")', () => {
    expect(H.cleanName('My opportunities — Open', {})).toBe('My opportunities — Open');
    expect(H.cleanName('DoD IT Services', {})).toBe('DoD IT Services');
    // "Search" only when it is the trailing standalone word — not mid-name
    expect(H.cleanName('Search and rescue', {})).toBe('Search and rescue');
  });
  it('a blank OR codes-only name falls back to the NAICS chip (never a raw code string)', () => {
    expect(H.cleanName('', { naics: ['541512'] })).toBe('NAICS 541512');
    expect(H.cleanName('   ', { naics: ['236220'] })).toBe('NAICS 236220');
    // ≤3 codes → the labeled NAICS chip (joined, still "NAICS …" not a bare code string)
    expect(H.cleanName('541512, 541611', { naics: ['541512', '541611'] })).toBe('NAICS 541512, 541611');
    // >3 codes sharing a 3-digit family → the collapsed "NAICS 541***" shape
    expect(H.cleanName('541512 541611 541330 541990', { naics: ['541512', '541611', '541330', '541990'] })).toBe('NAICS 541***');
    // no naics to fall back to → a safe label, never blank
    expect(H.cleanName('', { naics: [] })).toBe('Saved search');
  });
});

describe('PAGE — dynamic CTA wording + render-when-real story + no emoji', () => {
  it('CTA says "Explore N New Opportunit(y/ies)" when newCount>0, else "Open Today\'s Lens"', () => {
    expect(PAGE).toContain("'Explore '+nc+' New Opportunit'+(nc===1?'y':'ies')");
    expect(PAGE).not.toContain("nc>99?'99+'");
    expect(PAGE).toContain(">'+nc+' new</span>");
    // steady-state fallback text — "Open Today's Lens" (renamed from "...Map" in the 2026-08-05
    // terminology pass to match the map pill; source escapes the apostrophe one template level: \\u2019)
    expect(PAGE).toContain("'Open Today\\\\u2019s Lens'");
    // the CTA is chosen by newCount, and both branches keep the SAME map deep-link href
    expect(PAGE).toContain('var ctaTxt=(nc>0)?(');
    expect(PAGE).toContain("href=\"'+h(href)+'\">'+ctaTxt");
  });

  it('the Today\'s-story block renders ONLY strand lines with count>0 and omits the block when all zero', () => {
    expect(PAGE).toContain('if(st&&st.repeat_buyer>0)');
    expect(PAGE).toContain('if(st&&st.sb_friendly>0)');
    expect(PAGE).toContain('if(st&&st.early_stage>0)');
    expect(PAGE).toContain('if(st&&st.closes_soon>0)');
    expect(PAGE).toContain("if(!lines.length)return '';"); // whole block omitted when nothing grounded
  });

  it('the change line is render-when-real (changeCount>0) and never a fabricated zero', () => {
    expect(PAGE).toContain('if(!ch||!ch.changeCount)return null;');
  });

  it('KPI card 3 is "Closing this week" from totals.closingWeek (not closingToday)', () => {
    expect(PAGE).toContain('Closing this week');
    expect(PAGE).toContain('(totals.closingWeek||0)');
    expect(PAGE).not.toContain('Closing today');
  });

  it('the sort dropdown offers exactly Most new / Most urgent / Biggest market (no M-Win, no Recently viewed)', () => {
    expect(PAGE).toContain('>Most new</option>');
    expect(PAGE).toContain('>Most urgent</option>');
    expect(PAGE).toContain('>Biggest market</option>');
    // no dropped/deferred sort options survive in the SHIPPED code (comments may name them)
    expect(PAGE_CODE).not.toMatch(/M-Win|Recently viewed|Highest value|>A\\\\u2013Z</);
  });

  it('no memory-dependent language leaked in (since yesterday / last viewed / unread / sparkline)', () => {
    // checked against code with comments stripped — the DEFER note deliberately NAMES these.
    expect(PAGE_CODE).not.toMatch(/since yesterday|last viewed|unread|sparkline|% up|up from/i);
  });

  it('the sun is an inline SVG and there are no emoji in the page', () => {
    // the hero sun is an <svg>, not an emoji
    expect(PAGE).toMatch(/class="sun"[\s\S]{0,120}<svg/);
    // no emoji codepoints anywhere in either file
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{26A0}]/u;
    expect(emoji.test(PAGE)).toBe(false);
    expect(emoji.test(ENDPOINT)).toBe(false);
  });
});
