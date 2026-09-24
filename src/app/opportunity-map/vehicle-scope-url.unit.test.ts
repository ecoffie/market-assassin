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
type Intent = { q?: string; agency?: string; horizon?: string; vehicle?: string; parent?: string; work?: string; leadMax?: string };
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
  it('a scoped link\'s value floor (MCP min_value) becomes the same FILT.valueRange the Value pill writes', () => {
    expect(MAP).toContain("minValue=P('minValue');");
    expect(MAP).toMatch(/if\(minValue&&\/\^\[0-9\]\{1,15\}.*\)f\.valueRange=minValue\+'-';/);
  });
  it('a scope fetches the Awarded horizon alone (no unscoped totals summed in)', () => {
    expect(MAP).toContain("if(FILT.vehicle||FILT.parent||FILT.work){ _enabled=['recompete']; }");
  });
});
