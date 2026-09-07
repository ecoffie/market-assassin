/**
 * Worktree `next dev` 500s when Turbopack infers the parent checkout as
 * the workspace root (outermost package-lock.json) and then resolves
 * lightningcss/globals.css from the wrong node_modules.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, '../../../next.config.ts');

describe('Next.js worktree workspace root', () => {
  it('pins turbopack.root and outputFileTracingRoot to this checkout', () => {
    const src = readFileSync(CONFIG, 'utf8');
    expect(src).toContain('fileURLToPath(import.meta.url)');
    expect(src).toMatch(/outputFileTracingRoot:\s*PROJECT_ROOT/);
    expect(src).toMatch(/turbopack:\s*\{[\s\S]*root:\s*PROJECT_ROOT/);
    expect(src).not.toMatch(/root:\s*path\.join\(__dirname,\s*['"]\.\./);
  });

  it('derives PROJECT_ROOT from next.config.ts, not a parent lockfile', () => {
    const src = readFileSync(CONFIG, 'utf8');
    expect(src).toContain("path.dirname(fileURLToPath(import.meta.url))");
    expect(src).toContain('lightningcss.darwin-arm64.node');
  });
});
