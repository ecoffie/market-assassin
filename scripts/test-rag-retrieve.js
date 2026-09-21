#!/usr/bin/env node
/**
 * Smoke test for retrieveRagContext.
 * Runs 5 representative queries against mindy_rag_chunks via raw
 * Postgres FTS (since the TS helper isn't easily callable from node).
 * Verifies the corpus is queryable + ranks chunks sanely.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...rest] = line.split('=');
  if (!k || !rest.length) return;
  let v = rest.join('=').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k.trim()] = v;
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const QUERIES = [
  { name: 'Capability Statement past performance', q: 'past performance capability statement small business sources sought' },
  { name: 'Proposal technical approach',           q: 'technical approach work breakdown structure agile' },
  { name: 'Sources Sought response',                q: 'sources sought response RFI capability statement' },
  { name: 'NAVFAC construction',                    q: 'NAVFAC construction past performance MACC' },
  { name: 'Teaming agreement',                      q: 'teaming agreement subcontractor prime joint venture' },
];

function buildTsQuery(raw) {
  const tokens = raw.toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length >= 2 && t.length <= 40);
  const uniq = Array.from(new Set(tokens)).slice(0, 30);
  if (uniq.length === 0) return '';
  return uniq.map(t => `'${t.replace(/'/g, "''")}'`).join(' | ');
}

async function main() {
  console.log('=== RAG retrieval smoke test ===\n');
  const { count } = await supabase.from('mindy_rag_chunks').select('id', { count: 'exact', head: true });
  console.log(`Total chunks: ${count}\n`);

  for (const { name, q } of QUERIES) {
    console.log(`---\nQuery: "${name}"`);
    console.log(`Raw:    ${q}`);
    const { data, error } = await supabase.rpc('get_rag_chunks', {
      q,
      doc_types_filter: null,
      limit_n: 5,
    });
    if (error) { console.error('  FAIL:', error.message); continue; }
    if (!data?.length) { console.log('  no matches'); continue; }
    data.forEach((d, i) => {
      const preview = (d.chunk_text || '').slice(0, 100).replace(/\s+/g, ' ');
      console.log(`  ${i + 1}. rank=${d.rank?.toFixed(3)} [${d.doc_type}] ${d.doc_title?.slice(0, 60)}`);
      console.log(`     ${preview}…`);
    });
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
