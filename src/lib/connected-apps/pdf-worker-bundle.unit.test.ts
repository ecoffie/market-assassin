/**
 * The chat route parses PDFs picked from Google Drive / OneDrive (files.ts → extractByKind → pdf-parse), so its
 * serverless bundle must carry the pdf.js worker. pdf-parse loads it with a dynamic import the output tracer cannot
 * see; without it the parse throws and the file was reported as "no readable text".
 *
 * Found 2026-11-27 on production: Encore_Capabilities_Statement_Suite380.pdf (a LibreOffice text PDF, 2,603 chars
 * locally) came back unreadable from Drive, while uploads (parsed in /api/app/chat/documents, which IS covered) worked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
const workerList = config.match(/const CHAT_PDF_WORKER_FILES = \[([\s\S]*?)\];/);
const files = workerList ? [...workerList[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

describe('the chat route bundles the pdf.js worker', () => {
  it('/api/app/chat includes CHAT_PDF_WORKER_FILES alongside Chromium', () => {
    expect(config).toMatch(/'\/api\/app\/chat': \['\.\/node_modules\/@sparticuz\/chromium\/bin\/\*\*\/\*', \.\.\.CHAT_PDF_WORKER_FILES\]/);
  });

  it('the list names the worker pdf-parse loads, and every file exists', () => {
    expect(files).toContain('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
    expect(files).toContain('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    for (const f of files) expect(existsSync(join(process.cwd(), f)), f).toBe(true);
  });

  it('stays narrow: no source maps and no whole-package glob on the chat route (it already carries Chromium)', () => {
    expect(files.some((f) => f.endsWith('.map') || f.includes('*'))).toBe(false);
  });

  it('a parser crash is logged, never silent', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/connected-apps/files.ts'), 'utf8');
    expect(src).toMatch(/console\.error\('\[connected-files\] extract failed:'/);
  });
});
