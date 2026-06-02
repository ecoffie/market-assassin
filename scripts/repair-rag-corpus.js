#!/usr/bin/env node

/**
 * Repair Mindy RAG corpus classifications.
 *
 * Default mode is read-only dry run:
 *   node scripts/repair-rag-corpus.js
 *
 * Apply high-confidence reclassifications:
 *   node scripts/repair-rag-corpus.js --apply
 *
 * Optional:
 *   --env=.env.codex-production
 *   --limit=10
 *   --type=technical_volume
 *
 * Updates both mindy_rag_documents.doc_type and the denormalized
 * mindy_rag_chunks.doc_type so retrieval filters immediately see the
 * repaired format type.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const envArg = args.find((arg) => arg.startsWith('--env='));
const ENV_FILE = envArg ? envArg.split('=')[1] : '.env.local';
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const typeArg = args.find((arg) => arg.startsWith('--type='));
const TYPE_FILTER = typeArg ? typeArg.split('=')[1] : '';

function loadEnv(file) {
  const envPath = path.resolve(process.cwd(), file);
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    if (!line || line.startsWith('#')) return;
    const [key, ...rest] = line.split('=');
    if (!key || rest.length === 0) return;
    let value = rest.join('=').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key.trim()] = value;
  });
  return env;
}

const PROTECTED_TEACHING_TYPES = new Set([
  'podcast_interview',
  'webinar_resource',
  'qa_dataset',
  'ebook',
]);

function hasResponseIntent(text) {
  return (
    text.includes('response') ||
    text.includes('responding') ||
    text.includes('proposal') ||
    text.includes('submittal') ||
    text.includes('template') ||
    text.includes('sample')
  );
}

function classifyDoc(doc) {
  const filename = String(doc.filename || '').toLowerCase();
  const title = String(doc.title || '').toLowerCase();
  const sourcePath = String(doc.source_path || '').toLowerCase();
  const fileTitle = `${filename} ${title}`;
  const protectedTeaching = PROTECTED_TEACHING_TYPES.has(doc.doc_type || '') || sourcePath.includes('govcon-giants-podcast');

  const actualDocumentOnly = (suggestedDocType, confidence, reason) => {
    if (protectedTeaching) return null;
    if (suggestedDocType === doc.doc_type) return null;
    return { suggestedDocType, confidence, reason };
  };

  if (/\bss\s*-\s*loi\b/.test(fileTitle) || fileTitle.includes('letter of intent') || sourcePath.includes('sample loi')) {
    return actualDocumentOnly('sources_sought_loi', 'high', 'filename/title indicates an LOI or Sources Sought LOI document');
  }

  if (fileTitle.includes('statement of capability') && (fileTitle.includes('sources sought') || fileTitle.includes('source sought'))) {
    return actualDocumentOnly('sources_sought_loi', 'high', 'statement-of-capability document tied to Sources Sought language');
  }

  if (
    hasResponseIntent(fileTitle) &&
    (/\brfi\b/.test(fileTitle) || fileTitle.includes('request for information'))
  ) {
    return actualDocumentOnly('rfi_response', 'medium', 'filename/title indicates RFI response material');
  }

  if (
    fileTitle.includes('quote response') ||
    fileTitle.includes('quote proposal') ||
    (
      hasResponseIntent(fileTitle) &&
      (/\brfq\b/.test(fileTitle) || fileTitle.includes('request for quotation'))
    )
  ) {
    return actualDocumentOnly('rfq_response', 'high', 'filename/title indicates RFQ or quote response material');
  }

  if (
    fileTitle.includes('volume i - technical') ||
    fileTitle.includes('vol 1_technical') ||
    fileTitle.includes('vol 1 technical') ||
    fileTitle.includes('vol i technical') ||
    fileTitle.includes('technical proposal') ||
    fileTitle.includes('technical approach sample')
  ) {
    return actualDocumentOnly('technical_volume', 'high', 'filename/title indicates a technical proposal volume');
  }

  if (fileTitle.includes('management volume') || fileTitle.includes('management approach') || fileTitle.includes('staffing plan')) {
    return actualDocumentOnly('management_volume', 'medium', 'filename/title indicates management proposal material');
  }

  if (
    !fileTitle.includes('non-price proposal') &&
    !fileTitle.includes('non price proposal') &&
    (
      fileTitle.includes('price proposal') ||
      fileTitle.includes('pricing volume') ||
      fileTitle.includes('price volume') ||
      fileTitle.includes('cost volume')
    )
  ) {
    return actualDocumentOnly('pricing_volume', 'high', 'filename/title indicates pricing or cost proposal material');
  }

  if (fileTitle.includes('cap statement') || fileTitle.includes('capability statement')) {
    return actualDocumentOnly('cap_statement', 'high', 'filename/title indicates a capability statement document');
  }

  if (fileTitle.includes('past performance') || fileTitle.includes('volume ii_past performance')) {
    return actualDocumentOnly('past_performance', 'high', 'filename/title indicates past performance proposal material');
  }

  return null;
}

async function fetchAllDocs(supabase) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('mindy_rag_documents')
      .select('id, source_path, filename, title, doc_type, ingestion_status, text_length')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const env = loadEnv(ENV_FILE);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${ENV_FILE}`);
  }

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const docs = await fetchAllDocs(supabase);
  let candidates = docs
    .map((doc) => ({ doc, suggestion: classifyDoc(doc) }))
    .filter((item) => item.suggestion)
    .filter((item) => !TYPE_FILTER || item.suggestion.suggestedDocType === TYPE_FILTER);

  candidates = candidates.slice(0, LIMIT);

  const byType = candidates.reduce((acc, item) => {
    const key = item.suggestion.suggestedDocType;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(`Mindy RAG corpus repair — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Env: ${ENV_FILE}`);
  console.log(`Docs scanned: ${docs.length}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log('By suggested type:', byType);
  console.log('');

  candidates.slice(0, 40).forEach(({ doc, suggestion }, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. ${doc.doc_type} -> ${suggestion.suggestedDocType} [${suggestion.confidence}] ${doc.title || doc.filename}`);
    console.log(`    ${suggestion.reason}`);
  });

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to update documents and chunks.');
    return;
  }

  let updatedDocs = 0;
  let updatedChunks = 0;
  for (const { doc, suggestion } of candidates) {
    const nextType = suggestion.suggestedDocType;
    const { error: docErr } = await supabase
      .from('mindy_rag_documents')
      .update({ doc_type: nextType, updated_at: new Date().toISOString() })
      .eq('id', doc.id);
    if (docErr) {
      console.warn(`Document update failed for ${doc.id}: ${docErr.message}`);
      continue;
    }
    updatedDocs++;

    const { count, error: chunkErr } = await supabase
      .from('mindy_rag_chunks')
      .update({ doc_type: nextType }, { count: 'exact' })
      .eq('document_id', doc.id);
    if (chunkErr) {
      console.warn(`Chunk update failed for ${doc.id}: ${chunkErr.message}`);
      continue;
    }
    updatedChunks += count || 0;
  }

  console.log(`\nUpdated documents: ${updatedDocs}`);
  console.log(`Updated chunks: ${updatedChunks}`);
}

main().catch((err) => {
  console.error(`RAG_REPAIR_FAILED: ${err.message}`);
  process.exit(1);
});
