/**
 * Capability statement PDF, rendered for real (Chromium, the production renderPdf path): it is ONE page, carries its
 * sections in order, and an over-long statement is trimmed to fit rather than spilling onto page 2.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CAPABILITY_STATEMENT, CAPABILITY_STATEMENT_AS_WRITTEN } from '@/lib/documents/__fixtures__/capability-statement';
import type { DocModel } from '@/lib/documents/model';
import { renderPdf, pdfPageCount } from '@/lib/documents/render-pdf';
import { htmlToPdf } from '@/lib/pdf/launch-browser';
import { CHROME, launch, pdfPages, norm } from './report-harness';

const render = (m: DocModel) => renderPdf(m, { htmlToPdf: (h, o, opts = {}) => htmlToPdf(h, o, { ...opts, launch }) });

describe.runIf(!!CHROME)('capability statement PDF', () => {
  let pdf: Buffer;
  let text: string;
  beforeAll(async () => {
    const r = await render(CAPABILITY_STATEMENT);
    expect(r.error).toBeNull();
    pdf = r.pdf!;
    text = (await pdfPages(pdf)).join('\n');
  }, 90_000);

  it('is exactly one page', async () => {
    expect(pdfPageCount(pdf)).toBe(1);
    expect((await pdfPages(pdf)).length).toBe(1);
  });

  it('carries the header, both columns and the provenance line, with no page number, stage mark or Sources list', () => {
    const t = norm(text);
    for (const s of ['Ridgeline Facility Services LLC', 'Core Competencies', 'Past Performance', 'Differentiators', 'Company Data', 'Point of Contact', 'RDGLN0000TEST', 'Company data from the SAM.gov registration']) expect(t).toContain(norm(s));
    expect(text).not.toMatch(/Page 1 of|Beta|Sources|How to read/);
  });

  it('the statement as the model actually writes it (no kind, briefing theme, coaching note, Sources section) is one page', async () => {
    const r = await render(CAPABILITY_STATEMENT_AS_WRITTEN);
    expect(pdfPageCount(r.pdf!)).toBe(1);
    const t = (await pdfPages(r.pdf!)).join(' ');
    expect(t).not.toMatch(/REPORT|Sources|How to read|67e4223f|Add your first completed project/);
  }, 90_000);

  it('an over-long statement is trimmed to the top items and still prints on one page', async () => {
    const m: DocModel = JSON.parse(JSON.stringify(CAPABILITY_STATEMENT));
    const comp = m.sections[0].blocks[0] as { items: Array<{ text: string; claim: 'fact'; cites: string[] }> };
    for (let i = 0; i < 14; i++) comp.items.push({ text: `Additional competency number ${i + 1}: a long description of a service line that runs well past one line on the page to force overflow.`, claim: 'fact', cites: ['s-upload'] });
    m.sections.push({ id: 'sec-extra', heading: 'Additional Information', blocks: [{ type: 'paragraph', id: 'p-x', claim: 'fact', cites: ['s-upload'], text: 'A long paragraph of extra material. '.repeat(30) }] });
    const r = await render(m);
    expect(pdfPageCount(r.pdf!)).toBe(1);
    expect(norm((await pdfPages(r.pdf!)).join(' '))).toContain(norm('Daily and periodic custodial services'));
  }, 90_000);
});

describe.runIf(!CHROME)('capability statement PDF (skipped: no Chromium binary here)', () => {
  it.skip('needs PUPPETEER_EXECUTABLE_PATH, /opt/pw-browsers/chromium or /usr/bin/google-chrome', () => {});
});
