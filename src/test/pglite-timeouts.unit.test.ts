import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/**
 * RUNTIME proof (not a source check): two identical fixtures whose beforeAll takes 10.5s — longer than
 * vitest's 10s default hookTimeout — run under the REAL setup file. Only the *.pglite.* one may pass.
 * Spawned asynchronously (a spawnSync would block this worker; see the pre-push determinism notes).
 */
describe('PGlite hook timeout — runtime proof', () => {
  it('a >10s beforeAll passes in a *.pglite.* file and times out in a plain file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pglite-timeout-proof-'));
    const out = join(dir, 'result.json');
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
          '--config', 'src/test/fixtures/pglite-timeout/vitest.fixture.config.ts',
          '--reporter=json', `--outputFile=${out}`], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, CI: '1' } });
        child.on('error', reject);
        child.on('exit', resolve);
      });
      expect(code).not.toBe(0); // the plain fixture must fail
      const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: Array<{ name: string; status: string; message?: string }> };
      const byFile = (needle: string) => report.testResults.find((r) => r.name.includes(needle));
      expect(byFile('slow.pglite.fixture.ts')?.status).toBe('passed');
      const plain = byFile('slow.plain.fixture.ts');
      expect(plain?.status).toBe('failed');
      expect(String(plain?.message ?? '')).toMatch(/Hook timed out in 10000ms/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
