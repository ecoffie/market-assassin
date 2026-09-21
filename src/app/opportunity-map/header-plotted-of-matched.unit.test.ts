/**
 * Header count — "N of M results" when the map plots FEWER pins than match.
 *
 * Zillow parity (Eric 2026-08-12: "zillow ... once zoom in it gives you a count 500 of 98,000").
 *
 * ⚠️ This DELIBERATELY reverses the Jul-26 "ONE number, no X of Y" decision that is still
 * described in updateHeader's own comment block. That call was made against a header showing
 * THREE numbers ("368+ of 433 in view · 10,517 total"), which invited a false compare between
 * loaded / in-view / database-total. What shipped instead — a BARE total printed while only a
 * capped subset is plotted — overstates the map: "136,885 results" beside ~1,000 drawn pins
 * reads as 136,885 pins. Zillow shows a fraction, but only the one that answers "am I seeing
 * everything?": plotted vs matched. Two numbers, never three.
 *
 * These assertions exist so the next session cannot revert to the bare total by following the
 * older comment. If the product decision genuinely changes again, change THIS test in the same
 * commit — don't delete it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmplSrc = readFileSync(join(__dirname, 'template.html'), 'utf8');

// Brace-match a named function's FULL body, so an added comment doesn't break the window the way
// a fixed slice(idx, idx+N) does (the failure mode already recorded in contacts-count-honesty).
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('map header — plotted of matched', () => {
  const header = fnBody(routeSrc, 'updateHeader');

  it('keeps the RIGHT RAIL a plain match total — the fraction is not here', () => {
    // Eric 2026-08-13, comparing both UIs side by side: Zillow's rail says "94,509 results" and
    // the FRACTION lives on the map ("500 of 94,509 homes"). A 2026-08-12 pass put the fraction
    // in this rail; wrong surface, reverted. The rail counts the LIST, the pill counts the MAP.
    expect(header).toContain("result'+(n===1?'':'s')");
    expect(header).not.toContain("' of </span>'");
    expect(header).toContain('setMapCount(shown,n,more);');
  });

  it('renders "N of M" on the MAP pill only when fewer are plotted than match', () => {
    const pill = fnBody(routeSrc, 'setMapCount');
    // The guard keeps this from becoming a permanent fraction: with everything plotted there is
    // no "of", because "8,060 of 8,060" implies a cap that isn't there. shown>0 keeps a mid-fetch
    // 0 from rendering "0 of 136,882".
    expect(pill).toContain('(more&&shown>0&&total>shown)');
    expect(pill).toContain("' of '");
    // Shares the top-left corner with #zoomHint, so it MUST hide when pins are hidden — otherwise
    // the two pills stack on top of each other at country zoom.
    expect(pill).toContain('pinTooFar(map)');
    expect(pill).toContain('if(zFar||!total){ el.hidden=true; return; }');
  });

  it('counts the MATCH total, never the pin cap', () => {
    // A capped horizon returns totalInView = 1,000 (the cap) but totalForFilters = 7,501 (real).
    // n must prefer the real total, or the denominator becomes a suspiciously round lie — the
    // "1,000 exactly looks fishy" report (Eric 2026-07-31).
    expect(header).toContain('var n=Math.max(TOTAL||0, (INVIEW && INVIEW>0)?INVIEW:shown);');
    expect(header).toContain('var more=(CAPPED || (TOTAL && TOTAL>shown));');
  });

  it('lets the live header win over the template-only count', () => {
    // Both render() (template) and updateHeader() (VIEWPORT_JS) write #rescount. The template
    // knows only rows.length, so if it ran last it would clobber the fraction with a bare count
    // — which is exactly how these two paths drifted before. render() must hand off.
    expect(tmplSrc).toContain("if(typeof updateHeader==='function'){ try{ updateHeader(); }catch(e){} }");
    // The bare-count line stays as the standalone fallback for when no data has loaded.
    expect(tmplSrc).toContain('${rows.length}</span> <span style="font-weight:400;color:var(--sub)">result');
  });

  it('keeps the contacts-mode zoom-out hint intact', () => {
    // Contacts can match firms outside the viewport → 0 in view with TOTAL > 0. That honest hint
    // predates this change and must survive it (a bare "0 results" looks broken).
    expect(header).toContain("in view · '+TOTAL.toLocaleString()+' match — zoom out</span>'");
  });
});

describe('drawer failures name the actual cause', () => {
  const err = fnBody(routeSrc, 'drawerLoadError');

  it('distinguishes auth, missing-profile, network and everything else', () => {
    // One sentence for all three used to be the whole problem: a 401 told the user the COMPANY
    // failed, and a stale client passing a name (404) looked identical to an expired session.
    expect(err).toContain('status===401||status===403');
    expect(err).toContain('Sign in');           // auth failure gets a way back in
    expect(err).toContain('status===404');
    // Asserted WITHOUT the apostrophe escape: the source carries a double-escaped \\u2019 because
    // it is emitted into a JS string, and matching that escaping is brittle for no benefit.
    expect(err).toContain('have a profile for this '); // never "this firm does not exist"
    expect(err).toContain('Network hiccup');
    expect(err).toContain("(error '+status+')"); // unknown status is surfaced, not swallowed
  });

  it('is used by BOTH drawers, and the status actually reaches it', () => {
    // r.json() alone discards the status — that is what collapsed every mode into one message.
    expect(routeSrc).toContain("drawerLoadError(res.s,'company')");
    expect(routeSrc).toContain("drawerLoadError(res.s,'buyer')");
    expect(routeSrc).toContain("drawerLoadError(0,'company')");
    expect(routeSrc).toContain("drawerLoadError(0,'buyer')");
    // A non-JSON error body must not become a throw, or a 502 would misreport as a network drop.
    expect(routeSrc).toContain('r.json().catch(function(){return null;}).then(function(d){ return {s:r.status,d:d}; })');
    // The old one-size-fits-all strings are gone from both drawers.
    expect(routeSrc).not.toContain("Couldn\\u2019t load this company.</div>'");
    expect(routeSrc).not.toContain("Couldn\\u2019t load this buyer.</div>'");
  });
});
