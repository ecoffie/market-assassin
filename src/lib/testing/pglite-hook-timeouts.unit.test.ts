import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Gate determinism guard (Agent 3, 2026-11-14). Every *.pglite test boots a WebAssembly Postgres in a top-level
 * `beforeAll`. Alone it takes ~2-3 s; under machine load (load average 17-28 on 16 cores, measured during a pre-push run)
 * it exceeded vitest's 10 s default hook timeout and failed the whole pre-push unit step:
 *   FAIL src/lib/awards-ingest/merge-identity.pglite.unit.test.ts — Error: Hook timed out in 10000ms
 * The same file passed alone (13/13) and in two full `npm run test:unit` runs. The repo convention, already on 8 other
 * pglite files, is an explicit `}, 60_000);` on that hook. This test keeps every pglite file on it: a setup budget, not a
 * weaker assertion.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.pglite\.unit\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}

describe('pglite test setup hooks', () => {
  const files = walk(join(process.cwd(), 'src'));
  it('finds the pglite tests', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });
  it('every top-level beforeAll in a *.pglite test sets an explicit timeout', () => {
    const missing: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/^beforeAll\(/.test(line)) return;
        if (/\},\s*[\d_]+\);/.test(line)) return; // single-line hook with a timeout
        const close = lines.slice(i + 1).findIndex((l) => /^\}/.test(l));
        const closing = close >= 0 ? lines[i + 1 + close] : '';
        if (!/^\},\s*[\d_]+\);/.test(closing)) missing.push(`${f.replace(process.cwd() + '/', '')}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
