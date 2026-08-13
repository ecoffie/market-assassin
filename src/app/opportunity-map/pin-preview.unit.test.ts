import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Map hover = MAX TWO FACTS (Eric 2026-08-13). Line 1 = value. Line 2 = Open agency /
// Recompete "Expires in 18 days" / Forecast "Expected Q2 FY26". Never title, never a date
// alongside a relative, never a mini Decision Card.

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

function factCount(html: string) {
  return (html.match(/class="vprev-(val|ag)"/g) || []).length;
}

describe('pin hover — two facts max (source)', () => {
  const pinJsSrc = route.slice(
    route.indexOf('const PIN_JS ='),
    route.indexOf("+ '</script>';", route.indexOf('const PIN_JS =')),
  );

  it('pinHoverLine2 exists; pinTimeSignal / title / date+relative are gone', () => {
    expect(pinJsSrc).toContain('function pinHoverLine2(');
    expect(pinJsSrc).toContain('MAX TWO FACTS');
    expect(pinJsSrc).not.toContain('function pinTimeSignal(');
    expect(pinJsSrc).not.toContain('o.title');
    expect(pinJsSrc).not.toContain('vprev-days');
  });
});

describe('pin hover — two facts max (eval)', () => {
  const H = loadPinHelpers();

  it('Open: $208K + Army — no due-date chip', () => {
    const html = H.pinPreview({ src: 'SAM', agency: 'Army', close: isoInDays(4), est: 208_000, title: 'Should not appear' });
    expect(html).toContain('$208K');
    expect(html).toContain('Army');
    expect(html).not.toContain('Due in');
    expect(html).not.toContain('days left');
    expect(html).not.toContain('Should not appear');
    expect(factCount(html)).toBe(2);
  });

  it('Recompete: $1.2M + Expires in 18 days — no agency, no calendar date', () => {
    const html = H.pinPreview({
      src: 'RECOMPETE',
      agency: 'Geological Survey',
      title: 'Should not appear',
      exp: isoInDays(18),
      value: 1_200_000,
    });
    expect(html).toContain('$1.2M');
    expect(html).toContain('Expires in 18 days');
    expect(html).not.toContain('Geological Survey');
    expect(html).not.toContain('Should not appear');
    expect(html).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    expect(factCount(html)).toBe(2);
  });

  it('Forecast: $50M + Expected Q2 FY26 — no "in", no ~months, no agency', () => {
    const html = H.pinPreview({
      src: 'FORECAST',
      agency: 'Agriculture',
      cat: 'Forecast · Q2 FY2026',
      close: isoInDays(61),
      est: 50_000_000,
    });
    expect(html).toContain('$50M');
    expect(html).toContain('Expected Q2 FY26');
    expect(html).not.toContain('Expected in');
    expect(html).not.toContain('month');
    expect(html).not.toContain('Agriculture');
    expect(factCount(html)).toBe(2);
  });

  it('falls back to agency when the preferred time fact is missing', () => {
    expect(H.pinHoverLine2({ src: 'RECOMPETE', agency: 'Army', exp: isoInDays(-10) })).toBe('Army');
    expect(H.pinHoverLine2({ src: 'FORECAST', agency: 'NASA', cat: 'Forecast' })).toBe('NASA');
  });
});
