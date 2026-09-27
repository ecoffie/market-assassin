/**
 * STATIC GUARD: no signed-in producer may send engagement telemetry with sendBeacon.
 *
 * /api/app/engagement (and its /api/mindy/engagement alias) require the MI session token
 * in a HEADER for a real email (#1232). navigator.sendBeacon cannot set headers, and it
 * returns true once the request is merely queued — so a beacon producer fails silently
 * and forever. That is exactly what took pipeline / forecasts / settings / market_research
 * / onboarding / signed-in map-card telemetry to 0 from 2026-08-21 to 2026-09-26.
 *
 * The ONE permitted beacon is the Map card tracker's ANONYMOUS branch (anon:<uuid> needs
 * no header), and it must sit AFTER the signed-in early return.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|html)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

// Strip comments so prose that QUOTES the bad pattern never trips the guard.
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

describe('engagement telemetry transport', () => {
  it('no source file beacons to an engagement endpoint except the anonymous map-card branch', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = code(readFileSync(file, 'utf8'));
      const re = /sendBeacon\(\s*['"`]([^'"`]+)['"`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!/engagement/.test(m[1])) continue;
        const rel = file.slice(process.cwd().length + 1);
        if (rel === 'src/app/opportunity-map/route.ts') continue; // asserted separately below
        offenders.push(`${rel}: sendBeacon('${m[1]}')`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the map card tracker beacons ONLY for anonymous events, after the signed-in fetch returns', () => {
    const map = readFileSync(join(ROOT, 'app/opportunity-map/route.ts'), 'utf8');
    const start = map.indexOf('window.__trackCard=function');
    expect(start).toBeGreaterThan(-1);
    const body = map.slice(start, map.indexOf('\n  };', start));
    const signedIn = body.indexOf('if(!_anonC){');
    const authedFetch = body.indexOf("'x-mi-auth-token':tk", signedIn);
    const beacon = body.indexOf('sendBeacon');
    expect(signedIn).toBeGreaterThan(-1);
    expect(authedFetch).toBeGreaterThan(signedIn);
    expect(beacon).toBeGreaterThan(authedFetch);
    // The dead "x-user-email" header path (never authenticates) is gone.
    expect(body).not.toContain("'x-user-email'");
  });

  it('every /app panel tracker goes through the authenticated transport', () => {
    const track = code(readFileSync(join(ROOT, 'components/app/track.ts'), 'utf8'));
    expect(track).not.toMatch(/sendBeacon/);
    expect(track).toMatch(/keepalive:\s*true/);
    for (const page of ['app/app/page.tsx', 'app/briefings/page.tsx']) {
      const src = code(readFileSync(join(ROOT, page), 'utf8'));
      expect(src, page).toContain('sendAppEngagement(');
      expect(src, page).not.toMatch(/sendBeacon\(/);
    }
  });
});
