/**
 * The Map URL carries a parent/vehicle scope exactly like the rest of the discovery intent:
 * written from FILT, reproduced on reload, dropped when cleared, and never added to a bare browse.
 * Executes the extracted client source (it ships inside a TS template literal).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const cook = (s: string) => s.replace(/\\\\/g, '\\');
const between = (a: string, b: string) => {
  const s = MAP.indexOf(a); expect(s, a).toBeGreaterThan(0);
  const e = MAP.indexOf(b, s + a.length); expect(e, b).toBeGreaterThan(s);
  return MAP.slice(s, e);
};
type Intent = { q?: string; agency?: string; horizon?: string; vehicle?: string; parent?: string; work?: string; leadMax?: string; minValue?: string };
const mapQueryUrl: (s: string, i: Intent, d?: boolean) => string = new Function(
  cook(between('window.__mapQueryUrl=function(search,intent,dropContext){', 'window.__syncQueryUrl=function('))
    .replace('window.__mapQueryUrl=', 'var f=') + '; return f;',
)();

describe('scope in the URL', () => {
  it('writes vehicle + work with the horizon and the window', () => {
    expect(mapQueryUrl('', { vehicle: 'OASIS+', work: 'management consulting', horizon: 'recompete', leadMax: '60' }))
      .toBe('?horizon=recompete&vehicle=OASIS%2B&work=management%20consulting&leadMax=60');
  });
  it('the shared link reproduces itself (idempotent on reload)', () => {
    const s = '?mode=recompete&horizon=recompete&vehicle=OASIS%2B&work=management%20consulting&leadMax=60';
    expect(mapQueryUrl(s, { vehicle: 'OASIS+', work: 'management consulting', horizon: 'recompete', leadMax: '60' })).toBe(s);
  });
  it('exact parent ids keep their commas', () => {
    expect(mapQueryUrl('', { parent: 'CONT_IDV_A_4732,CONT_IDV_B_4732', horizon: 'recompete' }))
      .toBe('?horizon=recompete&parent=CONT_IDV_A_4732,CONT_IDV_B_4732');
  });
  it('clearing the scope removes it (and its window) from the URL', () => {
    expect(mapQueryUrl('?mode=recompete&horizon=recompete&vehicle=OASIS%2B&leadMax=60', { horizon: 'recompete' }))
      .toBe('?mode=recompete');
  });
  it('a scoped link writes its value floor, and a pill edit rewrites it', () => {
    const s = '?mode=recompete&horizon=recompete&vehicle=OASIS%2B&minValue=1000000&leadMax=60';
    expect(mapQueryUrl(s, { vehicle: 'OASIS+', horizon: 'recompete', leadMax: '60', minValue: '1000000' })).toBe(s);
    expect(mapQueryUrl(s, { vehicle: 'OASIS+', horizon: 'recompete', leadMax: '60', minValue: '250000' }))
      .toBe('?mode=recompete&horizon=recompete&vehicle=OASIS%2B&leadMax=60&minValue=250000');
    expect(mapQueryUrl(s, { vehicle: 'OASIS+', horizon: 'recompete', leadMax: '60', minValue: '' }))
      .toBe('?mode=recompete&horizon=recompete&vehicle=OASIS%2B&leadMax=60');
  });
  it('#1692 review 2: clearing the scope drops the floor it carried (reload cannot re-apply a cleared $1M floor)', () => {
    expect(mapQueryUrl('?mode=recompete&horizon=recompete&vehicle=OASIS%2B&state=DC&minValue=1000000&leadMax=60', { horizon: 'recompete' }))
      .toBe('?mode=recompete&state=DC');
  });
  it('a minValue with no scope is left exactly as it was (not this writer\'s key)', () => {
    expect(mapQueryUrl('?minValue=5&q=x&horizon=recompete', { q: 'x', horizon: 'recompete' })).toBe('?minValue=5&q=x&horizon=recompete');
  });
  it('a leadMax without a scope is left exactly as it was', () => {
    expect(mapQueryUrl('?leadMax=12&q=x&horizon=recompete', { q: 'x', horizon: 'recompete' })).toBe('?leadMax=12&q=x&horizon=recompete');
  });
});

describe('wiring', () => {
  it('the scope link reads vehicle/parent/work/leadMax and the continuity restorer stands down for them', () => {
    expect(MAP).toContain("var vehicle=P('vehicle'), parent=P('parent'), work=P('work'), leadMax=P('leadMax'), minValue=P('minValue');");
    expect(MAP).toMatch(/\|embed\|vehicle\|parent\|work\)=/);
  });
  it('the restorer whitelists the keys and the Awarded fetch sends them', () => {
    expect(MAP).toMatch(/vehicle:'', parent:'', work:'' \};\n\s*for\(var k in FILT\)/);
    expect(MAP).toContain("if(FILT.vehicle)url+='&vehicle='+encodeURIComponent(FILT.vehicle);");
  });
  it('#1692 review 1: the minValue guard the BROWSER receives admits whole dollars only (executed, not grepped)', () => {
    // Evaluate the SOURCE line as the template literal it lives in — exactly what the page serves
    // (a single \. would come out as '.', which a backslash-only "cook" would not reproduce).
    const raw = MAP.split('\n').find((l) => l.includes("f.valueRange=minValue+'-'"))!;
    expect(raw).not.toMatch(/`|\$\{/);   // a plain line: no backtick, no interpolation
    const line = new Function('return `' + raw + '`;')() as string;
    const src = /if\(minValue&&\/(.+)\/\.test\(minValue\)\)/.exec(line)![1];
    const guard = new RegExp(src);
    for (const ok of ['1', '1000000', '999999999999999']) expect(guard.test(ok), ok).toBe(true);
    for (const bad of ['1-2', '1-234', '1e5', '12x3', '1.5', '1.500', '-5', '1000000000000000', '']) expect(guard.test(bad), bad).toBe(false);
  });
  it('the Value pill keeps an intent link in step', () => {
    expect(MAP).toMatch(/syncDeepSelect\(\);\n.*\n\s*if\(typeof window\.__syncQueryUrl==='function'\)window\.__syncQueryUrl\(false,true\);/);
    expect(MAP).toContain("FILT.leadMax=''; FILT.valueRange='';");
  });
  it('#1692 review: an off-band floor survives a Filters apply; a user choice or Filters Clear still clears it', () => {
    expect(MAP).toContain("if(!ok&&s)el.setAttribute('data-offband',s); else el.removeAttribute('data-offband');");
    expect(MAP).toContain("return e.value||e.getAttribute('data-offband')||'';");
    expect(MAP).toMatch(/\['mfValueMin','mfValueMax','mfLead'\]\.forEach\(function\(id\)\{var e=document\.getElementById\(id\);if\(e\)e\.removeAttribute\('data-offband'\);\}\);/);
    expect(MAP).toContain("e.addEventListener('change',function(){ e.removeAttribute('data-offband'); });");
  });
  it('an off-band window (leadMax=60) survives a Filters apply the same way', () => {
    expect(MAP).toContain("if(FILT.leadMax&&_rLd.value!==String(FILT.leadMax))_rLd.setAttribute('data-offband',String(FILT.leadMax));");
    expect(MAP).toContain("FILT.leadMax=_vb('mfLead');");
  });
  it('the writer emits whole dollars only (what the scope-link reader accepts)', () => {
    expect(MAP).toContain("?String(Math.floor(parseFloat(String(FILT.valueRange).split('-')[0]))):''");
  });
  it('a scope fetches the Awarded horizon alone (no unscoped totals summed in)', () => {
    expect(MAP).toContain("if(FILT.vehicle||FILT.parent||FILT.work){ _enabled=['recompete']; }");
  });
});
