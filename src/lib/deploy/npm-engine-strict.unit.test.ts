/**
 * A wrong-Node install must fail on the wrong Node, not on the lockfile.
 *
 * Measured 2026-09-21 against an UNMODIFIED lockfile:
 *   node 24.13.0 / npm 11.6.2 -> `npm ci` exit 0
 *   node 22.14.0 / npm 10.9.2 -> EUSAGE "Missing: proxy-agent@8.0.2 from lock file"
 *
 * The lockfile was correct both times — npm 10 resolves puppeteer's
 * `@puppeteer/browsers` peer range differently and demands a nested proxy-agent the
 * npm 11 lockfile has no reason to contain. A toolchain mismatch reported as lockfile
 * corruption nearly got "fixed" with a needless 97-line lockfile rewrite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = process.cwd();

describe('npm toolchain is pinned and enforced, not merely suggested', () => {
  it('declares the Node version CI and Vercel actually build on', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    expect(pkg.engines?.node).toBe('24.x');
  });

  it('enables engine-strict so the wrong Node fails up front', () => {
    // Without this npm only WARNS, then fails later pointing at the wrong thing.
    const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^\s*engine-strict\s*=\s*true\s*$/m);
  });
});
