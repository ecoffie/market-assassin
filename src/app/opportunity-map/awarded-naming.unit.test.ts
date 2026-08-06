/**
 * Awarded-contract naming honesty (Eric 2026-07-27):
 *  - the card TITLE must be the REAL incumbent company, never a fabricated "<service line> recompete"
 *    (the data has no award title — description/psc_description measured 0% populated — so inventing
 *    "Manufacturing recompete" produced an un-googleable label).
 *  - each card is labeled by its REAL award type (IDIQ vehicle / Task order / …) from contract_type,
 *    so the parent-vehicle vs task-order distinction is explicit — not "Recompete target".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return routeSrc.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const contractTypeLabel: (ct: string) => string =
  new Function(`${extractFn('contractTypeLabel')}; return contractTypeLabel;`)();

describe('contractTypeLabel — real award type, human label', () => {
  it('maps the measured contract_type values to explicit labels', () => {
    expect(contractTypeLabel('DELIVERY ORDER')).toBe('Task order');
    expect(contractTypeLabel('PURCHASE ORDER')).toBe('Purchase order');
    expect(contractTypeLabel('BPA CALL')).toBe('BPA call');
    expect(contractTypeLabel('DEFINITIVE CONTRACT')).toBe('Definitive contract');
    expect(contractTypeLabel('IDV_IDC')).toBe('IDIQ vehicle');
  });
  it('blank/unknown → neutral "Awarded contract" (never fabricated)', () => {
    expect(contractTypeLabel('')).toBe('Awarded contract');
    expect(contractTypeLabel(null as unknown as string)).toBe('Awarded contract');
  });
});

describe('no fabricated "<service line> recompete" titles remain', () => {
  it('route.ts no longer builds a title as cat + " recompete"', () => {
    // The old pattern was `o.cat?o.cat+' recompete':...` / `s.cat?s.cat+' recompete':...`.
    expect(routeSrc).not.toMatch(/\.cat\s*\+\s*['"] recompete['"]/);
    expect(routeSrc).not.toMatch(/cat\s*\+\s*['"] \\u2014 recompete['"]/);
  });
  it('the recompete drawer badge uses the real award type, not "Recompete target"', () => {
    const idx = routeSrc.indexOf('function recompeteRender');
    const block = routeSrc.slice(idx, idx + 4200); // window covers head block incl. sub-agency identity line
    expect(block).toContain('contractTypeLabel(o.contractType)');
    expect(block).toContain("'<div class=\"snapt\">'+esc(rcTitle)"); // title = incumbent
  });
});
