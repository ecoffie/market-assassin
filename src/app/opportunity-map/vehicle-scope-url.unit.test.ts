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
  describe('#1692 review: an applied value the Filters select has no band for is SHOWN, not hidden', () => {
    // Execute the served helper against a minimal <select> (options, value, querySelector, appendChild).
    type Opt = { value: string; textContent: string; attrs: Record<string, string>; setAttribute(k: string, v: string): void; remove(): void };
    function mkSelect(bands: [string, string][]) {
      const sel = {
        options: [] as Opt[], _v: '',
        get value() { return this._v; },
        set value(v: string) { this._v = this.options.some((o) => o.value === v) ? v : ''; },
        querySelector(q: string) { return q === 'option[data-custom]' ? this.options.find((o) => o.attrs['data-custom']) ?? null : null; },
        appendChild(o: Opt) { this.options.push(o); },
      };
      const mk = (value: string, textContent: string): Opt => {
        const o: Opt = { value, textContent, attrs: {}, setAttribute(k, v) { o.attrs[k] = v; }, remove() { sel.options.splice(sel.options.indexOf(o), 1); } };
        return o;
      };
      for (const [v, t] of bands) sel.options.push(mk(v, t));
      return { sel, mk };
    }
    const raw = between('window.__selectShow=function(el,v,label){', '  window.__vehicleScopeState=function(){');
    const build = (mk: (v: string, t: string) => Opt) => new Function('document', raw.replace('window.__selectShow=', 'var f=') + '; return f;')(
      { createElement: () => mk('', '') },
    ) as (el: unknown, v: string, label: string) => void;
    const LEAD: [string, string][] = [['', 'Any timeframe'], ['6', '6 months'], ['12', '12 months'], ['18', '18 months']];

    it('off-band 60 → a visible "60 months (custom)" option is selected (a Filters apply reads 60)', () => {
      const { sel, mk } = mkSelect(LEAD); build(mk)(sel, '60', '60 months (custom)');
      expect(sel.value).toBe('60');
      expect(sel.options.map((o) => o.textContent)).toContain('60 months (custom)');
    });
    it('choosing the blank option is a real change that clears it', () => {
      const { sel, mk } = mkSelect(LEAD); build(mk)(sel, '60', '60 months (custom)');
      expect(sel.value).not.toBe('');
      sel.value = '';                                  // the user picks "Any timeframe" — the value really changes
      expect(sel.value).toBe('');
    });
    it('a banded value or a reset removes the injected option; only one is ever injected', () => {
      const { sel, mk } = mkSelect(LEAD); const show = build(mk);
      show(sel, '60', '60 months (custom)'); show(sel, '48', '48 months (custom)');
      expect(sel.options.filter((o) => o.attrs['data-custom'])).toHaveLength(1);
      expect(sel.value).toBe('48');
      show(sel, '12', 'x'); expect(sel.value).toBe('12'); expect(sel.options.some((o) => o.attrs['data-custom'])).toBe(false);
      show(sel, '60', '60 months (custom)'); show(sel, '', ''); expect(sel.value).toBe(''); expect(sel.options).toHaveLength(4);
    });
    it('every path that set or cleared the old hidden mark now goes through the visible option', () => {
      expect(MAP).not.toContain('data-offband');
      expect(MAP).toContain("window.__selectShow(document.getElementById('mfLead'), FILT.leadMax||'', (FILT.leadMax||'')+' months (custom)');");
      expect(MAP).toContain("['mfValueMin','mfValueMax','mfLead'].forEach(function(id){window.__selectShow(document.getElementById(id),'','');});");
      expect(MAP).toContain("FILT.leadMax=(document.getElementById('mfLead')||{}).value||'';");
    });
  });
  it('the writer emits whole dollars the reader accepts (1..999,999,999,999,999), else nothing', () => {
    expect(MAP).toContain("return (isFinite(n)&&n>=1&&n<=999999999999999)?String(n):''; })()");
  });
  it('a scope fetches the Awarded horizon alone (no unscoped totals summed in)', () => {
    expect(MAP).toContain("if(FILT.vehicle||FILT.parent||FILT.work){ _enabled=['recompete']; }");
  });
});
