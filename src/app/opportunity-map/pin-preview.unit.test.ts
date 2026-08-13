import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Hover time chip (Eric 2026-08-13): Open = Due in / N days left; Recompete = Expires in /
// N days · Aug 20; Forecast = Expected in / Q4 FY26 · ~2 months. Eval the shipped PIN_JS helpers.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function loadPinHelpers() {
  const start = route.indexOf('const PIN_JS =');
  const endMarker = "+ '</script>';";
  const end = route.indexOf(endMarker, start) + endMarker.length;
  const jsExprSrc = route.slice(start, end).replace(/^const PIN_JS =/, '').replace(/;$/, '');
  const pinJsHtml = vm.runInNewContext('(' + jsExprSrc + ')', {});
  const pinJs = pinJsHtml.replace(/^<script>/, '').replace(/<\/script>$/, '');
  const ctx: any = {
    console,
    cv: () => '',
    L: { divIcon: (o: any) => o, marker: () => ({ on() { return this; }, getElement: () => null, setZIndexOffset() {} }) },
  };
  vm.createContext(ctx);
  vm.runInContext(pinJs, ctx);
  return ctx;
}

function isoInDays(n: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('pin hover time signal — source', () => {
  it('defines pinTimeSignal with Due in / Expires in / Expected in', () => {
    expect(route).toContain('function pinTimeSignal(');
    expect(route).toContain("k:\\'Due in\\'");
    expect(route).toContain("k:\\'Expires in\\'");
    expect(route).toContain("k:\\'Expected in\\'");
    expect(route).toContain('class="vprev-k"');
  });
});

describe('pin hover time signal — eval', () => {
  const H = loadPinHelpers();

  it('Open: Due in · 4 days left', () => {
    const ts = H.pinTimeSignal({ src: 'SAM', close: isoInDays(4), est: 1 });
    expect(ts).toEqual({ k: 'Due in', v: '4 days left' });
  });

  it('Recompete: Expires in · 7 days · <date>', () => {
    const exp = isoInDays(7);
    const ts = H.pinTimeSignal({ src: 'RECOMPETE', exp, valueNum: 1 });
    expect(ts.k).toBe('Expires in');
    expect(ts.v).toMatch(/^7 days · /);
    expect(ts.v).toContain(H.pinShortDate(exp));
  });

  it('Forecast: Expected in · Q4 FY26 · ~2 months', () => {
    const ts = H.pinTimeSignal({
      src: 'FORECAST',
      cat: 'Forecast · Q4 FY2026',
      close: isoInDays(61),
      est: 1,
    });
    expect(ts.k).toBe('Expected in');
    expect(ts.v).toBe('Q4 FY26 · ~2 months');
  });

  it('omits the chip when there is no real date (never fabricated)', () => {
    expect(H.pinTimeSignal({ src: 'SAM', est: 1 })).toBeNull();
    expect(H.pinTimeSignal({ src: 'RECOMPETE', exp: isoInDays(-10) })).toBeNull();
    expect(H.pinTimeSignal({ src: 'FORECAST', cat: 'Forecast' })).toBeNull();
    expect(H.pinTimeSignal({ ctype: 'companies', won: 1 })).toBeNull();
  });

  it('pinPreview HTML carries the label + the example', () => {
    const html = H.pinPreview({ src: 'SAM', agency: 'Army', close: isoInDays(4), est: 208_000 });
    expect(html).toContain('vprev-k');
    expect(html).toContain('Due in');
    expect(html).toContain('4 days left');
    expect(html).toContain('Army');
  });
});
