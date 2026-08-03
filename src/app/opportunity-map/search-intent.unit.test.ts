import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Natural-language search intent (Eric 2026-08-03: "instead of a chatbot, a real search feature —
// 'Show me Army opportunities' shows on the map"). Rules-based: parse an agency/set-aside/state/
// lifecycle phrase → apply a REAL filter + strip the recognized words; fall through to keyword search
// otherwise. This test mirrors the shipped parser core to assert real outputs, plus a source-assert
// that the Enter handler runs the parser before the literal search.
//
// ⚠️ The shipped parser uses PLAIN SPACE-PADDED SUBSTRING matching, NOT regex. Six attempts to ship a
// /\b…\b/ (or `new RegExp('\\b…')`) parser failed because the template-literal → template-html.ts
// generation collapses every `\b` to a literal BACKSPACE (\x08), so the regex silently never matched
// and parseSearchIntent returned null. This mirror therefore uses the SAME substring approach, so it
// actually reflects what ships. (Eric 2026-08-03.)
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// --- mirror of the shipped parser (kept in sync with route.ts parseSearchIntent) ---
const hasPhrase = (padded: string, phrase: string) => padded.indexOf(' ' + phrase + ' ') !== -1;
const hasAny = (padded: string, phrases: string[]) => phrases.some((p) => hasPhrase(padded, p));
const stripPhrase = (padded: string, phrase: string) => {
  const t = ' ' + phrase + ' ';
  let idx: number;
  while ((idx = padded.indexOf(t)) !== -1) padded = padded.slice(0, idx) + ' ' + padded.slice(idx + t.length);
  return padded;
};
const AGENCY = [
  { needle: 'Army', syns: ['army', 'us army', 'u.s. army', 'department of the army'] },
  { needle: 'Navy', syns: ['navy', 'us navy', 'u.s. navy', 'department of the navy'] },
  { needle: 'Air Force', syns: ['air force', 'airforce', 'usaf', 'department of the air force'] },
  { needle: 'Veterans Affairs', syns: ['va', 'veterans affairs', 'veterans'] },
];
const SETASIDE = [
  { val: 'sdvosb', syns: ['sdvosb', 'service disabled veteran', 'service-disabled veteran'] },
  { val: '8a', syns: ['8a', '8(a)', '8 a'] },
  { val: 'wosb', syns: ['wosb', 'women owned', 'women-owned'] },
];
const STATES: Record<string, string> = { FL: 'Florida', TX: 'Texas', VA: 'Virginia', CA: 'California' };
const FILLER = ['show me', 'show', 'find', 'get', 'list', 'all', 'the', 'me', 'opportunities', 'opportunity', 'opps', 'contracts', 'contract', 'bids', 'bid', 'in', 'for', 'from', 'by', 'with', 'any'];
function stateFrom(padded: string): string {
  for (const c of Object.keys(STATES)) if (hasPhrase(padded, STATES[c].toLowerCase())) return c;
  return '';
}
function parse(raw: string) {
  let q = ' ' + String(raw || '').toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = { agency: '', state: '', setAside: '', kw: '', applied: false };
  for (const A of AGENCY) if (hasAny(q, A.syns)) { out.agency = A.needle; A.syns.forEach((s) => (q = stripPhrase(q, s))); out.applied = true; break; }
  const st = stateFrom(q);
  if (st) { out.state = st; q = stripPhrase(q, STATES[st].toLowerCase()); out.applied = true; }
  for (const S of SETASIDE) if (hasAny(q, S.syns)) { out.setAside = S.val; S.syns.forEach((s) => (q = stripPhrase(q, s))); out.applied = true; }
  if (!out.applied) { out.kw = ''; return out; }
  FILLER.forEach((f) => (q = stripPhrase(q, f)));
  out.kw = q.replace(/\s+/g, ' ').trim();
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

  it('does NOT match a substring inside a bigger word (armystrong ≠ army)', () => {
    const r = parse('armystrong logistics');
    expect(r.agency).toBe('');
    expect(r.applied).toBe(false);
  });

  it('an unrecognized query falls through to keyword search (applied=false)', () => {
    const r = parse('roofing services');
    expect(r.applied).toBe(false);
    expect(r.agency).toBe('');
  });

  it('parser core uses SUBSTRING matching, not \\b regex (the escaping trap)', () => {
    // The shipped parser must NOT build agency/set-aside regexes — a \b there collapses to backspace.
    expect(route).toMatch(/_hasPhrase\s*=\s*function/);
    expect(route).toMatch(/padded\.indexOf\(' '\+phrase\+' '\)/);
  });

  it('the Enter handler runs parseSearchIntent BEFORE the literal search + refetches on a hit', () => {
    expect(route).toContain('function parseSearchIntent(raw)');
    // parser is PURE — it returns an intent object and does NOT touch FILT (a different <script> IIFE)
    expect(route).toMatch(/intent=\{agency:'',state:'',setAside:'',horizon:'',keyword:''\}/);
    // Enter hands the intent to the GLOBAL applier (VIEWPORT_JS scope, where FILT lives)
    expect(route).toMatch(/intent=parseSearchIntent\(q\)/);
    expect(route).toMatch(/window\.__applySearchFilters\(intent\)/);
    // the global applier sets FILT.agency + lights the chip
    expect(route).toMatch(/window\.__applySearchFilters = function\(intent\)/);
    expect(route).toMatch(/FILT\.agency=intent\.agency/);
  });

  it('recognized filters reflect in their native controls (chip + Filters input), so they are clearable', () => {
    expect(route).toMatch(/agencyLabel'\);\s*if\(lbl\)lbl\.textContent=intent\.agency/);
    expect(route).toMatch(/mfAgency'\);\s*if\(mfA\)mfA\.value=intent\.agency/);
  });
});
