#!/usr/bin/env node
/**
 * Ingest the in-repo Mindy MCP reference doc(s) into the Mindy RAG corpus so
 * Mindy Chat v2 (POST /api/app/chat → retrieveRagContext → get_rag_chunks FTS)
 * can answer "what does the MCP do / cost / where's the data from" from current facts.
 *
 * Self-contained: upserts each doc into mindy_rag_documents (onConflict source_path)
 * AND re-chunks ONLY those docs into mindy_rag_chunks (500-word / 50-overlap, matching
 * chunk-mindy-rag.js) — so a re-run after editing the doc refreshes just these rows,
 * never the other ~1,000 corpus docs.
 *
 *   node scripts/ingest-mcp-docs.js            # ingest + chunk
 *   node scripts/ingest-mcp-docs.js --dry-run  # preview, no writes
 *
 * Re-run whenever docs/MCP-CHANGELOG.md changes (it's the source of truth). The doc is
 * tagged doc_type='mcp_reference' / top_level_folder='MCP Reference' so it's filterable.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ---- env (dotenv handles CRLF / quoting; a hand parser leaves a trailing \r that
// corrupts the JWT service key → "Invalid API key") ----
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DRY = process.argv.includes('--dry-run');
const WORDS_PER_CHUNK = 500;
const OVERLAP_WORDS = 50;

// The doc(s) to ingest. Repo-relative path is namespaced into source_path so it never
// collides with the ~/ absolute-path docs the main ingester walks.
const DOCS = [
  { rel: 'docs/MCP-CHANGELOG.md', title: 'Mindy MCP — Capabilities Changelog' },
];

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function chunkText(text) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK - OVERLAP_WORDS) {
    chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    if (i + WORDS_PER_CHUNK >= words.length) break;
  }
  return chunks;
}

async function run() {
  console.log(`Mindy MCP → RAG ingest${DRY ? ' (DRY RUN)' : ''}\n`);
  for (const d of DOCS) {
    const abs = path.join(__dirname, '..', d.rel);
    const text = fs.readFileSync(abs, 'utf8');
    const source_path = `market-assassin/${d.rel}`;
    const now = new Date().toISOString();
    const row = {
      source_path,
      filename: path.basename(d.rel),
      file_extension: '.md',
      size_bytes: Buffer.byteLength(text),
      file_mtime: now,
      file_sha256: sha256(text),
      doc_type: 'mcp_reference',
      top_level_folder: 'MCP Reference',
      folder_path: path.dirname(d.rel),
      title: d.title,
      full_text: text,
      text_length: text.length,
      page_count: null,
      word_count: text.split(/\s+/).filter(Boolean).length,
      ingestion_status: 'extracted',
      ingestion_error: null,
      ingested_at: now,
      updated_at: now,
    };
    const chunks = chunkText(text);
    console.log(`• ${d.title}\n  ${row.word_count} words → ${chunks.length} chunks (source_path=${source_path})`);
    if (DRY) continue;

    // 1. Upsert the doc, get its id.
    const { error: upErr } = await supabase.from('mindy_rag_documents').upsert(row, { onConflict: 'source_path' });
    if (upErr) { console.error(`  ✗ doc upsert failed: ${upErr.message}`); process.exitCode = 1; continue; }
    const { data: docRow, error: selErr } = await supabase
      .from('mindy_rag_documents').select('id').eq('source_path', source_path).single();
    if (selErr || !docRow) { console.error(`  ✗ doc id lookup failed: ${selErr?.message}`); process.exitCode = 1; continue; }

    // 2. Replace this doc's chunks only.
    await supabase.from('mindy_rag_chunks').delete().eq('document_id', docRow.id);
    const chunkRows = chunks.map((chunk_text, idx) => ({
      document_id: docRow.id,
      chunk_index: idx,
      chunk_text,
      doc_type: row.doc_type,
      doc_title: row.title,
      doc_top_level_folder: row.top_level_folder,
      source_path,
      word_count: chunk_text.split(/\s+/).filter(Boolean).length,
      char_count: chunk_text.length,
    }));
    for (let j = 0; j < chunkRows.length; j += 100) {
      const { error: chErr } = await supabase.from('mindy_rag_chunks').insert(chunkRows.slice(j, j + 100));
      if (chErr) { console.error(`  ✗ chunk insert failed: ${chErr.message}`); process.exitCode = 1; break; }
    }
    console.log(`  ✓ upserted doc + ${chunkRows.length} chunks`);
  }
  console.log('\nDone.');
}

run().catch((e) => { console.error(e); process.exit(1); });
