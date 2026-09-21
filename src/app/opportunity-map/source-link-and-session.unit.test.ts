/**
 * Two readability fixes from Eric's screenshots, 2026-08-13.
 *
 * 1. The forecast drawer's "Source:" link opened a RAW JSON API endpoint for DHS and HHS rows —
 *    an unstyled wall of JSON ("the source page is illegible not readable"). source_url is the
 *    honest provenance record, so it stays as stored; the LINK now points at the agency's human
 *    portal and names it.
 * 2. "Sign in for your recommendation" was shown to a user who believed they were signed in. A
 *    missing token and an EXPIRED one are different situations and now say different things.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function fnBody(s: string, name: string): string {
  const start = s.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = s.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// Run the shipped helper for real rather than asserting on its source text — a mapping table is
// exactly the kind of thing that can look right and behave wrong.
function loadForecastSource(): (u: string) => { href: string; label: string } | null {
  const body = fnBody(src, 'forecastSource');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return forecastSource;`)() as (u: string) => { href: string; label: string } | null;
}

describe('forecast "Source:" link is readable', () => {
  const forecastSource = loadForecastSource();

  it('sends API endpoints to the agency portal, not the JSON', () => {
    // These two are the ones that actually shipped a JSON dump to users. Verified live:
    // apfs-cloud.dhs.gov/api/forecast/ is application/json; the portal root is text/html.
    const dhs = forecastSource('https://apfs-cloud.dhs.gov/api/forecast/')!;
    expect(dhs.href).toBe('https://apfs-cloud.dhs.gov/');
    expect(dhs.href).not.toContain('/api/');
    expect(dhs.label).toContain('DHS');

    const hhs = forecastSource('https://osdbu.hhs.gov/api/sbcxopportunities/?filter=')!;
    expect(hhs.href).toBe('https://osdbu.hhs.gov/');
    expect(hhs.label).toContain('HHS');
  });

  it('leaves a human page exactly as recorded', () => {
    // Only an API URL is rewritten; provenance for a real page must survive untouched.
    const gsa = forecastSource('https://www.acquisitiongateway.gov/forecast')!;
    expect(gsa.href).toBe('https://www.acquisitiongateway.gov/forecast');
    expect(gsa.label).toContain('GSA');
  });

  it('warns when the link downloads a file instead of opening', () => {
    const navy = forecastSource('https://www.secnav.navy.mil/smallbusiness/Documents/Combined%20LRAE_02.2026.xlsx')!;
    expect(navy.href).toContain('.xlsx');
    expect(navy.label).toContain('(XLSX)');
  });

  it('degrades to the hostname for a source we do not know, and to null for none', () => {
    const unknown = forecastSource('https://forecast.example.gov/some/page')!;
    expect(unknown.href).toBe('https://forecast.example.gov/some/page');
    expect(unknown.label).toBe('forecast.example.gov');
    expect(forecastSource('')).toBeNull();
  });
});

describe('an expired session says so', () => {
  const expired = (() => {
    // tokenExpired moved from a DRAWER_JS local to `window.__tokenExpired`, defined in
    // VIEWPORT_JS: _track() (a different <script> IIFE) needed the same answer, and a local
    // cannot cross that boundary. One implementation, two callers, so "expired" cannot drift.
    const start = src.indexOf('window.__tokenExpired = function(tk){');
    if (start < 0) throw new Error('window.__tokenExpired not found');
    const open = src.indexOf('{', src.indexOf('function(', start));
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const body = src.slice(src.indexOf('function(', start), end);
    // eslint-disable-next-line no-new-func
    return new Function(`return (${body});`)() as (t: string) => boolean;
  })();
  const mk = (exp: number) => Buffer.from(JSON.stringify({ email: 'e@x.com', exp })).toString('base64url') + '.sig';

  it('detects a lapsed token and never accuses a valid one', () => {
    expect(expired(mk(Date.now() - 60_000))).toBe(true);
    expect(expired(mk(Date.now() + 60_000))).toBe(false);
  });

  it('fails CLOSED — undecodable input is never called expired', () => {
    // The server stays the authority; this only picks better words. A parsing quirk must not tell
    // a signed-in user they are logged out.
    for (const bad of ['', 'garbage', 'not.base64', '!!!']) expect(expired(bad)).toBe(false);
  });

  it('renders a distinct CTA for expired vs signed-out vs no-profile', () => {
    const pursue = fnBody(src, 'fillPursue');
    expect(pursue).toContain("res.reason==='session_expired'");
    expect(pursue).toContain('Your session expired');
    expect(pursue).toContain('Sign in for your recommendation');
    expect(pursue).toContain('Complete your profile for your recommendation');
    // ...and loadMWin must actually REACH it. Asserting the string exists is not enough: stubbing
    // the guard to if(false) leaves the string in place and the branch dead, which an earlier
    // version of this test happily passed. Assert the live guard inside loadMWin's own body.
    const mwin = fnBody(src, 'loadMWin');
    expect(mwin).toContain('if(tokenExpired(tk)){');
    expect(mwin).toContain("reason:'session_expired'");
  });
});
