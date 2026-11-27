/**
 * Vault document parity: what the customer reads on screen is what the PDF carries (Design & Output, Track C1).
 *
 * A saved Ask Mindy document (create_document → DocModel) is previewed in the Vault / Map report pane as
 * renderHtml(model, { screen: true }) (src/app/api/app/vault/documents/preview/route.ts) and downloaded as
 * renderPdf(model) (HTML → locked-down Chromium). Both come from one model, but nothing checked that the PDF
 * keeps everything the preview shows. This suite renders both for real and compares them.
 *
 * The packaged market report has its own parity suite beside this one (market-report-pdf.test.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { SAMPLE_REPORT } from '@/lib/documents/__fixtures__/sample-report';
import type { DocModel } from '@/lib/documents/model';
import { renderHtml } from '@/lib/documents/render-html';
import { renderPdf } from '@/lib/documents/render-pdf';
import { htmlToPdf } from '@/lib/pdf/launch-browser';
import { CHROME, PDFTOTEXT, launch, pdfPages, htmlLines, squash, norm } from './report-harness';

/**
 * The sample report plus one unverified statement (so the "Unverified statements" listing is covered) and a
 * next-steps checklist (the checklist block).
 */
const CHECKLIST = ['Register the legal entity in SAM.gov', 'Call the small business office before the next quarter'];
const MODEL: DocModel = {
  ...SAMPLE_REPORT,
  sections: [
    ...SAMPLE_REPORT.sections.map((s, i) => i !== 1 ? s : {
      ...s,
      blocks: [...s.blocks, { type: 'paragraph' as const, id: 'c1-unverified', claim: 'unverified' as const, text: 'Two further regional buyers are expected to consolidate their janitorial contracts next year.' }],
    }),
    { id: 'next', heading: 'Next steps', blocks: [{ type: 'bullets', id: 'next-list', style: 'checklist', items: CHECKLIST.map((text) => ({ text, claim: 'recommendation' as const })) }] },
  ],
};

/**
 * Claim labels ("Planning assumption", "Recommendation", "Unverified: no source") are floated tags: the PDF
 * text layer reads them after their paragraph, not before it. They are taken out of the line comparison and
 * counted on their own instead: the PDF must print every label as often as the preview shows it.
 */
const LABEL = /<span class="label [^"]*">([^<]*)<\/span>/g;
/** A label that opens a block (right after a tag) is a floated tag; one inside a sentence stays in its line. */
const FLOATED_LABEL = />\s*<span class="label [^"]*">[^<]*<\/span>/g;

/** pdf.js reads letter-spaced headings as "F E D E R A L": join runs of single letters back into words. */
const joinSpacedLetters = (t: string) => t.replace(/\b(?:[A-Za-z] ){2,}[A-Za-z]\b/g, (m) => m.replace(/ /g, ''));

/** Running header and footer that renderPdf prints on every page. */
const RUNNING = /Prepared with Mindy|Page \d+ of \d+/g;

describe.runIf(!!CHROME)('Vault document: on-screen preview and PDF carry the same content', () => {
  const screenHtml = renderHtml(MODEL, { screen: true });
  let pdf: Buffer;
  let pages: string[];
  let text: string;

  beforeAll(async () => {
    const r = await renderPdf(MODEL, { htmlToPdf: (h, o, opts = {}) => htmlToPdf(h, o, { ...opts, launch }) });
    expect(r.error).toBeNull();
    pdf = r.pdf!;
    pages = await pdfPages(pdf);
    // -raw: reading order. The default layout mode reorders a line that wraps around an inline label chip.
    const raw = PDFTOTEXT ? execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', '-raw', '-', '-'], { input: pdf, encoding: 'utf8' }) : pages.join(' ');
    text = raw.replace(new RegExp(MODEL.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ').replace(RUNNING, ' ');
  }, 90_000);

  it('is a real PDF with a numbered running footer on every page', () => {
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.filter((p, i) => !squash(p).includes(squash(`Page ${i + 1} of ${pages.length}`))).length).toBe(0);
  });

  it('every line the preview shows is in the PDF', () => {
    const lines = htmlLines(screenHtml.replace(FLOATED_LABEL, '> '));
    expect(lines.length).toBeGreaterThan(80);
    if (PDFTOTEXT) {
      const all = squash(text);
      expect(lines.filter((l) => !all.includes(squash(l)))).toEqual([]);
    } else {
      // pdf.js can extract a wrapped line out of reading order: compare each line's words (4+ letters).
      const words = (x: string) => x.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      const joined = joinSpacedLetters(text);
      const inPdf = new Set(words(joined));
      const flat = squash(joined);
      expect(lines.filter((l) => words(l).length > 0 && !words(l).every((w) => inPdf.has(w)) && !flat.includes(squash(l)))).toEqual([]);
    }
  });

  it('prints every claim label as often as the preview shows it', () => {
    const shown = new Map<string, number>();
    for (const m of screenHtml.matchAll(LABEL)) shown.set(m[1], (shown.get(m[1]) ?? 0) + 1);
    expect(shown.size).toBeGreaterThanOrEqual(3);
    const pdfText = joinSpacedLetters(text).toLowerCase();
    const count = (label: string) => pdfText.split(label.toLowerCase()).length - 1;
    expect([...shown].filter(([label, n]) => count(label) < n).map(([label, n]) => `${label}: preview ${n}, PDF ${count(label)}`)).toEqual([]);
  });

  it('keeps every section, table row, source and claim label', () => {
    const all = norm(text);
    const missing: string[] = [];
    for (const s of MODEL.sections) {
      if (!all.includes(norm(s.heading))) missing.push(`section: ${s.heading}`);
      for (const b of s.blocks) {
        if (b.type === 'table') {
          for (const row of b.rows) {
            const first = Object.values(row).find((v) => typeof v === 'string');
            if (typeof first === 'string' && !all.includes(norm(first))) missing.push(`row: ${first}`);
          }
        }
        if (b.type === 'paragraph' && !all.includes(norm(b.text))) missing.push(`paragraph: ${b.text.slice(0, 60)}`);
      }
    }
    for (const src of MODEL.sources) if (!all.includes(norm(src.label))) missing.push(`source: ${src.label}`);
    for (const label of ['Planning assumption', 'Unverified', 'Sources']) if (!all.includes(norm(label))) missing.push(`label: ${label}`);
    expect(missing).toEqual([]);
  });

  it('never prints a blank page', () => {
    expect(pages.map((p, i) => [i + 1, p.replace(RUNNING, '').trim().length] as const).filter(([, n]) => n === 0)).toEqual([]);
  });

  // Reference layout (2026-11-25): professional plans open with the summary on page 1 and carry no contents page.
  it('opens with content on page 1: no cover-alone page and no contents-alone page', () => {
    expect(norm(pages[0])).toContain(norm(MODEL.sections[0].heading));
    expect(norm(pages.join(' '))).not.toContain(norm('Contents'));
    const body = pages.map((p) => p.replace(RUNNING, '').replace(/\s+/g, ' ').trim().length);
    const median = [...body].sort((a, b) => a - b)[Math.floor(body.length / 2)];
    expect(body.slice(0, -1).map((n, i) => [i + 1, n] as const).filter(([, n]) => n < median * 0.35), 'near-empty pages').toEqual([]);
  });

  it('embeds real fonts: no Type 3 glyph fonts (searchable, crisp text)', () => {
    expect(pdf.toString('latin1').match(/\/Subtype\s*\/Type3/g) ?? []).toEqual([]);
  });

  it('renders the checklist block: every item in the PDF, as a checklist in the page', () => {
    expect(renderHtml(MODEL)).toContain('<ul class="checklist">');
    expect(CHECKLIST.filter((t) => !norm(text).includes(norm(t)))).toEqual([]);
  });
});

describe.runIf(!CHROME)('Vault document parity (skipped: no Chromium binary here)', () => {
  it.skip('needs PUPPETEER_EXECUTABLE_PATH, /opt/pw-browsers/chromium or /usr/bin/google-chrome', () => {});
});
