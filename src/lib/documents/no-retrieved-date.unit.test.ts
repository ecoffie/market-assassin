import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { renderHtml } from './render-html';
import { renderDocx } from './render-docx';
import { SAMPLE_REPORT } from './__fixtures__/sample-report';

/**
 * Eric, 2026-11-27: "apply the no date rules everywhere". A document's Sources list names each source (and its
 * link/record id) but never prints when Mindy read it ("Retrieved <date>"). retrievedAt stays in the model.
 */
describe('documents: no "Retrieved <date>" in Sources', () => {
  it('the fixture source carries a retrievedAt (the data model keeps it)', () => {
    expect(SAMPLE_REPORT.sources?.find((s) => s.label.startsWith('Example award data extract'))?.retrievedAt).toBe('2026-11-17');
  });
  it('HTML/PDF: source label and link stay, no read date', () => {
    const html = renderHtml(SAMPLE_REPORT);
    const sources = html.slice(html.indexOf('class="sources"'));
    expect(sources).toContain('Example award data extract');
    expect(sources).toContain('https://example.com/fixture/awards');
    expect(sources).not.toMatch(/Retrieved/i);
    expect(sources).not.toContain('2026-11-17');
  });
  it('Word: source label and link stay, no read date', async () => {
    const doc = strFromU8(unzipSync(new Uint8Array(await renderDocx(SAMPLE_REPORT)))['word/document.xml']);
    const sources = doc.slice(doc.lastIndexOf('>Sources<'));
    expect(sources).toContain('Example award data extract');
    expect(sources).toContain('https://example.com/fixture/awards');
    expect(sources).not.toMatch(/Retrieved/i);
    expect(sources).not.toContain('2026-11-17');
  });
});
