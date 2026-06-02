#!/usr/bin/env node

/**
 * Mindy RAG Library — Day 1 Ingestion
 *
 * Walks ~/Action Plan/ + ~/ebooks/03 Ask Eric Coffie/ and indexes
 * every readable doc (md, txt, pdf, docx, pptx) into
 * mindy_rag_documents.
 *
 * Built 2026-05-26 to turn Eric's 8-year teaching corpus into Mindy's
 * permanent competitive moat.
 *
 * Skip rules (size + extension):
 *   - .mp4, .mov, .zip, .DS_Store, node_modules, .git, .next, .cache
 *   - Files > 25MB (likely binary/media, not text)
 *
 * Resumability:
 *   - source_path is UNIQUE → repeat runs upsert on sha256 mismatch
 *   - Unchanged files are skipped (no re-extraction)
 *
 * Usage:
 *   node scripts/ingest-mindy-rag.js               # ingest all
 *   node scripts/ingest-mindy-rag.js --dry-run     # preview only
 *   node scripts/ingest-mindy-rag.js --limit=50    # first N files
 *   node scripts/ingest-mindy-rag.js --extensions=md,txt   # subset
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');

// ---- pdf-parse polyfills (must be installed BEFORE pdf-parse import) ----
// Same fix as src/lib/sam/pdf-extract.ts — pdf.js needs these in Node.
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

// ---- Env load ----------------------------------------------------------
const envPath = path.join(__dirname, '..', '.env.local');
const envVars = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [key, ...rest] = line.split('=');
  if (!key || !rest.length) return;
  let value = rest.join('=').trim();
  // Strip wrapping quotes that show up in .env.local
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  envVars[key.trim()] = value;
});

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---- CLI args ----------------------------------------------------------
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const extArg = args.find(a => a.startsWith('--extensions='));
const ALLOWED_EXTS = extArg
  ? extArg.split('=')[1].split(',').map(e => e.toLowerCase().replace(/^\./, ''))
  : ['md', 'txt', 'pdf', 'docx', 'pptx', 'doc'];

// ---- Roots to walk -----------------------------------------------------
const HOME = os.homedir();
const ROOTS = [
  path.join(HOME, 'Action Plan'),
  path.join(HOME, 'ebooks', '03 Ask Eric Coffie'),
  path.join(__dirname, '..', 'public', 'templates'),
  ...(envVars.MINDY_RAG_EXTRA_ROOTS
    ? envVars.MINDY_RAG_EXTRA_ROOTS.split(',').map(r => r.trim()).filter(Boolean)
    : []),
];

// ---- Skip patterns -----------------------------------------------------
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.cache', '.vercel', '.DS_Store',
  'dist', 'build', '.turbo', 'coverage',
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25MB

// ---- Walker ------------------------------------------------------------
function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`  Skipping unreadable dir: ${dir} (${err.code})`);
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_BYTES) continue;
        files.push({ path: full, ext, size: stat.size, mtime: stat.mtime });
      } catch { /* unreadable, skip */ }
    }
  }
  return files;
}

// ---- Doc-type classifier -----------------------------------------------
function hasResponseIntent(name) {
  return (
    name.includes('response') ||
    name.includes('responding') ||
    name.includes('proposal') ||
    name.includes('submittal') ||
    name.includes('template') ||
    name.includes('sample')
  );
}

function hasLoiIntent(name) {
  return (
    /\bss\s*-\s*loi\b/.test(name) ||
    /\bloi\b/.test(name) ||
    name.includes('letter of intent') ||
    name.includes('sample_loi') ||
    name.includes('sources sought template') ||
    name.includes('sources sought tempate')
  );
}

function classifyDocType(filePath, filename) {
  const p = filePath.toLowerCase();
  const n = filename.toLowerCase();
  if (
    hasLoiIntent(n) ||
    (n.includes('statement of capability') && (p.includes('sources sought') || p.includes('source sought')))
  ) return 'sources_sought_loi';
  if (n.includes('sources sought') || n.includes('source sought')) return 'sources_sought_loi';
  if (hasResponseIntent(n) && (n.includes('rfi') || n.includes('request for information'))) return 'rfi_response';
  if (
    n.includes('quote response') ||
    n.includes('quote proposal') ||
    (hasResponseIntent(n) && (n.includes('rfq') || n.includes('request for quotation')))
  ) return 'rfq_response';
  if (n.includes('technical volume') || n.includes('technical approach')) return 'technical_volume';
  if (n.includes('management volume') || n.includes('management approach') || n.includes('staffing plan')) return 'management_volume';
  if (n.includes('pricing volume') || n.includes('price volume') || n.includes('cost volume')) return 'pricing_volume';
  if (n.includes('cap statement') || n.includes('cap-statement') || n.includes('capability statement')) return 'cap_statement';
  if (n.includes('past performance') || n.includes('past-performance')) return 'past_performance';
  if (n.includes('proposal') || n.includes('rfp ')) return 'proposal_template';
  if (p.includes('/the vault/')) return 'teaching_handout';
  if (p.includes('/courses/')) return 'course_material';
  if (p.includes('/slides/') || n.endsWith('.pptx')) return 'slide_deck';
  if (p.includes('/webinars/')) return 'webinar_resource';
  if (p.includes('/planner-app/')) return 'planner_app_code';
  if (p.includes('ask eric coffie') || n.includes('question')) return 'qa_dataset';
  if (p.includes('/ebooks/')) return 'ebook';
  return 'misc';
}

function topLevelFolder(filePath) {
  for (const root of ROOTS) {
    if (filePath.startsWith(root + path.sep)) {
      const rel = filePath.slice(root.length + 1);
      return rel.split(path.sep)[0] || path.basename(root);
    }
  }
  return null;
}

// ---- Extractors --------------------------------------------------------
async function extractText(filePath, ext) {
  const buf = fs.readFileSync(filePath);
  if (ext === 'md' || ext === 'txt') {
    return { text: buf.toString('utf-8') };
  }
  if (ext === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const r = await parser.getText();
      return { text: r.text || '', pageCount: r.total };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value || '' };
  }
  if (ext === 'pptx') {
    // pptx is a zip of xml — light extraction without an extra dep:
    // strip xml tags from slide files. Good enough for RAG.
    const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();
    if (!AdmZip) return { text: '', note: 'adm-zip not installed; pptx skipped' };
    const zip = new AdmZip(buf);
    const slides = zip.getEntries().filter(e => e.entryName.match(/ppt\/slides\/slide\d+\.xml$/));
    const text = slides.map(s => {
      const xml = s.getData().toString('utf-8');
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }).join('\n\n');
    return { text, pageCount: slides.length };
  }
  throw new Error(`Unsupported ext: ${ext}`);
}

function bestTitle(filename, fullText) {
  // Try first H1 in markdown
  const h1 = (fullText || '').split('\n').slice(0, 50).find(l => l.startsWith('# '));
  if (h1) return h1.replace(/^#\s+/, '').trim().slice(0, 200);
  // Fall back to filename minus extension
  return path.parse(filename).name.slice(0, 200);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ---- Main --------------------------------------------------------------
async function main() {
  console.log('Mindy RAG Ingestion — Day 1');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Extensions: ${ALLOWED_EXTS.join(', ')}`);
  console.log(`Limit: ${LIMIT === Infinity ? 'all' : LIMIT}`);
  console.log('');

  // Confirm table exists
  if (!isDryRun) {
    const { error } = await supabase.from('mindy_rag_documents').select('id').limit(1);
    if (error) {
      console.error(`Cannot read mindy_rag_documents table: ${error.message}`);
      console.error('Run the migration first: supabase/migrations/20260526_mindy_rag_library.sql');
      process.exit(1);
    }
  }

  console.log('Walking roots:');
  let allFiles = [];
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) {
      console.warn(`  Missing: ${root}`);
      continue;
    }
    console.log(`  ${root}`);
    const files = walk(root);
    console.log(`    found ${files.length} files`);
    allFiles = allFiles.concat(files);
  }

  console.log(`\nTotal candidate files: ${allFiles.length}`);

  // Breakdown by extension
  const byExt = {};
  for (const f of allFiles) byExt[f.ext] = (byExt[f.ext] || 0) + 1;
  console.log('By extension:', byExt);

  // Apply limit
  if (LIMIT < allFiles.length) {
    console.log(`Limiting to first ${LIMIT}`);
    allFiles = allFiles.slice(0, LIMIT);
  }

  if (isDryRun) {
    console.log('\nDry run — exiting before extraction. Sample files:');
    allFiles.slice(0, 10).forEach(f => console.log(`  ${f.ext.padEnd(4)} ${(f.size + '').padStart(10)} ${f.path}`));
    return;
  }

  // Pre-fetch existing rows so we can skip unchanged files
  console.log('\nFetching existing index for delta detection...');
  const existing = new Map();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('mindy_rag_documents')
      .select('source_path, file_sha256')
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fetch existing failed:', error.message); break; }
    if (!data || !data.length) break;
    data.forEach(r => existing.set(r.source_path, r.file_sha256));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Existing rows: ${existing.size}`);

  // Process
  const stats = { ok: 0, skipped_unchanged: 0, failed: 0, by_type: {} };
  const failures = [];

  for (let i = 0; i < allFiles.length; i++) {
    const f = allFiles[i];
    const prefix = `[${(i + 1).toString().padStart(4)}/${allFiles.length}]`;
    try {
      const buf = fs.readFileSync(f.path);
      const hash = sha256(buf);
      if (existing.get(f.path) === hash) {
        stats.skipped_unchanged++;
        if (i % 50 === 0) console.log(`${prefix} unchanged (cumulative skipped: ${stats.skipped_unchanged})`);
        continue;
      }

      const { text, pageCount } = await extractText(f.path, f.ext);
      const cleanText = (text || '').slice(0, 1_500_000); // cap at 1.5MB of text per doc
      const filename = path.basename(f.path);
      const doc_type = classifyDocType(f.path, filename);
      const top = topLevelFolder(f.path);
      const folder_path = path.dirname(f.path);
      const title = bestTitle(filename, cleanText);
      const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

      const row = {
        source_path: f.path,
        filename,
        file_extension: f.ext,
        size_bytes: f.size,
        file_mtime: f.mtime.toISOString(),
        file_sha256: hash,
        doc_type,
        top_level_folder: top,
        folder_path,
        title,
        full_text: cleanText,
        text_length: cleanText.length,
        page_count: pageCount || null,
        word_count: wordCount,
        ingestion_status: cleanText.trim().length > 0 ? 'extracted' : 'skipped',
        ingestion_error: cleanText.trim().length > 0 ? null : 'empty extraction',
        ingested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('mindy_rag_documents')
        .upsert(row, { onConflict: 'source_path' });
      if (error) throw error;

      stats.ok++;
      stats.by_type[doc_type] = (stats.by_type[doc_type] || 0) + 1;

      if (i % 25 === 0 || i === allFiles.length - 1) {
        console.log(`${prefix} ${f.ext.padEnd(4)} ${(cleanText.length + '').padStart(8)}ch  ${path.basename(f.path)}`);
      }
    } catch (err) {
      stats.failed++;
      failures.push({ path: f.path, error: err.message });
      console.warn(`${prefix} FAIL ${f.path}: ${err.message}`);
      // Still upsert a failed-status row so we know we tried
      try {
        await supabase.from('mindy_rag_documents').upsert({
          source_path: f.path,
          filename: path.basename(f.path),
          file_extension: f.ext,
          size_bytes: f.size,
          file_mtime: f.mtime.toISOString(),
          file_sha256: 'failed-' + Date.now(),
          doc_type: classifyDocType(f.path, path.basename(f.path)),
          top_level_folder: topLevelFolder(f.path),
          folder_path: path.dirname(f.path),
          title: path.parse(f.path).name,
          full_text: '',
          text_length: 0,
          ingestion_status: 'failed',
          ingestion_error: err.message.slice(0, 1000),
          ingested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'source_path' });
      } catch { /* ignore */ }
    }
  }

  console.log('\n========== INGESTION COMPLETE ==========');
  console.log(`Indexed:           ${stats.ok}`);
  console.log(`Skipped unchanged: ${stats.skipped_unchanged}`);
  console.log(`Failed:            ${stats.failed}`);
  console.log('\nBy doc_type:');
  Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`  ${t.padEnd(22)} ${c}`);
  });
  if (failures.length) {
    console.log('\nFirst 10 failures:');
    failures.slice(0, 10).forEach(f => console.log(`  ${f.path}\n    ${f.error}`));
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
