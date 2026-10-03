/**
 * ONE navigation intent → ONE drawer open → ONE opportunity-detail request → ONE listing_open.
 *
 * Measured on prod 2026-09-28: a typed /opportunity-map?opp=<notice_id> was owned by TWO handlers —
 * the SHARED-LINK OPEN interval (openOppDrawer(_id,true)) and an older boot IIFE
 * (openOppDrawer(nid)) — so one link opened the drawer twice, fetched opportunity-detail twice and
 * recorded two listing_open events. This test discovers EVERY ?opp= handler in the served route
 * (both shapes), runs them all against one typed link, and counts the opens that actually happen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const unescape = (s: string) => s.replace(/\\\\/g, '\\');

/** Every client handler that reads ?opp= and can open the drawer, in served order. */
function oppHandlers(): string[] {
  const out: string[] = [];
  // Shape 1: the SHARED-LINK OPEN owner (URLSearchParams, setInterval, force=true).
  const s = SRC.indexOf('SHARED-LINK OPEN (?opp=');
  if (s >= 0) {
    const a = SRC.indexOf('  (function(){', s);
    const b = SRC.indexOf('  window.openOppDrawer=function(nid,force){', a);
    out.push(SRC.slice(a, b));
  }
  // Shape 2: any boot IIFE that regex-reads ?opp= and calls openOppDrawer directly.
  const marker = "(function(){ try{ var m=(location.search||'').match(/[?&]opp=([^&]+)/);";
  for (let i = SRC.indexOf(marker); i >= 0; i = SRC.indexOf(marker, i + 1)) {
    const end = SRC.indexOf('})(); }catch(e){} })();', i);
    const body = SRC.slice(i, end + '})(); }catch(e){} })();'.length);
    if (body.includes('openOppDrawer')) out.push(body);
  }
  return out.map(unescape);
}

function runTypedLink(search: string) {
  const opens: Array<{ id: string; force: unknown }> = [];
  const detailFetches: string[] = [];
  const queue: Array<() => void> = [];
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  const win: Record<string, unknown> = {
    // The real openOppDrawer issues exactly one opportunity-detail fetch per call.
    openOppDrawer: (id: string, force: unknown) => { opens.push({ id, force }); detailFetches.push(`/api/app/opportunity-detail?id=${id}`); },
    openForecastDrawer: () => {}, openRecompeteDrawer: () => {},
  };
  const env = {
    window: win, location: { search },
    URLSearchParams,
    setTimeout: (f: () => void) => { queue.push(f); return 0; },
    setInterval: (f: () => void) => { const id = nextId++; intervals.set(id, f); return id; },
    clearInterval: (id: number) => { intervals.delete(id); },
    fetch: () => Promise.resolve({ json: () => ({}) }),
    findRecompeteRow: () => null, OPPS: [] as unknown[],
  };
  for (const h of oppHandlers()) {
    new Function(...Object.keys(env), h)(...Object.values(env));
  }
  // Drive time forward: drain timeouts and tick every live interval until quiet.
  for (let tick = 0; tick < 60 && (queue.length || intervals.size); tick++) {
    while (queue.length) queue.shift()!();
    for (const f of [...intervals.values()]) f();
  }
  return { opens, detailFetches };
}

describe('typed ?opp= — one owner', () => {
  const NID = '6b89ca47997542ed8545f90f9e103568';

  it('found the handler source (a vacuous pass would hide everything below)', () => {
    expect(oppHandlers().length).toBeGreaterThanOrEqual(1);
  });

  it('one typed link → exactly ONE drawer open and ONE opportunity-detail request', () => {
    const r = runTypedLink(`?opp=${NID}`);
    expect(r.opens).toHaveLength(1);
    expect(r.detailFetches).toHaveLength(1);
  });

  it('the surviving open is the typed-address open (force=true: map mode can never reinterpret it)', () => {
    expect(runTypedLink(`?opp=${NID}`).opens).toEqual([{ id: NID, force: true }]);
  });

  it('only ONE ?opp= handler exists in the served route', () => {
    expect(oppHandlers()).toHaveLength(1);
  });

  it('?forecast= / ?opp=fc- never open the SAM drawer', () => {
    expect(runTypedLink('?forecast=776e6fb9-f147-4c2c-9102-a6fc37ea2a31').opens).toHaveLength(0);
    expect(runTypedLink('?opp=fc-123').opens).toHaveLength(0);
  });

  it('no ?opp= → no open', () => {
    expect(runTypedLink('?recompete=CONT_AWD_X').opens).toHaveLength(0);
    expect(runTypedLink('').opens).toHaveLength(0);
  });
});
