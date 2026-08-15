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
const BIGSORT = ['biggest', 'largest', 'top', 'highest', 'major', 'leading', 'biggest contractors', 'top contractors'];
const PLAYER_WORDS = ['contractor', 'contractors', 'company', 'companies', 'firm', 'firms', 'vendor', 'vendors', 'prime', 'primes', 'incumbent', 'incumbents', 'buyer', 'buyers', 'sblo', 'businesses', 'players'];
const OPP_WORDS = ['opportunity', 'opportunities', 'opp', 'opps', 'contract', 'contracts', 'bid', 'bids', 'solicitation', 'rfp', 'award', 'awards'];
const LIFECYCLE = [{ hz: 'recompete', syns: ['recompete', 'recompetes', 'expiring', 'expiration', 'expire'] }, { hz: 'forecast', syns: ['forecast', 'forecasts', 'planned', 'upcoming'] }];
const FILLER = ['show me', 'show', 'find', 'get', 'list', 'all', 'the', 'me', 'opportunities', 'opportunity', 'opps', 'contracts', 'contract', 'bids', 'bid', 'in', 'for', 'from', 'by', 'with', 'any'];
function stateFrom(padded: string): string {
  for (const c of Object.keys(STATES)) if (hasPhrase(padded, STATES[c].toLowerCase())) return c;
  return '';
}
function parse(raw: string) {
  let q = ' ' + String(raw || '').toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = { agency: '', state: '', setAside: '', bigSort: false, dataset: '', kw: '', applied: false };
  // dataset routing FIRST (before filler-strip eats the noun)
  if (hasAny(q, PLAYER_WORDS)) out.dataset = 'players';
  else if (hasAny(q, OPP_WORDS)) out.dataset = 'opportunities';
  for (const A of AGENCY) if (hasAny(q, A.syns)) { out.agency = A.needle; A.syns.forEach((s) => (q = stripPhrase(q, s))); out.applied = true; break; }
  const st = stateFrom(q);
  if (st) { out.state = st; q = stripPhrase(q, STATES[st].toLowerCase()); out.applied = true; }
  for (const S of SETASIDE) if (hasAny(q, S.syns)) { out.setAside = S.val; S.syns.forEach((s) => (q = stripPhrase(q, s))); out.applied = true; }
  for (const L of LIFECYCLE) if (hasAny(q, L.syns)) { if (!out.dataset) out.dataset = 'opportunities'; L.syns.forEach((s) => (q = stripPhrase(q, s))); out.applied = true; }
  if (hasAny(q, BIGSORT)) { out.bigSort = true; if (!out.dataset) out.dataset = 'players'; BIGSORT.forEach((b) => (q = stripPhrase(q, b))); out.applied = true; }
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

  it('TWO-MAPS routing: a query names WHICH map (people→Players, opps→Opportunity)', () => {
    expect(parse('Show me the biggest VA contractors in Florida').dataset).toBe('players');
    expect(parse('find primes in Virginia').dataset).toBe('players');
    expect(parse('top 8(a) firms in California').dataset).toBe('players');
    expect(parse('Show me Army opportunities').dataset).toBe('opportunities');
    expect(parse('Navy recompetes in Texas').dataset).toBe('opportunities'); // recompete horizon → opportunities
    expect(parse('roofing services').dataset).toBe(''); // no routing word → no switch (falls through)
  });

  it('the bridge SWITCHES the map to the routed dataset before applying (Ask Mindy → right map)', () => {
    // setMapMode('companies') for players, setMapMode('open') for opportunities, gated on a mismatch.
    expect(route).toMatch(/if\(intent\.dataset && typeof setMapMode==='function'\)/);
    expect(route).toMatch(/if\(_wantContact && !_isContact\)\{ setMapMode\('companies'\)/);
    expect(route).toMatch(/else if\(!_wantContact && _isContact\)\{ setMapMode\('open'\)/);
  });

  it('NAV: the second map is user-facing "Players" under an "Explore" eyebrow', () => {
    // The label was "Network" 2026-08-03 → 08-15, then Eric reverted it: "change network back to
    // players everywhere". The internal data-map value was ALWAYS "players", so this revert is
    // label-only — no wiring changed in either direction. The two-MAPS split itself is untouched.
    expect(route).toContain('data-map="players" data-mode="companies"');
    expect(route).toContain('>Players</a>');
    expect(route).toContain('<span class="zh-explore">Explore</span>');
    // dropdown option + header title also say Players
    expect(route).toContain('<option value="companies">Players</option>');
    expect(route).toContain("?'Players':'Opportunities'");
    // …and the RETIRED "Network" label is gone from these surfaces. (This block asserted the
    // reverse — that "Players" was gone — while the label was "Network", 2026-08-03 → 08-15.
    // Eric reverted it, so the absence check follows the label rather than being deleted.)
    expect(route).not.toContain('>Network</a>');
    expect(route).not.toContain('<option value="companies">Network</option>');
  });

  it('Players: "biggest VA contractors in Florida" → state FL + bigSort, agency parsed (applied by dataset)', () => {
    const r = parse('Show me the biggest VA contractors in Florida');
    expect(r.state).toBe('FL');
    expect(r.bigSort).toBe(true);
    expect(r.agency).toBe('Veterans Affairs'); // parsed; the bridge decides whether to APPLY it (Players = keyword only)
    expect(r.applied).toBe(true);
  });

  it('Players: "top 8(a) firms in Texas" → TX + 8a + bigSort', () => {
    const r = parse('top 8(a) firms in Texas');
    expect(r).toMatchObject({ state: 'TX', setAside: '8a', bigSort: true });
  });

  it('the Players bridge APPLIES the agency chip on Players too (2026-08-03: companies-by-agency shipped) + maps biggest→company sort', () => {
    // agency chip now applies on BOTH Opportunities and Players (searchRecipients scans awards by
    // awarding_agency/awarding_sub_agency when set) — no longer gated to !_players.
    expect(route).toMatch(/if\(intent\.agency\)\{ FILT\.agency=intent\.agency/);
    expect(route).not.toMatch(/if\(intent\.agency && !_players\)/);
    // "biggest" on Players sets the server-side company sort (value = high→low)
    expect(route).toMatch(/if\(intent\.bigSort && _players\)\{ window\.__companySort='value'/);
    // a state filter pans the viewport to that state (Players pins are bbox-scoped, else "No contacts in view")
    expect(route).toMatch(/window\.__STATE_CENTROIDS && window\.__STATE_CENTROIDS\[intent\.state\]/);
    // the agency word is a REAL filter now — no longer restored as a keyword fallback on Players (that
    // would double-apply the same word as both a filter AND a keyword, over-narrowing the AND).
    expect(route).not.toMatch(/if\(_players && intent\.agency\)\{ _kw=/);
  });

  it('parser core uses SUBSTRING matching, not \\b regex (the escaping trap)', () => {
    // The shipped parser must NOT build agency/set-aside regexes — a \b there collapses to backspace.
    expect(route).toMatch(/_hasPhrase\s*=\s*function/);
    expect(route).toMatch(/padded\.indexOf\(' '\+phrase\+' '\)/);
  });

  it('whitespace-collapse uses \\\\s (double backslash), never \\s (the /s+/ letter-s trap)', () => {
    // In the backtick template literal a single-backslash `\s` serializes to `/s+/`, which replaces
    // every LETTER s with a space ("biggest"→"bigge t"). It MUST be `\\s+` so it ships as `/\s+/`.
    const parser = route.slice(route.indexOf('function parseSearchIntent(raw)'), route.indexOf('return intent;\n  }'));
    // no bare `/\s+/` in the parser (would be `\\s+` in source when correct)
    expect(parser).not.toMatch(/replace\(\/\\s\+\/g/); // this pattern = a SINGLE backslash-s in source → BUG
    expect(parser).toMatch(/replace\(\/\\\\s\+\/g/);    // this = DOUBLE backslash-s in source → correct
  });

  it('the Enter handler runs parseSearchIntent BEFORE the literal search + refetches on a hit', () => {
    expect(route).toContain('function parseSearchIntent(raw)');
    // parser is PURE — it returns an intent object and does NOT touch FILT (a different <script> IIFE)
    expect(route).toMatch(/intent=\{agency:'',state:'',setAside:'',horizon:'',bigSort:false,dataset:'',keyword:''\}/);
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
