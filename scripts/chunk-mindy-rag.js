#!/usr/bin/env node

/**
 * Mindy RAG — chunk-and-store pass.
 *
 * Walks every row in mindy_rag_documents with status 'extracted',
 * chunks full_text into ~500-word passages with 50-word overlap,
 * inserts into mindy_rag_chunks (which auto-populates the FTS
 * tsvector via GENERATED ALWAYS AS).
 *
 * Resumable: skips documents that already have chunks.
 * Idempotent: --rechunk forces rebuild for a doc_id.
 *
 * Built 2026-05-26 right after Day 1 ingestion (576 docs) so
 * retrieveRagContext() has chunk-level granularity instead of
 * whole-document FTS bias.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---- env --------------------------------------------------------
const envPath = path.join(__dirname, '..', '.env.local');
const envVars = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...rest] = line.split('=');
  if (!k || !rest.length) return;
  let v = rest.join('=').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  envVars[k.trim()] = v;
});

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---- chunking ---------------------------------------------------
const WORDS_PER_CHUNK = 500;
const OVERLAP_WORDS = 50;

function chunkText(text) {
  // Normalize whitespace + collapse runs
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  if (words.length <= WORDS_PER_CHUNK) {
    return [cleaned];
  }
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + WORDS_PER_CHUNK);
    chunks.push(slice.join(' '));
    if (i + WORDS_PER_CHUNK >= words.length) break;
    i += (WORDS_PER_CHUNK - OVERLAP_WORDS);
  }
  return chunks;
}

// ---- main -------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const forceRechunk = args.includes('--rechunk');

  console.log(`Mindy RAG chunk-and-store — mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}${forceRechunk ? ' (rechunk)' : ''}`);

  // Pull existing chunk doc IDs so we skip
  const existingDocs = new Set();
  if (!forceRechunk) {
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from('mindy_rag_chunks').select('document_id').range(from, from + PAGE - 1);
      if (error) { console.error('Fetch existing chunks failed:', error.message); break; }
      if (!data || !data.length) break;
      data.forEach(r => existingDocs.add(r.document_id));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`Documents already chunked: ${existingDocs.size}`);

  // Pull docs with extracted text
  const docs = [];
  let from = 0;
  const PAGE = 200;
  while (true) {
    const { data, error } = await supabase
      .from('mindy_rag_documents')
      .select('id, full_text, doc_type, title, top_level_folder, source_path, text_length')
      .eq('ingestion_status', 'extracted')
      .gt('text_length', 100)
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fetch docs failed:', error.message); break; }
    if (!data || !data.length) break;
    docs.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Documents to consider: ${docs.length}`);

  const stats = { processed: 0, skipped_existing: 0, chunks_inserted: 0, failed: 0, no_text: 0 };

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!forceRechunk && existingDocs.has(doc.id)) { stats.skipped_existing++; continue; }
    if (forceRechunk) {
      await supabase.from('mindy_rag_chunks').delete().eq('document_id', doc.id);
    }
    const chunks = chunkText(doc.full_text || '');
    if (chunks.length === 0) { stats.no_text++; continue; }
    const rows = chunks.map((text, idx) => ({
      document_id: doc.id,
      chunk_index: idx,
      chunk_text: text,
      doc_type: doc.doc_type,
      doc_title: doc.title,
      doc_top_level_folder: doc.top_level_folder,
      source_path: doc.source_path,
      word_count: text.split(/\s+/).filter(Boolean).length,
      char_count: text.length,
    }));
    if (!isDryRun) {
      // insert in batches of 100 so we don't blow up on huge docs
      for (let j = 0; j < rows.length; j += 100) {
        const batch = rows.slice(j, j + 100);
        const { error } = await supabase.from('mindy_rag_chunks').insert(batch);
        if (error) {
          stats.failed++;
          console.warn(`  FAIL ${doc.title}: ${error.message}`);
          break;
        }
      }
    }
    stats.processed++;
    stats.chunks_inserted += rows.length;
    if (i % 25 === 0 || i === docs.length - 1) {
      console.log(`[${(i + 1).toString().padStart(4)}/${docs.length}] ${doc.doc_type} ${chunks.length} chunks ← ${doc.title?.slice(0, 60)}`);
    }
  }

  console.log('\n========== CHUNKING COMPLETE ==========');
  console.log(`Processed:        ${stats.processed}`);
  console.log(`Skipped existing: ${stats.skipped_existing}`);
  console.log(`Chunks inserted:  ${stats.chunks_inserted}`);
  console.log(`No text:          ${stats.no_text}`);
  console.log(`Failed:           ${stats.failed}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
