/**
 * Render the fixture report to DOCX and PDF locally (no network, no database).
 *
 *   npx tsx scripts/documents/render-fixture.ts [outDir]
 *
 * PDF uses the local full `puppeteer` browser through src/lib/pdf/launch-browser.ts. Prints the
 * page count of each file so a reviewer can confirm a real multi-page document came out.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SAMPLE_REPORT } from '../../src/lib/documents/__fixtures__/sample-report';
import { renderDocument } from '../../src/lib/documents';

async function main() {
  const out = process.argv[2] || join(tmpdir(), 'mindy-document-fixture');
  mkdirSync(out, { recursive: true });
  for (const format of ['docx', 'pdf'] as const) {
    const r = await renderDocument(SAMPLE_REPORT, format);
    if (!r.ok) throw new Error(`invalid model: ${JSON.stringify(r.issues)}`);
    if (r.degraded) throw new Error(`PDF degraded to HTML: ${r.degraded.reason}`);
    const path = join(out, r.filename);
    writeFileSync(path, r.bytes);
    let pages = '';
    if (format === 'pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(r.bytes) });
      const t = await parser.getText();
      pages = ` · ${t.total} pages · ${t.text.length} extractable chars`;
      await parser.destroy();
    }
    console.log(`${format.toUpperCase()}: ${path} (${r.bytes.length.toLocaleString()} bytes${pages})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
