import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('Proposal Workspace — M-Win insight panel', () => {
  it('Why this score is a panel, not a native alert()', () => {
    expect(route).toContain('window.__wsWhy=function()');
    expect(route).toContain('id="mwOv"');
    expect(route).toContain('Why your M-Win is ');
    expect(route).toContain('Primary reason your score is lower');
    expect(route).toContain('class="mw-k">Win factors');
    expect(route).toContain('class="mw-k">Risks');
    expect(route).toContain('Improve your score');
    expect(route).toContain("Add '+h(code)+' to Vault");
    // the old system dialog is gone from this click path
    const why = route.slice(route.indexOf('window.__wsWhy=function()'), route.indexOf('window.__wsWhyAddNaics='));
    expect(why).not.toContain('alert(');
  });

  it('adds the missing NAICS to Vault (merge, never replace) then rescores', () => {
    expect(route).toContain('window.__wsWhyAddNaics=function(code)');
    expect(route).toContain("fetch('/api/app/vault/identity',{method:'PUT'");
    expect(route).toContain('profile:{primary_naics:cur}');
    expect(route).toContain("if(cur.indexOf(code)<0) cur.push(code)");
    expect(route).toContain('loadMwin(function(){ window.__wsWhy(); })');
  });

  it('uses SVG glyphs, not emoji, and an X close with no duplicate Close button', () => {
    expect(route).toContain("x:'<svg viewBox=\"0 0 24 24\"><path d=\"M18 6 6 18M6 6l12 12\"/></svg>'");
    expect(route).toContain('onclick="window.__wsWhyClose()"');
    const why = route.slice(route.indexOf('window.__wsWhy=function()'), route.indexOf('window.__wsWhyAddNaics='));
    expect(why).not.toContain('Close</button>');
    expect(why).not.toMatch(/[✓⚠]/);
  });
});
