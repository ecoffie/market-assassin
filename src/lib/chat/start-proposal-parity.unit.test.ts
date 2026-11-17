/** The Map drawer's inline ES5 "Start a proposal" must match src/lib/chat/start-proposal.ts. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS_SETTLED, proposalHref } from './start-proposal';

const MAP = readFileSync(join(__dirname, '../../app/opportunity-map/route.ts'), 'utf8');
const a = MAP.indexOf('function startProposal(btn){');
const drawer = MAP.slice(MAP.lastIndexOf('var DOCS_SETTLED=', a), MAP.indexOf('window.__onSelectedOpp=function', a));

describe('start-proposal parity', () => {
  it('same settled docs states', () => {
    const m = drawer.match(/var DOCS_SETTLED=\{([^}]*)\}/)!;
    expect(m[1].split(',').map((x) => x.split(':')[0]).sort()).toEqual([...DOCS_SETTLED].sort());
  });
  it('same endpoints, source and destination', () => {
    expect(drawer).toContain("fetch('/api/pipeline',{method:'POST'");
    expect(drawer).toContain("source:'ask_mindy'");
    expect(drawer).toContain("r.status!==409");
    expect(drawer).toContain("'/api/app/proposal/pursuit-docs?email='+encodeURIComponent(em)+'&pipeline_id='+encodeURIComponent(pid)");
    expect(drawer).toContain("location.href='/app?panel=proposals&pursuit_id='+encodeURIComponent(pid)");
    expect(proposalHref('x')).toBe('/app?panel=proposals&pursuit_id=x');
  });
});
