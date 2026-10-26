/**
 * The /today home page embeds the map as `/opportunity-map?embed=1`. The popup CTA
 * ("Review Opportunity →") calls `window.openOppDrawer&&openOppDrawer(nid)`, but DRAWER_JS ships
 * on the non-embed branch only — so on the home page the guard was always false and the button
 * silently did nothing (Kashif, 2026-10-26). The embed now defines a fallback that leaves the
 * iframe for the full map on the RECORD link (?opp=<id>).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function shimSource(): string {
  const m = route.match(/const EMBED_CTA_JS = "<script>([\s\S]*?)<\/script>";/);
  if (!m) throw new Error('EMBED_CTA_JS not found in route.ts');
  return m[1];
}

function runShim(win: Record<string, unknown>) {
  new Function('window', shimSource())(win);
}

describe('embed popup CTA (home page map)', () => {
  it('the popup CTA still depends on window.openOppDrawer (the guard the embed must satisfy)', () => {
    expect(tmpl).toContain("onclick=\"window.openOppDrawer&&openOppDrawer('${nid}')");
  });

  it('the embed branch ships the CTA shim', () => {
    expect(route).toContain("BOOT_VIEW_JS + EMBED_JS + EMBED_CTA_JS + '</body>'");
  });

  it('the shim navigates the TOP window to the record link ?opp=<id>, with nothing else on it', () => {
    const top = { location: { href: '' } };
    const win: Record<string, unknown> = { top, location: { href: '' } };
    runShim(win);
    (win.openOppDrawer as (id: string) => void)('abc123def4567890abc123def4567890');
    expect(top.location.href).toBe('/opportunity-map?opp=abc123def4567890abc123def4567890');
  });

  it('never overrides a real drawer if one exists', () => {
    const real = () => 'real';
    const win: Record<string, unknown> = { openOppDrawer: real, top: { location: { href: '' } } };
    runShim(win);
    expect(win.openOppDrawer).toBe(real);
  });

  it('an empty id is a no-op, not a navigation to a bare ?opp=', () => {
    const top = { location: { href: '' } };
    const win: Record<string, unknown> = { top };
    runShim(win);
    (win.openOppDrawer as (id: string) => void)('');
    expect(top.location.href).toBe('');
  });
});
