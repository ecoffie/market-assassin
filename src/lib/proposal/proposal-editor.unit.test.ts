// @vitest-environment jsdom
/**
 * Word-style proposal editor (2026-11-17): the document model, the export builders and the image
 * search parsers. Export runs headless here (jsPDF / docx), with a real 1x1 JPEG as the image.
 */
import { describe, expect, it } from 'vitest';
import {
  countWords, figureHtml, htmlToBlocks, htmlToText, isAllowedImageSrc, sanitizeEditorHtml, textToHtml,
} from './editor-html';
import { buildDocx, buildPdf, exportFileName, fitImage } from './export-document';
import {
  creditLine, isCommercialSafeLicense, isProxyableImageUrl, mergeResults, parseOpenverse, parseWikimedia,
} from './image-search';
import { parseChatLines } from './chat-stream';

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('editor document model', () => {
  it('turns a drafted section (light markdown) into editor html', () => {
    const html = textToHtml('## Approach\nWe will **blast** the hull.\n\n- Anodes\n- Sea chests\n\n1. Dock\n2. Undock\n<script>x</script>');
    expect(html).toContain('<h2>Approach</h2>');
    expect(html).toContain('<strong>blast</strong>');
    expect(html).toContain('<ul><li>Anodes</li><li>Sea chests</li></ul>');
    expect(html).toContain('<ol><li>Dock</li><li>Undock</li></ol>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sanitizes paste and saved html down to the safe subset', () => {
    const dirty = '<div style="color:red" onclick="x()"><h1>T</h1><p>Hi <b>there</b> <a href="javascript:alert(1)">link</a></p>'
      + '<script>alert(1)</script><img src="javascript:alert(1)"><img src="https://upload.wikimedia.org/a.jpg" onerror="x()" alt="A">'
      + '<iframe src="https://evil"></iframe><span style="x">kept text</span></div>';
    const clean = sanitizeEditorHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|onerror|style=|javascript:|iframe|<a |<div|<span/i);
    expect(clean).toContain('<h2>T</h2>');
    expect(clean).toContain('<b>there</b>');
    expect(clean).toContain('link');
    expect(clean).toContain('kept text');
    expect(clean).toContain('<img src="https://upload.wikimedia.org/a.jpg" alt="A">');
  });

  it('accepts only https and raster data-url images', () => {
    expect(isAllowedImageSrc('https://x.org/a.png')).toBe(true);
    expect(isAllowedImageSrc(JPEG_1PX)).toBe(true);
    expect(isAllowedImageSrc('http://x.org/a.png')).toBe(false);
    expect(isAllowedImageSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isAllowedImageSrc('javascript:alert(1)')).toBe(false);
    expect(figureHtml('javascript:alert(1)', '', '')).toBe('');
  });

  it('reads html back into blocks and plain text (what the scan and package export read)', () => {
    const html = '<h2>Plan</h2><p>Hello <strong>bold</strong> and <em>it</em>.</p><ul><li>One</li><li>Two</li></ul>'
      + figureHtml('https://upload.wikimedia.org/a.jpg', 'Cutter', 'Photo: USCG (Public domain)');
    const blocks = htmlToBlocks(html);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'image']);
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', runs: [{ text: 'Hello ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'it', italic: true }, { text: '.' }] });
    expect(blocks[3]).toMatchObject({ kind: 'image', caption: 'Photo: USCG (Public domain)' });
    const text = htmlToText(html);
    expect(text).toBe('## Plan\n\nHello bold and it.\n\n- One\n- Two\n\n[Image: Photo: USCG (Public domain)]');
    expect(countWords(text)).toBeGreaterThan(5);
  });

  it('round-trips a draft: text → html → text keeps the words', () => {
    const draft = '## Technical Approach\nOur team will complete the work in 90 days.\n\n- Phase one\n- Phase two';
    expect(htmlToText(textToHtml(draft))).toBe('## Technical Approach\n\nOur team will complete the work in 90 days.\n\n- Phase one\n- Phase two');
  });
});

describe('export', () => {
  const input = {
    title: 'Hull Repair — Technical Proposal',
    subtitle: 'Coast Guard · Due Dec 4',
    sections: [
      { label: 'Executive Summary', html: textToHtml('We **will** deliver.\n\n- On time\n- On budget') },
      { label: 'Technical', html: '<h2>Plan</h2><p>' + 'Long text '.repeat(400) + '</p>' + figureHtml(JPEG_1PX, 'pic', 'Photo: me') },
      { label: 'Pricing', html: '' },
    ],
    font: 'times' as const,
    fontSize: 12,
    loadImage: async (src: string) => (src === JPEG_1PX ? { dataUrl: JPEG_1PX, width: 1, height: 1 } : null),
  };

  it('builds a multi-page PDF with the text and the image', async () => {
    const blob = await buildPdf(input);
    const bytes = await bytesOf(blob);
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
    const body = new TextDecoder('latin1').decode(bytes);
    expect(body).toContain('Executive Summary');
    expect(body).toMatch(/\/Subtype \/Image/);
    expect((body.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  });

  it('builds a Word file (zip) that holds the text and the picture', async () => {
    const blob = await buildDocx(input);
    const bytes = await bytesOf(blob);
    expect(bytes[0]).toBe(0x50); // PK
    expect(bytes[1]).toBe(0x4b);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Executive Summary');
    expect(xml).toContain('On budget');
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });

  it('fits images in the column and names files safely', () => {
    expect(fitImage(2000, 1000, 468)).toEqual({ w: 468, h: 234 });
    expect(fitImage(400, 2000, 468).h).toBe(288);
    expect(exportFileName('Hull/Repair: "Tech" Proposal.pdf', 'pdf')).toBe('HullRepair-Tech-Proposal.pdf');
  });
});

describe('image search', () => {
  it('keeps only licenses that allow commercial use', () => {
    for (const l of ['Public domain', 'CC0', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC-BY-SA-4.0']) expect(isCommercialSafeLicense(l)).toBe(true);
    for (const l of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 2.0', 'All rights reserved', '']) expect(isCommercialSafeLicense(l)).toBe(false);
  });

  it('parses Wikimedia Commons results and drops unusable ones', () => {
    const json = { query: { pages: {
      1: { pageid: 1, index: 2, title: 'File:USCGC_Hamilton.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a.jpg', thumburl: 'https://upload.wikimedia.org/t.jpg', thumbwidth: 1200, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:A', width: 3000, height: 2000,
        extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a href="x">U.S. Coast Guard</a>' } } }] },
      2: { pageid: 2, index: 1, title: 'File:NC.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/b.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC BY-NC 2.0' } } }] },
      3: { pageid: 3, index: 3, title: 'File:Doc.pdf', imageinfo: [{ url: 'https://upload.wikimedia.org/c.pdf', mime: 'application/pdf', extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
    } } };
    const out = parseWikimedia(json);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'USCGC Hamilton', creator: 'U.S. Coast Guard', license: 'Public domain', publicDomain: true, imageUrl: 'https://upload.wikimedia.org/t.jpg' });
    expect(out[0].credit).toBe('Photo: U.S. Coast Guard (Public domain)');
  });

  it('parses Openverse results; non-allowlisted originals fall back to the Openverse copy', () => {
    const out = parseOpenverse({ results: [
      { id: 'abc', title: 'Ship', url: 'https://example.com/ship.jpg', thumbnail: 'https://api.openverse.org/v1/images/abc/thumb/', creator: 'Jane', license: 'by', license_version: '2.0', source: 'flickr', foreign_landing_url: 'https://flickr.com/x' },
      { id: 'def', title: 'Crane', url: 'https://live.staticflickr.com/1/2.jpg', license: 'pdm', source: 'flickr' },
      { id: 'nc', title: 'No', url: 'https://live.staticflickr.com/3.jpg', license: 'by-nc', source: 'flickr' },
    ] });
    expect(out.map((r) => r.id)).toEqual(['ov-abc', 'ov-def']);
    expect(out[0]).toMatchObject({ license: 'CC BY 2.0', imageUrl: 'https://api.openverse.org/v1/images/abc/thumb/', sourceLabel: 'Flickr via Openverse' });
    expect(out[1]).toMatchObject({ license: 'Public domain', imageUrl: 'https://live.staticflickr.com/1/2.jpg' });
    expect(creditLine('', 'CC0', 'Openverse')).toBe('Photo: Openverse (CC0)');
  });

  it('the export proxy only reaches the search sources image hosts', () => {
    expect(isProxyableImageUrl('https://upload.wikimedia.org/x.jpg')).toBe(true);
    expect(isProxyableImageUrl('https://api.openverse.org/v1/images/a/thumb/')).toBe(true);
    for (const u of ['http://upload.wikimedia.org/x.jpg', 'https://upload.wikimedia.org.evil.com/x', 'https://169.254.169.254/latest', 'https://user@upload.wikimedia.org/x', 'https://upload.wikimedia.org:8443/x', 'file:///etc/passwd']) {
      expect(isProxyableImageUrl(u)).toBe(false);
    }
  });

  it('interleaves the two sources without duplicates', () => {
    const r = (id: string, u: string) => ({ id, imageUrl: u }) as never;
    expect(mergeResults([r('a', '1'), r('b', '2')], [r('c', '3'), r('d', '1')], 10).map((x: { id: string }) => x.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('chat stream', () => {
  it('parses complete data lines and keeps the partial remainder', () => {
    const seen: string[] = [];
    const rest = parseChatLines('data: {"type":"token","content":"Hel"}\ndata: {"type":"token","content":"lo"}\ndata: {"type":"tok', (ev) => { if (ev.content) seen.push(ev.content); });
    expect(seen.join('')).toBe('Hello');
    expect(rest).toBe('data: {"type":"tok');
  });
});
