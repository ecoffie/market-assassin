/**
 * build-whitepaper-docx.mjs — regenerate the distributable .docx from the
 * source-of-truth Markdown so the two never drift.
 *
 *   node scripts/build-whitepaper-docx.mjs
 *   (or: npm run build:whitepaper)
 *
 * Input:  docs/marketing/MCP-WHITEPAPER.md   (edit this — it's the source of truth)
 * Output: docs/marketing/Mindy-MCP-Whitepaper.docx
 *
 * Uses the `docx` package already in the repo (no pandoc / external binary needed).
 * Handles the whitepaper's Markdown subset: #/##/### headings, --- rules, pipe
 * tables, - bullet + 1. numbered lists, paragraphs, and inline **bold** / *italic* /
 * `code`. If the whitepaper starts using a construct not listed here, extend the
 * block parser below.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType,
} from 'docx';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = resolve(HERE, '../docs/marketing/MCP-WHITEPAPER.md');
const OUT = resolve(HERE, '../docs/marketing/Mindy-MCP-Whitepaper.docx');

const INK = '1A2233';
const ACCENT = '5B34D6';
const MUTED = '667085';
const CODEBG = 'EEF1F8';

/** Parse inline **bold** / *italic* / `code` into an array of TextRun. */
function runs(text, base = {}) {
  const out = [];
  // Tokenize on the three inline markers, longest first (** before *).
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    if (m[2] !== undefined) out.push(new TextRun({ text: m[2], bold: true, ...base }));
    else if (m[3] !== undefined) out.push(new TextRun({ text: m[3], font: 'Consolas', color: ACCENT, shading: { fill: CODEBG }, ...base }));
    else if (m[4] !== undefined) out.push(new TextRun({ text: m[4], italics: true, ...base }));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

function splitRow(line) {
  // "| a | b |" → ["a","b"] (trim the leading/trailing pipe first).
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}
const isTableSep = (line) => /^\s*\|?[\s:-]*-[-\s:|]*\|?\s*$/.test(line) && line.includes('-');

function tableFrom(lines) {
  const header = splitRow(lines[0]);
  const bodyRows = lines.slice(2).map(splitRow); // skip header + separator
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D5D9E4' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text, isHeader) =>
    new TableCell({
      borders,
      shading: isHeader ? { fill: 'F2F0FB' } : undefined,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [new Paragraph({ children: runs(text, isHeader ? { bold: true, color: INK } : {}) })],
    });
  const rows = [new TableRow({ tableHeader: true, children: header.map((h) => cell(h, true)) })];
  for (const r of bodyRows) {
    // pad/truncate to header width
    const cells = header.map((_, i) => cell(r[i] ?? '', false));
    rows.push(new TableRow({ children: cells }));
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

/** Parse the whole markdown into an array of docx block elements. */
function parse(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;

    // Horizontal rule.
    if (/^---+$/.test(t)) {
      blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D5D9E4', space: 8 } }, spacing: { before: 120, after: 120 }, children: [] }));
      continue;
    }
    // Headings.
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const heading = level === 1 ? HeadingLevel.TITLE : level === 2 ? HeadingLevel.HEADING_1 : level === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      blocks.push(new Paragraph({ heading, spacing: { before: level <= 2 ? 260 : 180, after: 100 }, children: runs(h[2], { color: level === 1 ? INK : level >= 3 ? MUTED : ACCENT }) }));
      continue;
    }
    // Table (header line + separator on the next line).
    if (t.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const tbl = [lines[i]];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith('|')) { tbl.push(lines[j]); j++; }
      blocks.push(tableFrom(tbl));
      blocks.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      i = j - 1;
      continue;
    }
    // Bullet list.
    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs(bullet[1]) }));
      continue;
    }
    // Numbered list — keep the marker as text (robust, no numbering config needed).
    const num = t.match(/^(\d+)\.\s+(.*)$/);
    if (num) {
      blocks.push(new Paragraph({ indent: { left: 360, hanging: 240 }, spacing: { after: 60 }, children: [new TextRun({ text: `${num[1]}.  `, bold: true }), ...runs(num[2])] }));
      continue;
    }
    // Blockquote.
    if (t.startsWith('>')) {
      blocks.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 100 }, children: runs(t.replace(/^>\s?/, ''), { italics: true, color: MUTED }) }));
      continue;
    }
    // Plain paragraph.
    blocks.push(new Paragraph({ spacing: { after: 120 }, children: runs(t) }));
  }
  return blocks;
}

const md = readFileSync(IN, 'utf8');
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: INK }, paragraph: { spacing: { line: 276 } } },
      title: { run: { size: 40, bold: true, color: INK }, paragraph: { spacing: { after: 120 } } },
      heading1: { run: { size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 100 } } },
      heading2: { run: { size: 25, bold: true, color: INK } },
      heading3: { run: { size: 21, bold: true, color: MUTED } },
    },
  },
  sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: parse(md) }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(OUT, buffer);
console.log(`✓ wrote ${OUT} (${(buffer.length / 1024).toFixed(1)} KB) from ${IN}`);
