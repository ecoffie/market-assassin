/**
 * renderClusters()/clusterBubble() live in the TEMPLATE <script> block, which does NOT share scope
 * with the route.ts JS blocks — helpers like esc()/mMoney()/toRow() are defined THERE, not here.
 * clusterBubble called esc(c.state) → "esc is not defined" at runtime → the bubble render aborted →
 * 0 bubbles AND a half-rendered dataset desync (Eric 2026-07-28: signed-in map broken, not clicking
 * through). This test fails if the cluster render code references a helper that isn't in its scope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

function fnBody(name: string): string {
  const start = tmpl.indexOf(`function ${name}(`);
  const open = tmpl.indexOf('{', start);
  let d = 0;
  for (let i = open; i < tmpl.length; i++) { const c = tmpl[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return tmpl.slice(start, i + 1); } }
  throw new Error(name + ' not found');
}
// Strip line comments so a comment mentioning a helper name isn't a false positive.
const stripComments = (s: string) => s.split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');

// Helpers that are DEFINED IN route.ts's script blocks, NOT the template script — calling them from
// the template's cluster render throws a ReferenceError.
const FOREIGN_HELPERS = ['esc', 'esc0', 'mMoney', 'pinMoney', 'toRow', 'contactCard', 'contactPopup'];
// Route-VIEWPORT_JS-scope variables (NOT in the template script) — referencing them from the cluster
// render is the same cross-scope crash as esc() (INVIEW threw 'INVIEW is not defined').
const FOREIGN_VARS = ['INVIEW', 'TOTAL', 'CAPPED', 'HIDE_FSC', 'MODE', 'FILT'];

describe('cluster render uses only template-scope helpers', () => {
  for (const fn of ['clusterBubble', 'renderClusters']) {
    it(`${fn}() references no route-only helper (the "esc is not defined" class)`, () => {
      const body = stripComments(fnBody(fn));
      for (const h of FOREIGN_HELPERS) {
        expect(body, `${fn} calls ${h}() which is not in the template script scope`).not.toMatch(new RegExp(`\\b${h}\\s*\\(`));
      }
      for (const v of FOREIGN_VARS) {
        expect(body, `${fn} reads ${v} which lives in the route VIEWPORT_JS scope, not here`).not.toMatch(new RegExp(`\\b${v}\\b`));
      }
    });
  }
});
