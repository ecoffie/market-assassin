#!/usr/bin/env node

/**
 * Smoke-test the Mindy Insights helper against the live RAG library.
 * Hits each of the 5 buckets and prints the quote that would land in
 * a daily alert email.
 *
 * Run: node scripts/test-mindy-insights.js
 */

const path = require('path');
const fs = require('fs');

// Load env so the helper can reach Supabase
const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...r] = line.split('=');
  if (!k || !r.length) return;
  let v = r.join('=').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k.trim()] = v;
});

// Compile-on-the-fly via tsx — falls back to require for plain JS
async function main() {
  // Use esbuild-register style? Simpler: run the helper via the
  // Next dev server's compiled output isn't available, so call the
  // primitives directly via @supabase + the same RPC.
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const BUCKETS = {
    rfp: 'proposal compliance evaluation factors',
    sources_sought: 'sources sought capability statement',
    rfq: 'request for quote pricing',
    presolicitation: 'presolicitation acquisition planning',
    combined: 'combined synopsis solicitation timeline',
  };

  function extractQuote(chunkText) {
    if (!chunkText) return null;
    const cleaned = chunkText
      .replace(/^#+\s.*$/gm, '')
      .replace(/^[-*•]\s+/gm, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
    let best = null;
    for (const s of sentences) {
      if (s.length < 60 || s.length > 240) continue;
      if (/^[A-Z\s\d.,'-]+$/.test(s)) continue;
      if (/^(##|---|\*|\d+\.)/.test(s)) continue;
      if (/https?:\/\//.test(s)) continue;
      if (/\$\d/.test(s) && /\d{4,}/.test(s)) continue;
      let score = 0;
      if (s.length >= 100 && s.length <= 180) score += 10;
      if (/^(The|A|When|If|Most|Federal|Every|Government|Small|Always|Don't|Never)/.test(s)) score += 5;
      if (/[a-z],/.test(s)) score += 2;
      if (!best || score > best.score) best = { s, score };
    }
    return best?.s || null;
  }

  for (const [bucket, query] of Object.entries(BUCKETS)) {
    const { data, error } = await supa.rpc('get_rag_chunks', {
      q: query,
      doc_types_filter: null,
      limit_n: 8,
    });
    if (error) {
      console.log(`[${bucket}] ❌ ${error.message}`);
      continue;
    }
    if (!data || !data.length) {
      console.log(`[${bucket}] (no results)`);
      continue;
    }
    let quote = null;
    let source = null;
    for (const row of data) {
      const q = extractQuote(row.chunk_text);
      if (q) {
        quote = q;
        source = `${row.doc_title} [${row.doc_type}]`;
        break;
      }
    }
    console.log(`\n[${bucket}]`);
    console.log(`  source: ${source || '(none)'}`);
    console.log(`  quote:  ${quote || '(no quote-shaped sentence found)'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
