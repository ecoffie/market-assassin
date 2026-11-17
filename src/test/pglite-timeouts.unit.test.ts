import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

describe('PGlite suites carry an explicit hook timeout', () => {
  it('every *.pglite.unit.test.ts with a before/after hook applies PGLITE_HOOK_TIMEOUT_MS', () => {
    const files = execFileSync('git', ['ls-files', '*.pglite.unit.test.ts'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const missing = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      const hasHook = /\b(beforeAll|beforeEach|afterAll|afterEach)\(/.test(src);
      return hasHook && !/vi\.setConfig\(\{\s*hookTimeout:\s*PGLITE_HOOK_TIMEOUT_MS\s*\}\)/.test(src);
    });
    expect(missing).toEqual([]);
  });
});
