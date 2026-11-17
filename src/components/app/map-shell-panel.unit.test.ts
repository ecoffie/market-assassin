/** The map inside the app (Option A, 2026-11-16): panel registry + sidebar placement. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupForPanel } from './nav-groups';

const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8');
const sidebar = read('UnifiedSidebar.tsx');
const panels = read('panels', 'index.tsx');
const shellPanel = read('panels', 'MapShellPanel.tsx');
const appPage = read('..', '..', 'app', 'app', 'page.tsx');
const knownPanels = read('..', '..', 'lib', 'app', 'known-panels.ts');

describe('map shell panels', () => {
  it('map / watchlist / saved are deep-linkable panels rendered by MapShellPanel', () => {
    const known = knownPanels.slice(knownPanels.indexOf('const KNOWN_PANELS'), knownPanels.indexOf(']);', knownPanels.indexOf('const KNOWN_PANELS')));
    for (const p of ['map', 'watchlist', 'saved']) {
      expect(known).toContain(`'${p}'`);
      expect(sidebar).toContain(`| '${p}'`);
      expect(panels).toContain(`case '${p}':`);
    }
    expect(panels).toContain('<MapShellPanel key={activePanel} panel={activePanel}');
  });

  it('they are their own sidebar rows, not members of a tabbed group', () => {
    for (const p of ['map', 'watchlist', 'saved'] as const) expect(groupForPanel(p)).toBeUndefined();
  });

  it('Map is the FIRST sidebar item and switches panels (no href); Saved heading holds Watchlist + Saved', () => {
    const nav = sidebar.slice(sidebar.indexOf('<nav className="flex-1'));
    const map = nav.indexOf('renderShellItem(MAP_ITEM)');
    const groups = nav.indexOf('NAV_GROUPS.filter');
    const saved = nav.indexOf('SAVED_ITEMS.map');
    expect(map).toBeGreaterThan(-1);
    expect(map).toBeLessThan(groups);
    expect(saved).toBeGreaterThan(groups);
    expect(nav.slice(groups, saved)).toContain('>Saved</div>');
    expect(sidebar).toContain("onPanelChange(item.id);");
    expect(sidebar).not.toContain('href={mapHomeLink()}');
  });

  it('the panel is a same-origin shell frame, never the embed', () => {
    expect(shellPanel).toContain('mapShellSrc(panel');
    expect(shellPanel).not.toMatch(/embed=/);
    expect(shellPanel).toContain('e.origin !== window.location.origin');
    expect(shellPanel).toContain('e.source !== frameRef.current.contentWindow');
  });

  it('a reload of an in-app map keeps its panel and view', () => {
    expect(appPage).toContain("if (isReload && !isMapShellPanel(searchParams.get('panel')))");
  });
});
