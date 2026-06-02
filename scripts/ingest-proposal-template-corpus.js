#!/usr/bin/env node

/**
 * Ingest curated Proposal Assist template/reference docs through the
 * deployed admin RAG bridge.
 *
 * Local Supabase service keys may be stale, but the deployed app has the
 * current server env. This script extracts text locally from Eric's Google
 * Drive docs, then POSTs batches to /api/admin/rag-library where the server
 * upserts documents and chunks.
 *
 * Default is dry-run:
 *   node scripts/ingest-proposal-template-corpus.js
 *
 * Apply:
 *   node scripts/ingest-proposal-template-corpus.js --apply
 *
 * Optional:
 *   --endpoint=https://getmindy.ai
 *   --limit=10
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const g = globalThis;
if (typeof g.DOMMatrix === 'undefined') {
  g.DOMMatrix = class DOMMatrix {
    constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; this.is2D = true; this.isIdentity = true; }
    multiply() { return this; } translate() { return this; } scale() { return this; } inverse() { return this; }
    toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
  };
}
if (typeof g.ImageData === 'undefined') {
  g.ImageData = class ImageData {
    constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
  };
}
if (typeof g.Path2D === 'undefined') {
  g.Path2D = class Path2D { constructor() {} addPath(){} closePath(){} moveTo(){} lineTo(){} bezierCurveTo(){} quadraticCurveTo(){} arc(){} arcTo(){} ellipse(){} rect(){} roundRect(){} };
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const endpointArg = args.find((arg) => arg.startsWith('--endpoint='));
const ENDPOINT = (endpointArg ? endpointArg.split('=').slice(1).join('=') : 'https://getmindy.ai').replace(/\/$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const HOME = os.homedir();
const MY_DRIVE = path.join(
  HOME,
  'Library',
  'CloudStorage',
  'GoogleDrive-evankoffdev@gmail.com',
  'My Drive'
);
const GDRIVE = path.join(MY_DRIVE, 'GOVCON EDU');

const ROOTS = [
  path.join(GDRIVE, 'Value Ladders', 'Sample Lead Magnet Content', 'Sample LOI'),
  path.join(GDRIVE, 'The Vault ', 'Proposal Writing'),
  path.join(GDRIVE, 'Courses', 'Govcon Giants Course', 'Resources'),
  path.join(GDRIVE, 'PRODUCTS', 'Micro Course Govcon ', 'Better Bid Response PDFS'),
];

const EXTRA_FILES = [
  {
    path: path.join(MY_DRIVE, 'Copy of DOE LOI.docx'),
    topLevelFolder: 'Sample LOI',
    docType: 'sources_sought_loi',
  },
  {
    path: path.join(GDRIVE, 'Courses', 'Govcon Giants Course', 'Documents', 'Technical MJ Global JDMTA  .pdf'),
    topLevelFolder: 'Technical Volumes',
    docType: 'technical_volume',
  },
  {
    path: path.join(GDRIVE, 'Courses', 'Govcon Giants Course', 'Documents', 'RFP info', 'Hanscom MACC', 'VOLUME 1 TECHNICAL VOLUME - FACTOR 1[3].pdf'),
    topLevelFolder: 'Technical Volumes',
    docType: 'technical_volume',
  },
  {
    path: path.join(GDRIVE, 'Courses', 'Govcon Giants Course', 'Documents', 'RFP info', 'Hanscom MACC', 'VOLUME 1 TECHNICAL VOLUME - FACTOR 2[1].pdf'),
    topLevelFolder: 'Technical Volumes',
    docType: 'technical_volume',
  },
  {
    path: path.join(GDRIVE, 'Courses', 'Govcon Giants Course', 'Documents', 'RFP info', 'Hanscom MACC', 'proposal writeup', 'final Hanscom AFB MACC Volume I Factor 1.docx'),
    topLevelFolder: 'Technical Volumes',
    docType: 'technical_volume',
  },
  {
    path: path.join(GDRIVE, 'Courses', 'Govcon Giants Course', 'Documents', 'RFP info', 'Hanscom MACC', 'proposal writeup', 'final Hanscom AFB MACC Volume I Factor 2.docx'),
    topLevelFolder: 'Technical Volumes',
    docType: 'technical_volume',
  },
  {
    path: path.join(GDRIVE, 'Bids : Contracts', 'Submitted', 'Colombia+Anti+Money+Laundering+Campaign', '191NLE25R0003 – INL Colombia -Volume I Technical Proposal signed.pdf'),
    topLevelFolder: 'Technical Volumes',
    docType: 'technical_volume',
  },
];

const ALLOWED_EXTS = new Set(['pdf', 'docx', 'doc', 'txt', 'md', 'pptx']);
const MAX_BYTES = 25 * 1024 * 1024;

function fileRecord(filePath, meta = {}) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) return null;
  return { path: filePath, ext, size: stat.size, mtime: stat.mtime, ...meta };
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const record = fileRecord(full);
    if (record) files.push(record);
  }
  return files;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ocrPdfWithTesseract(filePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindy-pdf-ocr-'));
  try {
    const outputPrefix = path.join(tempDir, 'page');
    execFileSync('pdftoppm', ['-r', '220', '-png', filePath, outputPrefix], {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 180_000,
    });

    const pageImages = fs.readdirSync(tempDir)
      .filter((name) => name.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => path.join(tempDir, name));

    if (pageImages.length === 0) return '';

    return pageImages
      .map((imagePath) => {
        try {
          return execFileSync('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6'], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
          });
        } catch {
          return '';
        }
      })
      .join('\n\n');
  } catch {
    return '';
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function bestTitle(filename, text) {
  const h1 = (text || '').split('\n').slice(0, 50).find((line) => line.startsWith('# '));
  if (h1) return h1.replace(/^#\s+/, '').trim().slice(0, 200);
  return path.parse(filename).name.slice(0, 200);
}

function hasAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function classifyDocType(filePath, filename, fullText = '') {
  const p = filePath.toLowerCase();
  const n = filename.toLowerCase();
  const head = fullText.slice(0, 1500).toLowerCase();
  const combined = `${p} ${n}`;
  const extra = EXTRA_FILES.find((item) => item.path === filePath);
  if (extra?.docType) return extra.docType;

  if (n.includes('eda rfi response') || n.includes('rfi response')) return 'rfi_response';
  if (n.includes('gcg eda national pilot program')) return 'rfi_response';
  if (n.includes('rfq') && hasAny(n, ['response', 'proposal', 'quote'])) return 'rfq_response';
  if (hasAny(n, ['cap statement', 'capability statement'])) return 'cap_statement';
  if (
    hasAny(head.slice(0, 500), ['capability statement', 'capabilities statement']) &&
    !head.includes('dear ')
  ) return 'cap_statement';

  if (
    p.includes('sample loi') ||
    hasAny(n, ['loi', 'letter of intent', 'sources sought response', 'source sought response']) ||
    hasAny(n, ['sources sought tempate', 'sources sought template', 'sample_loi'])
  ) {
    return 'sources_sought_loi';
  }

  if (hasAny(n, ['past performance', 'volume ii_past performance'])) return 'past_performance';

  if (
    !hasAny(n, ['non-price proposal', 'non price proposal']) &&
    hasAny(n, ['price proposal', 'pricing volume', 'price volume', 'cost volume'])
  ) {
    return 'pricing_volume';
  }

  if (
    hasAny(n, [
      'volume i - technical',
      'volume i technical',
      'volume i_technical',
      'volume  i_technical',
      'volume 1 technical',
      'volume 1_technical',
      'technical volume',
      'vol 1_technical',
      'vol 1 technical',
      'vol i technical',
      'technical proposal',
      'technical approach',
      'non-price proposal',
      'non price proposal',
    ]) ||
    /\bvolume\s+(i|1)\s+factor\s+[12]\b/.test(n)
  ) {
    return 'technical_volume';
  }

  if (hasAny(n, ['management volume', 'management approach', 'staffing plan'])) return 'management_volume';
  if (hasAny(combined, ['proposal writing', 'proposal'])) return 'proposal_template';
  return 'course_material';
}

function topLevelFolder(filePath) {
  const extra = EXTRA_FILES.find((item) => item.path === filePath);
  if (extra?.topLevelFolder) return extra.topLevelFolder;

  for (const root of ROOTS) {
    if (filePath.startsWith(root + path.sep)) {
      return path.basename(root) || 'proposal-template-corpus';
    }
  }
  return 'proposal-template-corpus';
}

async function extractText(filePath, ext) {
  const buf = fs.readFileSync(filePath);
  if (ext === 'md' || ext === 'txt') return { text: buf.toString('utf8') };
  if (ext === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await parser.getText();
      let text = result.text || '';
      if (text.trim().length < 200) {
        const ocrText = ocrPdfWithTesseract(filePath);
        if (ocrText.trim().length > text.trim().length) text = ocrText;
      }
      return { text, pageCount: result.total };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value || '' };
  }
  if (ext === 'pptx') {
    const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();
    if (!AdmZip) return { text: '' };
    const zip = new AdmZip(buf);
    const slides = zip.getEntries().filter((entry) => entry.entryName.match(/ppt\/slides\/slide\d+\.xml$/));
    const text = slides.map((slide) => slide.getData().toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join('\n\n');
    return { text, pageCount: slides.length };
  }
  return { text: '' };
}

function chunkPreviewCount(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  if (words.length <= 500) return 1;
  return Math.ceil((words.length - 500) / 450) + 1;
}

async function postBatch(docs) {
  const response = await fetch(`${ENDPOINT}/api/admin/rag-library?password=${encodeURIComponent(PASSWORD)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'upsert-rag-docs',
      dryRun: !APPLY,
      confirm: APPLY ? 'upsert-rag-docs' : undefined,
      dedupeByHash: true,
      docs,
    }),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok || !json.success) {
    throw new Error(`Admin ingest failed ${response.status}: ${json.error || text.slice(0, 300)}`);
  }
  return json;
}

async function main() {
  console.log(`Proposal template corpus ingest — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log('');

  let files = [];
  for (const root of ROOTS) {
    const found = walk(root);
    console.log(`${found.length.toString().padStart(3)} files  ${root}`);
    files = files.concat(found);
  }
  for (const extra of EXTRA_FILES) {
    try {
      const record = fileRecord(extra.path, { topLevelFolder: extra.topLevelFolder });
      if (record) {
        files.push(record);
        console.log(`  1 file   ${extra.path}`);
      }
    } catch (err) {
      console.log(`  0 files  ${extra.path} (${err.message})`);
    }
  }

  if (LIMIT < files.length) files = files.slice(0, LIMIT);
  console.log(`\nExtracting ${files.length} files...`);

  const docs = [];
  const failed = [];
  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file.path);
      const { text, pageCount } = await extractText(file.path, file.ext);
      const cleanText = (text || '').slice(0, 1_500_000);
      if (cleanText.trim().length < 200) {
        failed.push({ path: file.path, error: `too little extracted text (${cleanText.trim().length} chars)` });
        continue;
      }
      const filename = path.basename(file.path);
      const docType = classifyDocType(file.path, filename, cleanText);
      const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
      docs.push({
        sourcePath: file.path,
        filename,
        fileExtension: file.ext,
        sizeBytes: file.size,
        fileMtime: file.mtime.toISOString(),
        fileSha256: sha256(buffer),
        docType,
        topLevelFolder: topLevelFolder(file.path),
        folderPath: path.dirname(file.path),
        title: bestTitle(filename, cleanText),
        fullText: cleanText,
        pageCount: pageCount || null,
        wordCount,
        topicTags: ['proposal-assist-template-corpus', docType],
        usageRights: 'eric_owned',
      });
    } catch (err) {
      failed.push({ path: file.path, error: err.message });
    }
  }

  const byType = docs.reduce((acc, doc) => {
    acc[doc.docType] = (acc[doc.docType] || 0) + 1;
    return acc;
  }, {});
  console.log('By type:', byType);
  console.log(`Extraction failures: ${failed.length}`);
  failed.slice(0, 10).forEach((item) => console.log(`  FAIL ${item.path}: ${item.error}`));

  docs.slice(0, 20).forEach((doc, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. ${doc.docType.padEnd(20)} ${String(doc.fullText.length).padStart(7)}ch ${String(chunkPreviewCount(doc.fullText)).padStart(3)} chunks  ${doc.filename}`);
  });

  console.log(`\nPosting ${docs.length} docs in batches...`);
  const totals = { batches: 0, updatedDocuments: 0, insertedChunks: 0, failed: 0 };
  const failedResults = [];
  for (let i = 0; i < docs.length; i += 5) {
    const batch = docs.slice(i, i + 5);
    const result = await postBatch(batch);
    totals.batches++;
    totals.updatedDocuments += result.updatedDocuments || 0;
    totals.insertedChunks += result.insertedChunks || 0;
    totals.failed += result.failed || 0;
    if (Array.isArray(result.results)) {
      failedResults.push(...result.results.filter((item) => item.status === 'failed'));
    }
    console.log(`[${String(i + batch.length).padStart(3)}/${docs.length}]`, {
      received: result.received,
      updatedDocuments: result.updatedDocuments,
      insertedChunks: result.insertedChunks,
      failed: result.failed,
      byDocType: result.byDocType,
    });
  }

  console.log('\nComplete:', totals);
  if (failedResults.length > 0) {
    console.log('Failed admin upserts:');
    failedResults.forEach((item) => {
      console.log(`  ${item.docType || '?'} ${item.filename || item.sourcePath}: ${item.error || 'unknown error'}`);
    });
  }
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write documents and chunks.');
}

main().catch((err) => {
  console.error(`PROPOSAL_TEMPLATE_INGEST_FAILED: ${err.message}`);
  process.exit(1);
});
