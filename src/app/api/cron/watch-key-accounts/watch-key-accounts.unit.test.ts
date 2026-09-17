import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'route.ts'),
  'utf8',
);

describe('watch-key-accounts — three briefing-drift findings, not one blob', () => {
  it('emits access mismatch, unexpected disable, and intentional pause as separate findings', () => {
    expect(src).toContain("label: 'briefings access mismatch'");
    expect(src).toContain("label: 'briefings delivery unexpectedly disabled'");
    expect(src).toContain("label: 'briefings customer intentionally paused'");
    expect(src).toContain("label: 'briefings intentionally excluded'");
  });

  it('does not lump them under the old entitled-but-undelivered instruction', () => {
    expect(src).not.toContain("label: 'briefings entitled-but-undelivered'");
  });

  it('refuses to re-enable a pause or an excluded classification', () => {
    expect(src).toContain('Preserve this; an entitlement must not override an opt-out');
    expect(src).toContain("do not grant classification or flip delivery");
  });
});
