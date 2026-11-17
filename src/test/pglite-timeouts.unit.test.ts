import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

describe('PGlite suites get the longer hook timeout from config (not per file)', () => {
  it('vitest.config.ts loads the PGlite timeout setup file', () => {
    expect(readFileSync('vitest.config.ts', 'utf8')).toContain("'./src/test/pglite-timeouts.setup.ts'");
  });
  it('the setup applies PGLITE_HOOK_TIMEOUT_MS, scoped by file name, and matches every PGlite suite', () => {
    const setup = readFileSync('src/test/pglite-timeouts.setup.ts', 'utf8');
    expect(setup).toMatch(/vi\.setConfig\(\{\s*hookTimeout:\s*PGLITE_HOOK_TIMEOUT_MS\s*\}\)/);
    const files = execFileSync('git', ['ls-files', '*.pglite.unit.test.ts'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !/\.pglite\./.test(f))).toEqual([]);
  });
  it('this file is NOT a PGlite suite, so it keeps the default hook budget (the override is scoped)', () => {
    expect(/\.pglite\./.test(String(expect.getState().testPath))).toBe(false);
  });
});
