/**
 * ChartBlock → SVG, as a pure string (no chart library, no DOM). The HTML/PDF renderer inlines it;
 * Chromium draws SVG natively, so PDF charts are vector and crisp.
 *
 * Design: one hue for single-series magnitude charts, a small validated categorical palette only
 * when there is more than one series, direct value labels, no gridline clutter.
 */
import type { ChartBlock } from './model';

const INK = '#1f2937';
const MUTED = '#6b7280';
const AXIS = '#d1d5db';
const PRIMARY = '#1e3a8a';
const SERIES = ['#1e3a8a', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#4b5563'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function chartToSvg(chart: ChartBlock, width = 640): string {
  if (chart.kind === 'pie') return pieSvg(chart, width);
  return chart.kind === 'line' ? lineSvg(chart, width) : barSvg(chart, width);
}

/** Horizontal bars: category labels stay readable at any length. Multi-series bars are grouped. */
function barSvg(chart: ChartBlock, width: number): string {
  const cats = chart.series[0].points.map((p) => p.x);
  const multi = chart.series.length > 1;
  const barH = multi ? 12 : 18;
  const groupGap = 10;
  const groupH = barH * chart.series.length + groupGap;
  const labelW = 190;
  const valueW = 64;
  const top = multi ? 28 : 8;
  const height = top + cats.length * groupH + 8;
  const plotW = width - labelW - valueW;
  const max = Math.max(0, ...chart.series.flatMap((s) => s.points.map((p) => p.y)));
  const scale = max > 0 ? plotW / max : 0;
  const parts: string[] = [];
  if (multi) {
    let lx = labelW;
    chart.series.forEach((s, i) => {
      parts.push(`<rect x="${lx}" y="6" width="10" height="10" fill="${SERIES[i % SERIES.length]}"/>`);
      parts.push(`<text x="${lx + 14}" y="15" font-size="11" fill="${INK}">${esc(truncate(s.name, 28))}</text>`);
      lx += 24 + Math.min(28, s.name.length) * 6.2;
    });
  }
  cats.forEach((cat, ci) => {
    const gy = top + ci * groupH;
    parts.push(`<text x="${labelW - 8}" y="${gy + (barH * chart.series.length) / 2 + 4}" font-size="11" text-anchor="end" fill="${INK}">${esc(truncate(cat, 30))}</text>`);
    chart.series.forEach((s, si) => {
      const v = s.points[ci]?.y ?? 0;
      const w = Math.max(v > 0 ? 1 : 0, v * scale);
      const y = gy + si * barH;
      parts.push(`<rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${barH - 3}" rx="2" fill="${multi ? SERIES[si % SERIES.length] : PRIMARY}"/>`);
      parts.push(`<text x="${labelW + w + 5}" y="${y + barH - 6}" font-size="10.5" fill="${MUTED}">${compact(v)}</text>`);
    });
  });
  parts.push(`<line x1="${labelW}" y1="${top - 4}" x2="${labelW}" y2="${height - 6}" stroke="${AXIS}"/>`);
  return svgWrap(width, height, chart, parts);
}

function lineSvg(chart: ChartBlock, width: number): string {
  const height = 260;
  const left = 56;
  const right = 16;
  const top = chart.series.length > 1 ? 30 : 14;
  const bottom = 40;
  const xs = chart.series[0].points.map((p) => p.x);
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
    parts.push(`<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="${t === 0 ? AXIS : '#f1f5f9'}"/>`);
    parts.push(`<text x="${left - 6}" y="${(y + 4).toFixed(1)}" font-size="10" text-anchor="end" fill="${MUTED}">${compact(v)}</text>`);
  }
  const step = Math.max(1, Math.ceil(xs.length / 8));
  const lastIdx = xs.length - 1;
  xs.forEach((x, i) => {
    // Every `step`-th label, plus the last one; drop a stepped label that would collide with the last.
    const show = i === lastIdx || (i % step === 0 && lastIdx - i >= Math.max(1, step / 2));
    if (!show) return;
    const anchor = xs.length > 1 && i === lastIdx ? 'end' : i === 0 && xs.length > 1 ? 'start' : 'middle';
    parts.push(`<text x="${xAt(i).toFixed(1)}" y="${height - bottom + 16}" font-size="10" text-anchor="${anchor}" fill="${MUTED}">${esc(truncate(x, 12))}</text>`);
  });
  chart.series.forEach((s, si) => {
    const color = chart.series.length > 1 ? SERIES[si % SERIES.length] : PRIMARY;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>`);
    s.points.forEach((p, i) => parts.push(`<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="2.6" fill="${color}"/>`));
    const lastP = s.points[s.points.length - 1];
    if (lastP) parts.push(`<text x="${Math.min(width - right, xAt(s.points.length - 1) + 4).toFixed(1)}" y="${(yAt(lastP.y) - 6).toFixed(1)}" font-size="10" text-anchor="end" fill="${color}">${compact(lastP.y)}</text>`);
    if (chart.series.length > 1) {
      parts.push(`<rect x="${left + si * 150}" y="6" width="10" height="10" fill="${color}"/>`);
      parts.push(`<text x="${left + si * 150 + 14}" y="15" font-size="11" fill="${INK}">${esc(truncate(s.name, 20))}</text>`);
    }
  });
  if (chart.yLabel) parts.push(`<text x="12" y="${top + ph / 2}" font-size="10" fill="${MUTED}" transform="rotate(-90 12 ${top + ph / 2})" text-anchor="middle">${esc(chart.yLabel)}</text>`);
  return svgWrap(width, height, chart, parts);
}

function pieSvg(chart: ChartBlock, width: number): string {
  const pts = chart.series[0].points;
  const total = pts.reduce((n, p) => n + Math.max(0, p.y), 0);
  const r = 90;
  const cx = 120;
  const cy = 110;
  const height = Math.max(230, 30 + pts.length * 22);
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
      parts.push(`<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`);
      a0 = a1;
    }
    const ly = 24 + i * 22;
    parts.push(`<rect x="250" y="${ly - 10}" width="12" height="12" fill="${color}"/>`);
    parts.push(`<text x="268" y="${ly}" font-size="11.5" fill="${INK}">${esc(truncate(p.x, 40))} — ${total > 0 ? ((Math.max(0, p.y) / total) * 100).toFixed(1) : '0.0'}%</text>`);
  });
  return svgWrap(width, height, chart, parts);
}

function svgWrap(width: number, height: number, chart: ChartBlock, parts: string[]): string {
  const title = chart.caption || chart.series.map((s) => s.name).join(', ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(title)}" font-family="Helvetica, Arial, sans-serif">${parts.join('')}</svg>`;
}
