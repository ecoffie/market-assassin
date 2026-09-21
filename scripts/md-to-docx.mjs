#!/usr/bin/env node
/**
 * md-to-docx.mjs — minimal, dependency-light Markdown → .docx converter for
 * marketing whitepapers. Handles the subset this repo's whitepapers use:
 *   headings (levels 1-3), paragraphs with bold / italic / inline-code, GFM
 *   tables, bullet lists, blockquotes, horizontal rules, fenced code blocks.
 *
 * Usage: node scripts/md-to-docx.mjs <input.md> <output.docx>
 * Uses the already-installed `docx` package (no new deps).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType,
} from 'docx';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: md-to-docx.mjs <in.md> <out.docx>'); process.exit(1); }

const NAVY = '1e3a8a';
const PURPLE = '6d28d9';
const INK = '1f2937';
const GRAY = '6b7280';
const HEADER_BG = 'f1effa';
const RULE = 'd1d5db';

/** Inline parse: **bold**, *italic*, `code`. Returns TextRun[]. */
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m;
  const push = (t, extra) => { if (t) out.push(new TextRun({ text: t, ...base, ...extra })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) push(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith('`')) push(tok.slice(1, -1), { font: 'Consolas', color: PURPLE });
    else push(tok.slice(1, -1), { italics: true });
    last = re.lastIndex;
  }
  push(text.slice(last));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

function splitRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

function table(headers, rows) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' };
  const borders = { top: border, bottom: border, left: border, right: border,
    insideHorizontal: border, insideVertical: border };
  const cell = (text, opts = {}) => new TableCell({
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    shading: opts.header ? { type: ShadingType.CLEAR, fill: HEADER_BG } : undefined,
    children: [new Paragraph({ children: runs(text, opts.header ? { bold: true, color: NAVY, size: 19 } : { size: 19, color: INK }) })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => cell(h, { header: true })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

const md = readFileSync(inPath, 'utf8').split('\n');
const children = [];
let i = 0;
while (i < md.length) {
  const line = md[i];

  if (/^\s*$/.test(line)) { i++; continue; }

  // horizontal rule
  if (/^---+\s*$/.test(line)) {
    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } }, spacing: { after: 160 } }));
    i++; continue;
  }

  // headings
  const h = line.match(/^(#{1,3})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    const map = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
    const size = { 1: 40, 2: 28, 3: 22 }[level];
    const color = { 1: NAVY, 2: PURPLE, 3: INK }[level];
    children.push(new Paragraph({
      heading: map[level],
      spacing: { before: level === 1 ? 0 : 260, after: 120 },
      children: runs(h[2], { bold: true, color, size }),
    }));
    i++; continue;
  }

  // table (header row followed by a |---| separator)
  if (line.trim().startsWith('|') && md[i + 1] && /^\s*\|?[\s:-]+\|/.test(md[i + 1]) && md[i + 1].includes('-')) {
    const headers = splitRow(line);
    i += 2;
    const rows = [];
    while (i < md.length && md[i].trim().startsWith('|')) { rows.push(splitRow(md[i])); i++; }
    children.push(table(headers, rows));
    children.push(new Paragraph({ spacing: { after: 120 } }));
    continue;
  }

  // fenced code
  if (line.trim().startsWith('```')) {
    i++;
    const code = [];
    while (i < md.length && !md[i].trim().startsWith('```')) { code.push(md[i]); i++; }
    i++;
    children.push(new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: '0b1020' },
      spacing: { before: 60, after: 160 },
      children: [new TextRun({ text: code.join('\n'), font: 'Consolas', size: 19, color: '7ee7c7' })],
    }));
    continue;
  }

  // blockquote
  if (line.startsWith('>')) {
    children.push(new Paragraph({
      indent: { left: 240 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: PURPLE, space: 12 } },
      spacing: { after: 120 },
      children: runs(line.replace(/^>\s?/, ''), { italics: true, color: GRAY }),
    }));
    i++; continue;
  }

  // bullet list
  if (/^\s*-\s+/.test(line)) {
    while (i < md.length && /^\s*-\s+/.test(md[i])) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs(md[i].replace(/^\s*-\s+/, ''), { size: 21, color: INK }) }));
      i++;
    }
    continue;
  }

  // plain paragraph (join wrapped lines until blank/structural)
  const buf = [line];
  i++;
  while (i < md.length && md[i].trim() && !/^(#{1,3}\s|>|\s*-\s|\|)/.test(md[i]) && !/^---+\s*$/.test(md[i]) && !md[i].trim().startsWith('```')) {
    buf.push(md[i]); i++;
  }
  const text = buf.join(' ');
  // subtitle (### was handled above); a lone italic *…* line becomes the deck subtitle styling
  children.push(new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.LEFT, children: runs(text, { size: 21, color: INK }) }));
}

const doc = new Document({
  styles: { default: { document: { run: { font: 'Calibri', color: INK } } } },
  sections: [{
    properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } },
    children,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outPath, buf);
console.log(`wrote ${outPath} (${(buf.length / 1024).toFixed(0)} KB, ${children.length} blocks)`);
