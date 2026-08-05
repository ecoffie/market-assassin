import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Boot-bind null-safety guard (2026-08-04). The map's top-level init binds click/change handlers to
// controls by id. If ANY of those elements is renamed/removed by another change, an unguarded
// `document.getElementById(id).onclick = …` throws "Cannot set properties of null (setting 'onclick')"
// at boot — which aborts the REST of init and makes fetchView's render throw, surfacing the FALSE
// "Couldn't load this view / network hiccup" on every cold load even though the API returned 200.
// (That exact break shipped when the legacy filter bar's #fitBtn/#f-sd/… were removed but their binds
// weren't.) The fix + this guard: every id-bind at module scope goes through bindEl(), which no-ops on
// a missing element, so one absent control can never brick the whole map again.
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('opportunity-map boot binds are null-safe (one missing control must never brick init)', () => {
  it('defines the bindEl(id,ev,fn) null-safe helper', () => {
    expect(tmpl).toMatch(/function bindEl\(id,ev,fn\)\{var el=document\.getElementById\(id\); if\(el\)el\[ev\]=fn;/);
  });

  it('has NO unguarded `document.getElementById(id).onclick/onchange/... =` in the client scripts', () => {
    // Strip line comments so a comment that quotes the bad pattern (like this file's own docs) is ignored.
    const code = tmpl.replace(/^\s*\/\/.*$/gm, '');
    const offenders = [...code.matchAll(/document\.getElementById\('([^']+)'\)\.(onclick|onchange|oninput|onsubmit|onkeydown)\s*=/g)]
      .map((m) => `${m[1]}.${m[2]}`);
    // Any hit is a boot landmine — it must go through bindEl() instead.
    expect(offenders, `unguarded id-binds (use bindEl): ${offenders.join(', ')}`).toEqual([]);
  });

  it('binds the known boot controls through bindEl (fitBtn, basemapBtn, sort, clrAll, sbOpen/sbClose)', () => {
    for (const id of ['fitBtn', 'basemapBtn', 'sort', 'clrAll', 'sbOpen', 'sbClose', 'resetProg', 'f-sd', 'f-soon']) {
      expect(tmpl, `${id} must bind via bindEl`).toMatch(new RegExp(`bindEl\\('${id}'`));
    }
  });
});
