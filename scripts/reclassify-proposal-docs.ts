/**
 * Reclassify already-ingested RAG docs whose doc_type is wrong — specifically
 * the proposal sub-documents (QCP / Safety / Accident Prevention / CMP) and the
 * MACC volume files that landed in 'misc' and were therefore invisible to the
 * proposal RAG retrieval (getTemplateCorpusDocTypes).
 *
 * Applies the SAME rules as the (updated) classifyDocType in ingest-mindy-rag.js
 * to each document's title/source_path, and updates doc_type on both
 * mindy_rag_documents and its mindy_rag_chunks where it changed.
 *
 * Dry-run by default; pass --apply to write.
 *
 * Run:  npx tsx scripts/reclassify-proposal-docs.ts          (preview)
 *       npx tsx scripts/reclassify-proposal-docs.ts --apply  (write)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes('--apply');

// Mirror of the proposal-relevant rules in ingest-mindy-rag.js classifyDocType.
// We ONLY reclassify INTO these proposal types — we never touch a doc that
// already has a non-proposal type, and we only reclassify FROM 'misc' or a
// clearly-wrong proposal tag, to avoid clobbering good classifications.
function proposalType(name: string): string | null {
  const n = name.toLowerCase();
  if (
    n.includes('quality plan') || n.includes('quality control plan') || /\bqcp\b/.test(n) ||
    n.includes('safety plan') || n.includes('accident prevention') ||
    n.includes('contract management plan') || /\bcmpv?\d?\b/.test(n)
  ) return 'proposal_subdoc';
  if (n.includes('technical volume') || n.includes('technical approach') || /vol(ume)?\s*\bi\b.*tech|tech.*vol(ume)?\s*\bi\b/.test(n)) return 'technical_volume';
  if (n.includes('management volume') || n.includes('management approach') || n.includes('staffing plan')) return 'management_volume';
  // NON-price / non-cost proposal is the TECHNICAL volume, not pricing — must
  // exclude it before the price match (else "non-price proposal" → pricing).
  if (/non[-\s]?price|non[-\s]?cost/.test(n)) return 'technical_volume';
  if (n.includes('pricing volume') || n.includes('price volume') || n.includes('cost volume') || /price proposal|vol(ume)?\s*iii.*pric|pric.*vol(ume)?\s*iii/.test(n)) return 'pricing_volume';
  if (n.includes('past performance') || n.includes('past-performance') || /vol(ume)?\s*ii\b(?!i)/.test(n)) return 'past_performance';
  if (n.includes('contract forms') || n.includes('solicitation & award') || n.includes('solicitation and award') || /vol(ume)?\s*iv\b/.test(n)) return 'contract_forms';
  return null;
}

// Only RE-tag docs currently in one of these "needs fixing" buckets.
const RECLASSIFIABLE_FROM = new Set(['misc', 'proposal_template', 'teaching_handout']);

async function main() {
  const { data: docs, error } = await sb
    .from('mindy_rag_documents')
    .select('id, doc_type, title, source_path');
  if (error) throw new Error(error.message);

  const changes: Array<{ id: string; from: string; to: string; name: string }> = [];
  for (const d of docs || []) {
    if (!RECLASSIFIABLE_FROM.has(d.doc_type)) continue;
    const name = `${d.title || ''} ${d.source_path || ''}`;
    const target = proposalType(name);
    if (target && target !== d.doc_type) {
      changes.push({ id: d.id, from: d.doc_type, to: target, name: (d.title || d.source_path || '').split('/').pop()?.slice(0, 55) || '' });
    }
  }

  console.log(`${changes.length} doc(s) to reclassify${APPLY ? ' (APPLYING)' : ' (dry-run — pass --apply to write)'}:\n`);
  for (const c of changes) console.log(`  ${c.from} → ${c.to}   ${c.name}`);

  if (APPLY && changes.length) {
    for (const c of changes) {
      const { error: de } = await sb.from('mindy_rag_documents').update({ doc_type: c.to }).eq('id', c.id);
      if (de) { console.error(`  doc ${c.id}: ${de.message}`); continue; }
      // keep chunks in sync (they carry doc_type for the RPC filter)
      await sb.from('mindy_rag_chunks').update({ doc_type: c.to }).eq('document_id', c.id);
    }
    console.log(`\n✓ Reclassified ${changes.length} docs + their chunks.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
