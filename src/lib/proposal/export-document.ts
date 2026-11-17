/**
 * Export the Word-style proposal editor's document as PDF or Word (.docx), in the browser.
 *
 * Both builders read the SAME blocks (htmlToBlocks), so the two files say the same thing as the page.
 * Images are loaded by the caller-supplied `loadImage` (the editor routes remote images through
 * /api/app/proposal/image-proxy so the canvas is never tainted) and arrive as JPEG data URLs.
 *
 * jsPDF and docx are imported on demand, so the editor itself stays light.
 */
import { htmlToBlocks, type Block, type Run } from './editor-html';

export type DocFont = 'times' | 'arial';

export interface ExportSection { label: string; html: string }

export interface ExportInput {
  title: string;
  subtitle?: string;
  sections: ExportSection[];
  font: DocFont;
  fontSize: number; // points
  /** src → JPEG data URL + natural size, or null when the image can't be loaded (it is then skipped). */
  loadImage: (src: string) => Promise<LoadedImage | null>;
}

export interface LoadedImage { dataUrl: string; width: number; height: number }

const PT_PER_IN = 72;
const MARGIN = PT_PER_IN; // 1 inch
const MAX_IMAGE_H = 4 * PT_PER_IN;

/** Fit an image inside the text column, never taller than 4 inches. */
export function fitImage(w: number, h: number, maxW: number, maxH = MAX_IMAGE_H): { w: number; h: number } {
  if (!w || !h) return { w: maxW, h: maxW * 0.6 };
  let s = Math.min(1, maxW / w);
  if (h * s > maxH) s = maxH / h;
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

async function preloadImages(sections: ExportSection[], loadImage: ExportInput['loadImage']) {
  const blocksBySection = sections.map((s) => ({ label: s.label, blocks: htmlToBlocks(s.html) }));
  const srcs = new Set<string>();
  for (const s of blocksBySection) for (const b of s.blocks) if (b.kind === 'image' && b.src) srcs.add(b.src);
  const images = new Map<string, LoadedImage | null>();
  await Promise.all(Array.from(srcs).map(async (src) => {
    try { images.set(src, await loadImage(src)); } catch { images.set(src, null); }
  }));
  return { blocksBySection, images };
}

/* ───────────────────────────── PDF ───────────────────────────── */

export async function buildPdf(input: ExportInput): Promise<Blob> {
  const jsPDF = (await import('jspdf')).default;
  const { blocksBySection, images } = await preloadImages(input.sections, input.loadImage);
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const family = input.font === 'arial' ? 'helvetica' : 'times';
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const colW = pageW - MARGIN * 2;
  const bottom = pageH - MARGIN;
  let y = MARGIN;

  const style = (r: { bold?: boolean; italic?: boolean }) =>
    r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal';
  const ensure = (h: number) => { if (y + h > bottom) { pdf.addPage(); y = MARGIN; } };

  /** Lay out styled runs word by word inside [x, x+width], wrapping lines. */
  const writeRuns = (runs: Run[], size: number, x = MARGIN, width = colW, prefix?: string) => {
    const lineH = size * 1.4;
    pdf.setFontSize(size);
    type Piece = { text: string; run: Run; w: number };
    const lines: Piece[][] = [[]];
    let lineW = 0;
    const pieces: Array<Piece | 'br'> = [];
    for (const run of runs) {
      pdf.setFont(family, style(run));
      for (const part of run.text.split(/(\n| +)/)) {
        if (!part) continue;
        if (part === '\n') { pieces.push('br'); continue; }
        pieces.push({ text: part, run, w: pdf.getTextWidth(part) });
      }
    }
    for (const p of pieces) {
      if (p === 'br') { lines.push([]); lineW = 0; continue; }
      const isSpace = /^ +$/.test(p.text);
      const cur = lines[lines.length - 1];
      if (!isSpace && lineW + p.w > width && cur.length) { lines.push([]); lineW = 0; }
      const line = lines[lines.length - 1];
      if (isSpace && line.length === 0) continue;
      line.push(p);
      lineW += p.w;
    }
    lines.forEach((line, i) => {
      ensure(lineH);
      let cx = x;
      if (prefix && i === 0) {
        pdf.setFont(family, 'normal');
        pdf.text(prefix, x - 14, y + size);
      }
      // Draw consecutive pieces of the same style as ONE string, so the PDF's text copies and
      // searches as words and sentences rather than one word per drawing call.
      const groups: Array<{ text: string; run: Run; w: number }> = [];
      for (const p of line) {
        const g = groups[groups.length - 1];
        if (g && !!g.run.bold === !!p.run.bold && !!g.run.italic === !!p.run.italic && !!g.run.underline === !!p.run.underline) {
          g.text += p.text; g.w += p.w;
        } else groups.push({ text: p.text, run: p.run, w: p.w });
      }
      for (const g of groups) {
        const text = g.text.replace(/ +$/, '');
        pdf.setFont(family, style(g.run));
        pdf.text(text, cx, y + size);
        if (g.run.underline && text) pdf.line(cx, y + size + 1.5, cx + pdf.getTextWidth(text), y + size + 1.5);
        cx += g.w;
      }
      y += lineH;
    });
  };

  const writeBlock = (b: Block) => {
    const base = input.fontSize;
    if (b.kind === 'heading') {
      const size = b.level === 2 ? base + 3 : base + 1;
      y += size * 0.5;
      ensure(size * 2.4);
      writeRuns(b.runs.map((r) => ({ ...r, bold: true })), size);
      y += size * 0.2;
    } else if (b.kind === 'paragraph') {
      writeRuns(b.runs, base);
      y += base * 0.6;
    } else if (b.kind === 'list') {
      b.items.forEach((item, i) => writeRuns(item, base, MARGIN + 18, colW - 18, b.ordered ? `${i + 1}.` : '•'));
      y += base * 0.6;
    } else {
      const img = images.get(b.src);
      if (!img) return;
      const fit = fitImage(img.width, img.height, colW);
      ensure(fit.h + (b.caption ? base * 2.2 : base));
      pdf.addImage(img.dataUrl, 'JPEG', MARGIN + (colW - fit.w) / 2, y, fit.w, fit.h);
      y += fit.h + 6;
      if (b.caption) writeRuns([{ text: b.caption, italic: true }], Math.max(8, base - 2));
      y += base * 0.6;
    }
  };

  // Title
  writeRuns([{ text: input.title, bold: true }], input.fontSize + 8);
  if (input.subtitle) writeRuns([{ text: input.subtitle }], input.fontSize);
  y += input.fontSize;

  blocksBySection.forEach((s, i) => {
    if (!s.blocks.length) return;
    if (i > 0) y += input.fontSize * 0.6;
    ensure(input.fontSize * 4);
    writeRuns([{ text: s.label, bold: true }], input.fontSize + 5);
    y += input.fontSize * 0.4;
    s.blocks.forEach(writeBlock);
  });

  const pages = pdf.internal.pages.length - 1;
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont(family, 'normal');
    pdf.setFontSize(9);
    pdf.text(`Page ${p} of ${pages}`, pageW / 2, pageH - MARGIN / 2, { align: 'center' });
  }
  return pdf.output('blob');
}

/* ───────────────────────────── Word ───────────────────────────── */

function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function buildDocx(input: ExportInput): Promise<Blob> {
  const d = await import('docx');
  const { blocksBySection, images } = await preloadImages(input.sections, input.loadImage);
  const font = input.font === 'arial' ? 'Arial' : 'Times New Roman';
  const half = (pt: number) => Math.round(pt * 2);
  const colWpx = 6.5 * 96; // 6.5in text column at 96 px/in (docx sizes images in px)

  const runs = (rs: Run[], extra: { bold?: boolean; italics?: boolean; size?: number } = {}) => {
    const out: InstanceType<typeof d.TextRun>[] = [];
    for (const r of rs) {
      const parts = r.text.split('\n');
      parts.forEach((t, i) => out.push(new d.TextRun({
        text: t,
        break: i > 0 ? 1 : undefined,
        bold: r.bold || extra.bold,
        italics: r.italic || extra.italics,
        underline: r.underline ? {} : undefined,
        size: extra.size,
      })));
    }
    return out;
  };

  const children: InstanceType<typeof d.Paragraph>[] = [];
  children.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: runs([{ text: input.title }], { bold: true, size: half(input.fontSize + 8) }) }));
  if (input.subtitle) children.push(new d.Paragraph({ children: runs([{ text: input.subtitle }]) }));

  for (const s of blocksBySection) {
    if (!s.blocks.length) continue;
    children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: runs([{ text: s.label }], { bold: true, size: half(input.fontSize + 5) }) }));
    for (const b of s.blocks) {
      if (b.kind === 'heading') {
        children.push(new d.Paragraph({
          heading: b.level === 2 ? d.HeadingLevel.HEADING_2 : d.HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
          children: runs(b.runs, { bold: true, size: half(b.level === 2 ? input.fontSize + 3 : input.fontSize + 1) }),
        }));
      } else if (b.kind === 'paragraph') {
        children.push(new d.Paragraph({ spacing: { after: 120 }, children: runs(b.runs) }));
      } else if (b.kind === 'list') {
        for (const item of b.items) {
          children.push(new d.Paragraph(b.ordered
            ? { numbering: { reference: 'mindy-numbers', level: 0 }, children: runs(item) }
            : { bullet: { level: 0 }, children: runs(item) }));
        }
      } else {
        const img = images.get(b.src);
        if (!img) continue;
        const fit = fitImage(img.width, img.height, colWpx, 4 * 96);
        children.push(new d.Paragraph({
          alignment: d.AlignmentType.CENTER,
          children: [new d.ImageRun({ type: 'jpg', data: dataUrlBytes(img.dataUrl), transformation: { width: fit.w, height: fit.h } })],
        }));
        if (b.caption) children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { after: 160 }, children: runs([{ text: b.caption, italic: true }], { size: half(Math.max(8, input.fontSize - 2)) }) }));
      }
    }
  }

  const doc = new d.Document({
    creator: 'Mindy',
    title: input.title,
    styles: { default: { document: { run: { font, size: half(input.fontSize) } } } },
    numbering: {
      config: [{
        reference: 'mindy-numbers',
        levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: '%1.', alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: {
        default: new d.Footer({
          children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: ['Page ', d.PageNumber.CURRENT, ' of ', d.PageNumber.TOTAL_PAGES], size: 18 })] })],
        }),
      },
      children,
    }],
  });
  return d.Packer.toBlob(doc);
}

/** A safe file name from the proposal title. */
export function exportFileName(title: string, ext: 'pdf' | 'docx'): string {
  const base = (title || 'proposal').replace(/\.(pdf|docx|txt)$/i, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'proposal';
  return `${base}.${ext}`;
}
