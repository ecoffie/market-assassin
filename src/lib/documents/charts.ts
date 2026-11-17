/**
 * ChartBlock → SVG, as a pure string (no chart library, no DOM). The HTML/PDF renderer inlines it;
 * Chromium draws SVG natively, so PDF charts are vector and crisp.
 *
 * Design: one hue for single-series magnitude charts, a small validated categorical palette only
 * when there is more than one series, direct value labels, no gridline clutter.
 */
import type { ChartBlock } from './model';
import { hex, resolveTheme, type Theme } from './theme';
import { formatChartValue, usdColumnDecimals } from './format';

// Palette for the chart being drawn, from the document's theme (set by chartToSvg; rendering is sync).
let INK = '';
let MUTED = '';
let AXIS = '';
let GRID = '';
let WHITE = '';
let PRIMARY = '';
let SERIES: string[] = [];
function usePalette(t: Theme) {
  INK = hex(t.colors.ink); MUTED = hex(t.colors.muted); WHITE = hex(t.colors.white);
  AXIS = hex(t.colors.chart.axis); GRID = hex(t.colors.chart.grid);
  PRIMARY = hex(t.colors.chart.primary); SERIES = t.colors.chart.series.map(hex);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Axis/value labels: compact, and in the chart's format ($412.5M when valueFormat is 'usd'). */
function label(n: number, format?: ChartBlock['valueFormat'], usdDecimals?: number): string {
  if (format === 'usd' || format === 'pct') return formatChartValue(n, format, usdDecimals);
  return compact(n);
}

/** One precision for every dollar label on a chart ($22.0M beside $22.5M). */
const chartUsdDecimals = (chart: ChartBlock) => usdColumnDecimals(chart.series.flatMap((s) => s.points.map((p) => p.y)));

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Word-wrap a label into lines of at most `maxChars` (a single longer word keeps its own line).
 * Labels are NEVER truncated: an agency or vendor name cut off with an ellipsis has no place in a
 * client document (A5, v3 review).
 */
export function wrapWords(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.trim().split(/\s+/)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** A multi-line SVG <text>: each line a <tspan> at the same x. `y` is the FIRST baseline. */
function multiText(x: number | string, y: number, lines: string[], attrs: string, lineH: number): string {
  return `<text x="${x}" y="${y.toFixed(1)}" ${attrs}>${lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineH}">${esc(l)}</tspan>`).join('')}</text>`;
}

export function chartToSvg(chart: ChartBlock, width = 640, theme: Theme = resolveTheme(undefined)): string {
  usePalette(theme);
  if (chart.kind === 'pie') return pieSvg(chart, width);
  return chart.kind === 'line' ? lineSvg(chart, width) : barSvg(chart, width);
}

/** Horizontal bars: category labels stay readable at any length. Multi-series bars are grouped. */
function barSvg(chart: ChartBlock, width: number): string {
  const cats = chart.series[0].points.map((p) => p.x);
  const multi = chart.series.length > 1;
  const barH = multi ? 12 : 18;
  const groupGap = 10;
  const LINE_H = 13;
  const wrapped = cats.map((c) => wrapWords(c, 32));
  const longest = Math.max(...wrapped.flat().map((l) => l.length), chart.xLabel ? chart.xLabel.length : 0);
  // ~6.3px per character at 11px, plus padding; bounded so the bars keep most of the width.
  const labelW = Math.min(250, Math.max(110, Math.round(longest * 6.3 + 16)));
  const valueW = 64;
  const rowH = wrapped.map((ls) => Math.max(barH * chart.series.length, ls.length * LINE_H) + groupGap);
  const rowTop: number[] = [];
  // Axis titles: the category axis title sits above the labels, the value axis title under the bars.
  const catTitleH = chart.xLabel ? 16 : 0;
  const valueTitleH = chart.yLabel ? 18 : 0;
  const top = (multi ? 28 : 8) + catTitleH;
  rowH.reduce((y, h, i) => { rowTop[i] = y; return y + h; }, top);
  const height = top + rowH.reduce((a, b) => a + b, 0) + 8 + valueTitleH;
  const plotW = width - labelW - valueW;
  const max = Math.max(0, ...chart.series.flatMap((s) => s.points.map((p) => p.y)));
  const scale = max > 0 ? plotW / max : 0;
  const parts: string[] = [];
  if (multi) {
    let lx = labelW;
    chart.series.forEach((s, i) => {
      parts.push(`<rect x="${lx}" y="6" width="10" height="10" fill="${SERIES[i % SERIES.length]}"/>`);
      parts.push(`<text x="${lx + 14}" y="15" font-size="11" fill="${INK}">${esc(s.name)}</text>`);
      lx += 24 + s.name.length * 6.2;
    });
  }
  cats.forEach((_cat, ci) => {
    const lines = wrapped[ci];
    const inner = rowH[ci] - groupGap;
    const barsH = barH * chart.series.length;
    const gy = rowTop[ci] + (inner - barsH) / 2; // bars centred in the row
    const firstBaseline = rowTop[ci] + (inner - lines.length * LINE_H) / 2 + 10;
    parts.push(multiText(labelW - 8, firstBaseline, lines, `font-size="11" text-anchor="end" fill="${INK}"`, LINE_H));
    chart.series.forEach((s, si) => {
      const v = s.points[ci]?.y ?? 0;
      const w = Math.max(v > 0 ? 1 : 0, v * scale);
      const y = gy + si * barH;
      parts.push(`<rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${barH - 3}" rx="2" fill="${multi ? SERIES[si % SERIES.length] : PRIMARY}"/>`);
      parts.push(`<text x="${labelW + w + 5}" y="${y + barH - 6}" font-size="10.5" fill="${MUTED}">${label(v, chart.valueFormat, chartUsdDecimals(chart))}</text>`);
    });
  });
  parts.push(`<line x1="${labelW}" y1="${top - 4}" x2="${labelW}" y2="${height - 6 - valueTitleH}" stroke="${AXIS}"/>`);
  if (chart.xLabel) parts.push(`<text x="${labelW - 8}" y="${top - 8}" font-size="10" font-weight="600" text-anchor="end" fill="${MUTED}">${esc(chart.xLabel)}</text>`);
  if (chart.yLabel) parts.push(`<text x="${labelW + plotW / 2}" y="${height - 4}" font-size="10" text-anchor="middle" fill="${MUTED}">${esc(chart.yLabel)}</text>`);
  return svgWrap(width, height, chart, parts);
}

function lineSvg(chart: ChartBlock, width: number): string {
  const left = 56;
  const right = 16;
  const top = chart.series.length > 1 ? 30 : 14;
  const xs = chart.series[0].points.map((p) => p.x);
  const xWrapped = xs.map((x) => wrapWords(x, 14));
  const xLines = Math.max(...xWrapped.map((l) => l.length));
  const bottom = 40 + (xLines - 1) * 11;
  const height = 260 + (xLines - 1) * 11;
  const all = chart.series.flatMap((s) => s.points.map((p) => p.y));
  const max = Math.max(...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const pw = width - left - right;
  const ph = height - top - bottom;
  const xAt = (i: number) => left + (xs.length === 1 ? pw / 2 : (i * pw) / (xs.length - 1));
  const yAt = (v: number) => top + ph - ((v - min) / span) * ph;
  const parts: string[] = [];
  for (let t = 0; t <= 4; t++) {
    const v = min + (span * t) / 4;
    const y = yAt(v);
    parts.push(`<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="${t === 0 ? AXIS : GRID}"/>`);
    parts.push(`<text x="${left - 6}" y="${(y + 4).toFixed(1)}" font-size="10" text-anchor="end" fill="${MUTED}">${label(v, chart.valueFormat, chartUsdDecimals(chart))}</text>`);
  }
  // Label spacing from the labels' real width, so adjacent labels ("FY26 Q3" / "FY26 Q4") never
  // overlap: ~6px per character at 10px, plus a gap.
  const labelPx = Math.max(...xWrapped.flat().map((l) => l.length)) * 6 + 12;
  const spacing = xs.length > 1 ? pw / (xs.length - 1) : pw;
  const step = Math.max(1, Math.ceil(labelPx / spacing));
  const lastIdx = xs.length - 1;
  xs.forEach((_x, i) => {
    // Every `step`-th label, plus the last one; drop a stepped label that would collide with the last.
    // The last label is end-anchored (its full width sits left of its point), so a centred
    // stepped label needs 1.5 label widths of clearance from it.
    const show = i === lastIdx || (i % step === 0 && (lastIdx - i) * spacing >= labelPx * 1.5);
    if (!show) return;
    const anchor = xs.length > 1 && i === lastIdx ? 'end' : i === 0 && xs.length > 1 ? 'start' : 'middle';
    parts.push(multiText(xAt(i).toFixed(1), height - bottom + 16, xWrapped[i], `font-size="10" text-anchor="${anchor}" fill="${MUTED}"`, 11));
  });
  let legendX = left;
  chart.series.forEach((s, si) => {
    const color = chart.series.length > 1 ? SERIES[si % SERIES.length] : PRIMARY;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`);
    s.points.forEach((p, i) => parts.push(`<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="2.6" fill="${color}"/>`));
    const lastP = s.points[s.points.length - 1];
    if (lastP) parts.push(`<text x="${Math.min(width - right, xAt(s.points.length - 1) + 4).toFixed(1)}" y="${(yAt(lastP.y) - 6).toFixed(1)}" font-size="10" text-anchor="end" fill="${color}">${label(lastP.y, chart.valueFormat, chartUsdDecimals(chart))}</text>`);
    if (chart.series.length > 1) {
      parts.push(`<rect x="${legendX}" y="6" width="10" height="10" fill="${color}"/>`);
      parts.push(`<text x="${legendX + 14}" y="15" font-size="11" fill="${INK}">${esc(s.name)}</text>`);
      legendX += 30 + s.name.length * 6.2;
    }
  });
  if (chart.yLabel) parts.push(`<text x="12" y="${top + ph / 2}" font-size="10" fill="${MUTED}" transform="rotate(-90 12 ${top + ph / 2})" text-anchor="middle">${esc(chart.yLabel)}</text>`);
  if (chart.xLabel) parts.push(`<text x="${left + (width - left - right) / 2}" y="${height - 2}" font-size="10" text-anchor="middle" fill="${MUTED}">${esc(chart.xLabel)}</text>`);
  return svgWrap(width, height, chart, parts);
}

function pieSvg(chart: ChartBlock, width: number): string {
  const pts = chart.series[0].points;
  const total = pts.reduce((n, p) => n + Math.max(0, p.y), 0);
  const r = 90;
  const cx = 120;
  const cy = 110;
  const legend = pts.map((p) => wrapWords(`${p.x} — ${total > 0 ? ((Math.max(0, p.y) / total) * 100).toFixed(1) : '0.0'}%`, 44));
  const legendTop: number[] = [];
  const legendEnd = legend.reduce((y, ls, i) => { legendTop[i] = y; return y + 8 + ls.length * 14; }, 14);
  const height = Math.max(230, legendEnd + 10);
  const parts: string[] = [];
  let a0 = -Math.PI / 2;
  pts.forEach((p, i) => {
    const frac = total > 0 ? Math.max(0, p.y) / total : 0;
    const color = SERIES[i % SERIES.length];
    if (frac >= 0.9999) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
    } else if (frac > 0) {
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      parts.push(`<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${color}" stroke="${WHITE}" stroke-width="1.5"/>`);
      a0 = a1;
    }
    const ly = legendTop[i] + 10;
    parts.push(`<rect x="250" y="${ly - 10}" width="12" height="12" fill="${color}"/>`);
    parts.push(multiText(268, ly, legend[i], `font-size="11.5" fill="${INK}"`, 14));
  });
  return svgWrap(width, height, chart, parts);
}

function svgWrap(width: number, height: number, chart: ChartBlock, parts: string[]): string {
  const title = chart.caption || chart.series.map((s) => s.name).join(', ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(title)}" font-family="Helvetica, Arial, sans-serif">${parts.join('')}</svg>`;
}
