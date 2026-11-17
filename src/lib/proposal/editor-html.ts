/**
 * Proposal editor document model (Word-style editor, 2026-11-17).
 *
 * The editor stores each section as a small, SAFE subset of HTML. This module is the one place that:
 *  - turns a drafted section (plain text with light markdown: `#` headings, `-`/`*` bullets,
 *    `1.` numbers, `**bold**`, `*italic*`) into that HTML,
 *  - sanitizes any HTML (paste, a saved draft, an inserted image) down to the allowed subset,
 *  - reads HTML back into plain text (the compliance scan, the .docx package export and the draft
 *    archive all keep working on text), and
 *  - reads HTML into export BLOCKS, the shared input of the PDF and Word builders.
 *
 * DOM-based (DOMParser); runs in the browser, and in tests under jsdom.
 */

export type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'list'; ordered: boolean; items: Run[][] }
  | { kind: 'image'; src: string; alt: string; caption: string };

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'br', 'figure', 'figcaption', 'img',
]);
/** Elements whose CONTENT is dropped with them (never unwrapped into text). */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'meta', 'link']);

/** Image sources the editor keeps: https URLs and inline raster data URLs (uploads). */
export function isAllowedImageSrc(src: string): boolean {
  const s = src.trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return true;
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `**bold**` and `*italic*` / `_italic_` inside one line → escaped inline HTML. */
function inlineMarkdown(line: string): string {
  let out = escapeHtml(line);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return out;
}

/** A drafted section (plain text / light markdown) → editor HTML. */
export function textToHtml(text: string): string {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMarkdown).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${list.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join('')}</${tag}>`);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const level = Math.min(3, Math.max(2, h[1].length));
      out.push(`<h${level}>${inlineMarkdown(h[2].replace(/\s*#+\s*$/, ''))}</h${level}>`);
      continue;
    }
    const b = /^\s*[-*•]\s+(.*)$/.exec(line);
    const n = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (b || n) {
      flushPara();
      const ordered = !!n;
      const lst = list as { ordered: boolean; items: string[] } | null;
      if (!lst || lst.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      (list as unknown as { items: string[] }).items.push((b ? b[1] : n![1]).trim());
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('');
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
}

/**
 * Keep only the editor's subset. Unknown tags are UNWRAPPED (their text stays); dangerous ones are
 * dropped with their content; every attribute is removed except `src`/`alt` on an allowed image.
 * Headings collapse to h2/h3 (h1 is reserved for nothing in a section body), and divs become paragraphs.
 */
export function sanitizeEditorHtml(html: string): string {
  const doc = parse(html);
  const clean = (node: Node, into: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { into.appendChild(doc.createTextNode(child.textContent || '')); continue; }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      let tag = el.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) continue;
      if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'blockquote') tag = 'p';
      if (tag === 'h1' || tag === 'h4' || tag === 'h5' || tag === 'h6') tag = tag === 'h1' ? 'h2' : 'h3';
      if (!ALLOWED_TAGS.has(tag)) { clean(el, into); continue; }
      if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        if (!isAllowedImageSrc(src)) continue;
        const img = doc.createElement('img');
        img.setAttribute('src', src.trim());
        img.setAttribute('alt', (el.getAttribute('alt') || '').slice(0, 300));
        into.appendChild(img);
        continue;
      }
      const out = doc.createElement(tag);
      clean(el, out);
      into.appendChild(out);
    }
  };
  const root = doc.createElement('div');
  clean(doc.body, root);
  // A paragraph nested in a paragraph (from an unwrapped div) is invalid; flatten to siblings.
  for (const p of Array.from(root.querySelectorAll('p p'))) {
    const parent = p.parentElement!;
    parent.parentNode!.insertBefore(p, parent.nextSibling);
  }
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (!p.textContent?.trim() && !p.querySelector('img,br')) p.remove();
  }
  return root.innerHTML;
}

function runsOf(el: Node, style: Omit<Run, 'text'> = {}): Run[] {
  const runs: Run[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      const t = (child.textContent || '').replace(/\s+/g, ' ');
      if (t) runs.push({ text: t, ...style });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = (child as Element).tagName.toLowerCase();
    if (tag === 'br') { runs.push({ text: '\n', ...style }); continue; }
    if (tag === 'img') continue;
    const next = { ...style };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italic = true;
    if (tag === 'u') next.underline = true;
    runs.push(...runsOf(child, next));
  }
  return runs;
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.filter((r) => r.text.length > 0);
  if (out.length) {
    out[0] = { ...out[0], text: out[0].text.replace(/^ +/, '') };
    const last = out.length - 1;
    out[last] = { ...out[last], text: out[last].text.replace(/ +$/, '') };
  }
  return out.filter((r) => r.text.length > 0);
}

/** Editor HTML → export blocks (headings, paragraphs, lists, images with captions). */
export function htmlToBlocks(html: string): Block[] {
  const doc = parse(sanitizeEditorHtml(html));
  const blocks: Block[] = [];
  const pushPara = (runs: Run[]) => {
    const r = trimRuns(runs);
    if (r.length && r.some((x) => x.text.trim())) blocks.push({ kind: 'paragraph', runs: r });
  };
  let loose: Run[] = [];
  const flushLoose = () => { pushPara(loose); loose = []; };
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === 3) { loose.push(...runsOf({ childNodes: [node] } as unknown as Node)); continue; }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'u' || tag === 'br') {
      loose.push(...runsOf({ childNodes: [el] } as unknown as Node));
      continue;
    }
    flushLoose();
    if (tag === 'h2' || tag === 'h3') {
      const r = trimRuns(runsOf(el));
      if (r.length) blocks.push({ kind: 'heading', level: tag === 'h2' ? 2 : 3, runs: r });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.querySelectorAll(':scope > li')).map((li) => trimRuns(runsOf(li))).filter((r) => r.length);
      if (items.length) blocks.push({ kind: 'list', ordered: tag === 'ol', items });
    } else if (tag === 'figure' || tag === 'img') {
      const img = tag === 'img' ? el : el.querySelector('img');
      if (img) {
        blocks.push({
          kind: 'image',
          src: img.getAttribute('src') || '',
          alt: img.getAttribute('alt') || '',
          caption: (el.querySelector('figcaption')?.textContent || '').replace(/\s+/g, ' ').trim(),
        });
      }
    } else {
      // A paragraph may hold an image (pasted inline): split it out.
      const imgs = Array.from(el.querySelectorAll('img'));
      pushPara(runsOf(el));
      for (const img of imgs) {
        blocks.push({ kind: 'image', src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '', caption: '' });
      }
    }
  }
  flushLoose();
  return blocks;
}

const runText = (runs: Run[]) => runs.map((r) => r.text).join('');

/** Editor HTML → plain text with light markdown (what the scan, package export and archive read). */
export function htmlToText(html: string): string {
  return htmlToBlocks(html).map((b) => {
    if (b.kind === 'heading') return `${'#'.repeat(b.level)} ${runText(b.runs)}`;
    if (b.kind === 'paragraph') return runText(b.runs);
    if (b.kind === 'list') return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${runText(it)}`).join('\n');
    return b.caption ? `[Image: ${b.caption}]` : '[Image]';
  }).join('\n\n');
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9][\w'’-]*/g) || []).length;
}

/** The `<figure>` the editor inserts for a picked or uploaded image. */
export function figureHtml(src: string, alt: string, caption: string): string {
  if (!isAllowedImageSrc(src)) return '';
  const cap = caption.trim() ? `<figcaption>${escapeHtml(caption.trim())}</figcaption>` : '';
  return `<figure><img src="${escapeHtml(src.trim())}" alt="${escapeHtml(alt)}">${cap}</figure><p><br></p>`;
}
