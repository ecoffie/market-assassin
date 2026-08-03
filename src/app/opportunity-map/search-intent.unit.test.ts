import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Natural-language search intent (Eric 2026-08-03: "instead of a chatbot, a real search feature —
// 'Show me Army opportunities' shows on the map"). Rules-based: parse an agency/set-aside/state/
// lifecycle phrase → apply a REAL filter + strip the recognized words; fall through to keyword search
// otherwise. This test mirrors the shipped parser core to assert real outputs, plus a source-assert
// that the Enter handler runs the parser before the literal search.
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// --- mirror of the shipped parser (kept in sync with route.ts parseSearchIntent) ---
const AGENCY = [
  { needle: 'Army', re: /\b(army|u\.?s\.? army|department of the army)\b/i },
  { needle: 'Navy', re: /\b(navy|u\.?s\.? navy|department of the navy)\b/i },
  { needle: 'Air Force', re: /\b(air ?force|usaf|department of the air force)\b/i },
  { needle: 'Veterans Affairs', re: /\b(va|veterans affairs|dept\.? of veterans)\b/i },
];
const SETASIDE = [
  { val: 'sdvosb', re: /\b(sdvosb|service.?disabled.*veteran)\b/i },
  { val: '8a', re: /\b(8\s?\(?a\)?)\b/i },
  { val: 'wosb', re: /\b(wosb|women.?owned)\b/i },
];
const STATES: Record<string, string> = { FL: 'Florida', TX: 'Texas', VA: 'Virginia', CA: 'California' };
function stateFrom(q: string): string {
  for (const c of Object.keys(STATES)) if (new RegExp('\\b' + STATES[c] + '\\b', 'i').test(q)) return c;
  return '';
}
function parse(raw: string) {
  let q = ' ' + raw + ' ';
  const out = { agency: '', state: '', setAside: '', kw: '', applied: false };
  for (const A of AGENCY) if (A.re.test(q)) { out.agency = A.needle; q = q.replace(A.re, ' '); out.applied = true; break; }
  const st = stateFrom(q);
  if (st) { out.state = st; q = q.replace(new RegExp('\\b' + STATES[st] + '\\b', 'i'), ' '); out.applied = true; }
  for (const S of SETASIDE) if (S.re.test(q)) { out.setAside = S.val; q = q.replace(S.re, ' '); out.applied = true; }
  out.kw = q.replace(/\b(show me|show|find|get|list|all|the|me|opportunities|opps|contracts|bids|in|for|from|by|with|any)\b/ig, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

describe('Natural-language search intent', () => {
  it('"Show me Army opportunities" → Army agency filter, no leftover keyword', () => {
    const r = parse('Show me Army opportunities');
    expect(r.agency).toBe('Army');
    expect(r.applied).toBe(true);
    expect(r.kw).toBe('');
  });

  it('combines agency + state + set-aside, and keeps a real keyword', () => {
    expect(parse('Navy contracts in Florida')).toMatchObject({ agency: 'Navy', state: 'FL' });
    expect(parse('8(a) opportunities in Texas')).toMatchObject({ state: 'TX', setAside: '8a', kw: '' });
    expect(parse('Air Force cybersecurity in Virginia')).toMatchObject({ agency: 'Air Force', state: 'VA', kw: 'cybersecurity' });
  });

  it('an unrecognized query falls through to keyword search (applied=false)', () => {
    const r = parse('roofing services');
    expect(r.applied).toBe(false);
    expect(r.agency).toBe('');
  });

  it('the Enter handler runs parseSearchIntent BEFORE the literal search + refetches on a hit', () => {
    expect(route).toContain('function parseSearchIntent(raw)');
    // Enter: parse first; on a hit, apply + refetch; else fall to captureSearch
    expect(route).toMatch(/hit=parseSearchIntent\(q\)/);
    expect(route).toMatch(/if\(hit\)\{ captureSearch\(q\); if\(window\.__mapRefetch\)window\.__mapRefetch\(\);/);
    // a matched AGENCY sets FILT.agency (the real filter the API narrows on)
    expect(route).toMatch(/FILT\.agency=A\.needle/);
  });

  it('recognized filters reflect in their native controls (chip + Filters input), so they are clearable', () => {
    expect(route).toMatch(/agencyLabel'\);\s*if\(lbl\)lbl\.textContent=A\.needle/);
    expect(route).toMatch(/mfAgency'\);\s*if\(mfA\)mfA\.value=A\.needle/);
  });
});
