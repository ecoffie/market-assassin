/**
 * MRR Blocks 3 + 8 — anchor-based .docx fill.
 *
 * The uploaded template has ZERO Word content controls (`<w:sdt>` count = 0,
 * measured), so there are no named slots to bind. We therefore locate content by
 * validated HEADING and TABLE anchors and edit `word/document.xml` on a COPY.
 *
 * Two hard rules:
 *  1. The source template is NEVER modified. Every operation reads it into memory
 *     and writes a new file; `assertTemplateUnchanged()` re-hashes it afterwards.
 *  2. The ZIP round-trip preserves EVERY untouched part and relationship. We
 *     unzip all entries, replace exactly one (`word/document.xml`), and re-zip
 *     the complete set — styles, numbering, comments, footnotes, and _rels
 *     survive byte-identical. Rebuilding a document from scratch would lose
 *     Ralph's formatting, which is the one thing the template exists to supply.
 *
 * `docx@9.6.1` (already a dependency) BUILDS documents; it cannot load-and-fill
 * an existing one. `unzipper@0.12.3` (also present) is read-only — no writer.
 * Hence `fflate`, added as a direct dependency for the write half.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';

/** The vendored prototype template, byte-identical to the source supplied for this build. */
export const TEMPLATE_PATH = 'src/lib/mrr/templates/mrr-rfo-may-2026-prototype.docx';
export const TEMPLATE_SHA256 = 'a40251bb9a4dcad91be817e3d943b365f6257670ac4d821868ea5084b74c0f86';

/**
 * The template self-identifies as a "rebuilt editable copy", so nothing generated
 * from it may present as a signable government determination.
 */
export const PROTOTYPE_BANNER = 'PROTOTYPE — NOT FOR SIGNATURE';

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Throws if the source template drifted. Call before AND after every fill. */
export function assertTemplateUnchanged(path: string = TEMPLATE_PATH): void {
  const actual = sha256File(path);
  if (actual !== TEMPLATE_SHA256) {
    throw new Error(`Template hash mismatch for ${path}: expected ${TEMPLATE_SHA256}, got ${actual}`);
  }
}

export type DocxParts = Record<string, Uint8Array>;

/** Read every ZIP entry into memory. The source file is opened read-only. */
export function readDocxParts(path: string = TEMPLATE_PATH): DocxParts {
  return unzipSync(readFileSync(path));
}

export function getDocumentXml(parts: DocxParts): string {
  const entry = parts['word/document.xml'];
  if (!entry) throw new Error('word/document.xml missing from docx archive');
  return new TextDecoder().decode(entry);
}

/** Write all parts back out, replacing only document.xml. Every other part is passed through. */
export function writeDocx(parts: DocxParts, documentXml: string, outPath: string): void {
  const next: DocxParts = { ...parts, 'word/document.xml': new TextEncoder().encode(documentXml) };
  writeFileSync(outPath, zipSync(next, { level: 6 }));
}

/** XML-escape a value destined for a `<w:t>` run. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Split the body into ordered top-level blocks (paragraphs and tables). */
export function splitBlocks(documentXml: string): string[] {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml);
  if (!body) throw new Error('no <w:body> in document.xml');
  return body[1].match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g) ?? [];
}

/** Concatenated visible text of one block. */
export function blockText(block: string): string {
  return (block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
    .map((t) => t.replace(/<[^>]+>/g, ''))
    .join('')
    .trim();
}

/**
 * Find the index of the single block whose visible text starts with `anchor`.
 * Throws when absent or ambiguous — a fill that silently no-ops is the
 * "edit command succeeds without the intended change" silent-failure class.
 */
export function findAnchorIndex(blocks: string[], anchor: string): number {
  const hits: number[] = [];
  blocks.forEach((b, i) => {
    if (blockText(b).startsWith(anchor)) hits.push(i);
  });
  if (hits.length === 0) throw new Error(`anchor not found: ${JSON.stringify(anchor)}`);
  if (hits.length > 1) throw new Error(`anchor ambiguous (${hits.length} matches): ${JSON.stringify(anchor)}`);
  return hits[0];
}

/** Index of the first table at/after `from`. */
export function findTableIndexAfter(blocks: string[], from: number): number {
  for (let i = from; i < blocks.length; i++) if (blocks[i].startsWith('<w:tbl')) return i;
  throw new Error(`no table found after block ${from}`);
}

/** Replace the body's block list, preserving everything outside <w:body>. */
export function rebuildDocumentXml(documentXml: string, blocks: string[]): string {
  const m = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml);
  if (!m) throw new Error('no <w:body> in document.xml');
  // Trailing sectPr (page setup) lives after the last block — preserve it verbatim.
  const tail = /<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/.exec(m[1]);
  return documentXml.replace(
    /<w:body>[\s\S]*<\/w:body>/,
    `<w:body>${blocks.join('')}${tail ? tail[0] : ''}</w:body>`,
  );
}

const RPR = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>';

/** A plain body paragraph matching the template's Times New Roman body style. */
export function paragraph(text: string, opts: { bold?: boolean } = {}): string {
  const rpr = opts.bold
    ? RPR.replace('<w:sz', '<w:b/><w:bCs/><w:sz')
    : RPR;
  return `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

/** One table cell at the template's 9pt table scale. */
const TABLE_RPR = (bold: boolean) =>
  `<w:rPr><w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"/>${bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`;

/** One table cell. `align:'right'` keeps currency columns from ragged-left drift. */
export function tableCell(
  text: string,
  widthDxa: number,
  opts: { bold?: boolean; align?: 'left' | 'right' } = {},
): string {
  const jc = opts.align === 'right' ? '<w:jc w:val="right"/>' : '';
  return (
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${widthDxa}"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0"/>${jc}</w:pPr><w:r>` +
    TABLE_RPR(!!opts.bold) +
    `<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p></w:tc>`
  );
}

/**
 * A cell holding a labelled, clickable external hyperlink.
 *
 * A raw USASpending URL runs ~90 characters and forces the contract column absurdly
 * wide (it was the widest thing on the page). A short label keeps the row readable
 * while staying fully traceable — the URL is still in the file, as a relationship.
 */
export function tableCellLink(
  prefix: string,
  label: string,
  relId: string,
  widthDxa: number,
): string {
  const pre = prefix
    ? `<w:r>${TABLE_RPR(false)}<w:t xml:space="preserve">${xmlEscape(prefix)}</w:t></w:r>` +
      `<w:r>${TABLE_RPR(false)}<w:br/></w:r>`
    : '';
  return (
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${widthDxa}"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${pre}` +
    `<w:hyperlink r:id="${relId}">` +
    `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"/>` +
    `<w:color w:val="0563C1"/><w:u w:val="single"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>` +
    `<w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r></w:hyperlink></w:p></w:tc>`
  );
}

/**
 * A table row.
 *
 * `header`    → `w:tblHeader`, so Word REPEATS the header at the top of every page.
 * `cantSplit` → forbids breaking the row across a page boundary.
 *
 * Both were missing. The LibreOffice render showed the consequence directly: pages
 * 4-7 each opened on the torn remains of the previous page's award, with no column
 * headings to read them against.
 */
export function tableRow(cells: string[], opts: { header?: boolean; cantSplit?: boolean } = {}): string {
  const props =
    opts.header || opts.cantSplit
      ? `<w:trPr>${opts.cantSplit ? '<w:cantSplit/>' : ''}${opts.header ? '<w:tblHeader/>' : ''}</w:trPr>`
      : '';
  return `<w:tr>${props}${cells.join('')}</w:tr>`;
}

/** Add trPr flags to an EXISTING row (the template ships its own §9 header row). */
export function withRowProps(rowXml: string, opts: { header?: boolean; cantSplit?: boolean } = {}): string {
  const flags = `${opts.cantSplit ? '<w:cantSplit/>' : ''}${opts.header ? '<w:tblHeader/>' : ''}`;
  if (!flags) return rowXml;
  if (rowXml.includes('<w:trPr>')) return rowXml.replace('<w:trPr>', `<w:trPr>${flags}`);
  return rowXml.replace(/^<w:tr(\s[^>]*)?>/, (m) => `${m}<w:trPr>${flags}</w:trPr>`);
}

/**
 * Register external hyperlink relationships in word/_rels/document.xml.rels and
 * return the assigned rIds. Without the relationship the r:id dangles and Word
 * reports the file as corrupt.
 */
export function addHyperlinks(parts: DocxParts, urls: string[]): string[] {
  const relPath = 'word/_rels/document.xml.rels';
  const entry = parts[relPath];
  if (!entry) throw new Error(`${relPath} missing from docx archive`);
  let xml = new TextDecoder().decode(entry);
  const existing = [...xml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  let next = (existing.length ? Math.max(...existing) : 0) + 1;
  const ids: string[] = [];
  const add: string[] = [];
  for (const url of urls) {
    const id = `rId${next++}`;
    ids.push(id);
    add.push(
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(url)}" TargetMode="External"/>`,
    );
  }
  xml = xml.replace('</Relationships>', `${add.join('')}</Relationships>`);
  parts[relPath] = new TextEncoder().encode(xml);
  return ids;
}

export function tableRows(tableXml: string): string[] {
  return tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
}

/** Rebuild a table from its opening properties plus a new row list. */
export function rebuildTable(tableXml: string, rows: string[]): string {
  const firstRow = tableXml.indexOf('<w:tr');
  if (firstRow < 0) throw new Error('table has no rows');
  const head = tableXml.slice(0, firstRow);
  return `${head}${rows.join('')}</w:tbl>`;
}

/**
 * Rewrite a table's `<w:tblGrid>` AND every existing row's `<w:tcW>` to one width set.
 *
 * A table carries its column widths in THREE places — the grid, each cell's `tcW`,
 * and (optionally) `tblW`. Word and LibreOffice resolve the GRID first, so setting
 * only the body cells' `tcW` changes nothing: the MRR emitted body widths of
 * 2500/1000/900/900/1860/2200 while the grid still said 1000 for Amount, and
 * LibreOffice duly split `$1,205,937,998` into `$1,205,93` + `7,998`.
 *
 * Applying the same widths to all three keeps the column geometry unambiguous.
 */
export function setTableWidths(tableXml: string, widths: number[]): string {
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  let out = /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.test(tableXml)
    ? tableXml.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, grid)
    : tableXml.replace(/(<\/w:tblPr>)/, `$1${grid}`);

  // Per-row: rewrite the i-th cell's tcW to the i-th width.
  out = out.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    let i = 0;
    return row.replace(/<w:tcW\b[^/]*\/>/g, () => {
      const w = widths[i] ?? widths[widths.length - 1];
      i += 1;
      return `<w:tcW w:type="dxa" w:w="${w}"/>`;
    });
  });
  return out;
}

/**
 * A currency cell: the figure is emitted in its OWN paragraph with
 * `<w:suppressAutoHyphens/>` and no internal break opportunity, so the complete
 * token stays on one line; the source label wraps freely in a second paragraph.
 */
export function tableCellAmount(figure: string, label: string, widthDxa: number): string {
  const rpr = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>`;
  // NO-BREAK the figure: every space inside it becomes a non-breaking space and the
  // paragraph suppresses hyphenation, so the renderer cannot split it mid-number.
  const nb = figure.replace(/ /g, ' ');
  return (
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${widthDxa}"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:after="0"/><w:suppressAutoHyphens/><w:jc w:val="right"/></w:pPr>` +
    `<w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(nb)}</w:t></w:r></w:p>` +
    (label
      ? `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr>` +
        `<w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(label)}</w:t></w:r></w:p>`
      : '') +
    `</w:tc>`
  );
}
