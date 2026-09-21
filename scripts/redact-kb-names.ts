/**
 * KB company-name redaction (exit hygiene) — local tsx, DRY-RUN + BACKUP first.
 *
 * The Mindy knowledge base carries real third-party company data (MIAMI WIIPICA LLC,
 * Toole Corp, TCM Technology Group, etc.) inside ~47 proposal/past-perf/pricing docs.
 * Mindy is built to sell — strip the real names so the docs stay useful as TEMPLATES
 * without the real entity data.
 *
 * Per-doc LLM entity extraction -> redaction map -> replace in full_text -> RE-CHUNK
 * (chunk_text is derived from full_text and is what chat retrieves).
 *
 *   npx tsx scripts/redact-kb-names.ts            # DRY RUN: backup + extract + preview, NO writes
 *   npx tsx scripts/redact-kb-names.ts --apply    # write redacted full_text + re-chunk
 *   npx tsx scripts/redact-kb-names.ts --restore <backupfile>  # rollback
 */
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Direct fetch to OpenAI (no SDK dep) — same endpoint the app uses (call-llm.ts).
async function openaiJson(prompt: string): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}` },
    body: JSON.stringify({
      model: process.env.LLM_OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  return JSON.parse(j.choices?.[0]?.message?.content || '{}');
}

const APPLY = process.argv.includes('--apply');
const RESTORE = process.argv.includes('--restore') ? process.argv[process.argv.indexOf('--restore') + 1] : null;
const RISKY = ['proposal_template', 'technical_volume', 'past_performance', 'cap_statement', 'pricing_volume'];

// Chunker — mirrors scripts/chunk-mindy-rag.js (~500-word passages, 50-word overlap).
function chunkText(text: string, size = 500, overlap = 50): string[] {
  const words = (text || '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const slice = words.slice(i, i + size).join(' ');
    if (slice.trim()) out.push(slice);
    if (i + size >= words.length) break;
  }
  return out;
}

async function extractEntities(title: string, fullText: string): Promise<{ companies: string[]; people: string[]; cages: string[]; other: string[] }> {
  const prompt = `You are redacting a federal proposal template for resale. List EVERY real third-party identifier in this document. Return STRICT JSON:
{"companies":[],"people":[],"cages":[],"other":[]}
- companies: real business names (LLC/Inc/Corp/Group/etc.) — NOT government agencies (Army, Navy, USDA, GSA, DoD), NOT generic words.
- people: real person names.
- cages: CAGE codes, DUNS, UEI.
- other: street addresses, phone numbers, emails.
Do NOT include solicitation numbers, NAICS, PSC, or government org names. If none in a category, return [].

TITLE: ${title}
DOC (first 14000 chars):
${(fullText || '').slice(0, 14000)}`;
  try {
    const j = await openaiJson(prompt);
    return { companies: j.companies || [], people: j.people || [], cages: j.cages || [], other: j.other || [] };
  } catch (e) {
    console.warn('  extract failed:', (e as Error).message.slice(0, 60));
    return { companies: [], people: [], cages: [], other: [] };
  }
}

// Reduce an LLM-returned entity to its CORE matchable form so we catch variants:
// "Miami Wiipica, LLC" → also matches "Miami Wiipica LLC", "Miami Wiipica" alone.
// We build a regex that matches the core words, optionally followed by a suffix.
function coreNames(name: string): string[] {
  const variants = new Set<string>();
  variants.add(name.trim());
  // strip trailing corporate suffix + punctuation → the bare core
  const core = name.replace(/[,.]/g, '').replace(/\s+(LLC|L\.L\.C\.|Inc|Incorporated|Corp|Corporation|Company|Co|Ltd|Group|LP|LLP|PLLC|PC)\.?$/i, '').trim();
  if (core && core.length >= 4) variants.add(core);
  return [...variants];
}

function redact(text: string, ents: { companies: string[]; people: string[]; cages: string[]; other: string[] }): { redacted: string; count: number } {
  let out = text; let count = 0;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'); // tolerate whitespace variants
  const apply = (names: string[], token: string, useCore: boolean) => {
    // longest-first so "Miami Wiipica Excell" redacts before the core "Miami Wiipica"
    const expanded = useCore ? names.flatMap(coreNames) : names.slice();
    for (const n of [...new Set(expanded)].sort((a, b) => b.length - a.length)) {
      if (!n || n.length < 4) continue;
      const re = new RegExp(esc(n), 'gi');
      const m = out.match(re);
      if (m) { count += m.length; out = out.replace(re, token); }
    }
  };
  apply(ents.companies, '[Company]', true);
  apply(ents.people, '[Name]', true);
  apply(ents.cages, '[CAGE]', false);
  apply(ents.other, '[Redacted]', false);
  return { redacted: out, count };
}

async function restore(file: string) {
  const backup = JSON.parse(readFileSync(file, 'utf8')) as Array<{ id: string; full_text: string }>;
  console.log(`Restoring ${backup.length} docs from ${file}...`);
  for (const b of backup) {
    await sb.from('mindy_rag_documents').update({ full_text: b.full_text }).eq('id', b.id);
  }
  console.log('Restored full_text. Re-chunk those docs to regenerate chunk_text.');
}

// Deterministic sweep: take the KNOWN master entity list and loose-match every
// variant across ALL chunks + docs. Guarantees removal (doesn't rely on per-doc LLM
// re-finding). Use after the LLM pass to catch what extraction missed.
async function sweep(apply: boolean) {
  const ents = JSON.parse(readFileSync('scripts/kb-known-entities.json', 'utf8'));
  console.log(`\n=== KB known-entity SWEEP — ${apply ? 'APPLY' : 'DRY RUN'} ===\n`);
  // pull every doc + every chunk that contains ANY known entity, redact, write back
  const TABLES: Array<{ t: string; col: string; idcol: string }> = [
    { t: 'mindy_rag_documents', col: 'full_text', idcol: 'id' },
    { t: 'mindy_rag_chunks', col: 'chunk_text', idcol: 'id' },
  ];
  let grand = 0;
  for (const { t, col, idcol } of TABLES) {
    let from = 0, touched = 0;
    while (true) {
      const { data } = await sb.from(t).select(`${idcol}, ${col}`).range(from, from + 499);
      if (!data || !data.length) break;
      for (const row of data as any[]) {
        const orig = row[col] || '';
        const { redacted, count } = redact(orig, ents);
        if (count > 0) {
          grand += count; touched++;
          if (apply) await sb.from(t).update({ [col]: redacted }).eq(idcol, row[idcol]);
        }
      }
      if (data.length < 500) break;
      from += 500;
    }
    console.log(`  ${t}.${col}: ${touched} rows ${apply ? 'redacted' : 'WOULD redact'}`);
  }
  console.log(`\n  ${apply ? 'APPLIED' : 'DRY RUN'} — ${grand} total replacements`);
}

async function main() {
  if (RESTORE) { await restore(RESTORE); return; }
  if (process.argv.includes('--sweep')) { await sweep(APPLY); return; }

  const { data: docs } = await sb.from('mindy_rag_documents')
    .select('id, title, full_text, doc_type').in('doc_type', RISKY);
  const list = (docs || []).filter(d => d.full_text);
  console.log(`\n=== KB redaction — ${list.length} risky docs | mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'} ===\n`);

  // Phase 0 — BACKUP (always, even in dry-run)
  mkdirSync('backups', { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const backupFile = `backups/kb-redaction-backup-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(list.map(d => ({ id: d.id, title: d.title, full_text: d.full_text })), null, 2));
  console.log(`  ✅ backed up originals → ${backupFile}\n`);

  const allEntities = new Set<string>();
  let totalRedactions = 0;
  for (const d of list) {
    const ents = await extractEntities(d.title || '', d.full_text);
    [...ents.companies, ...ents.people, ...ents.cages].forEach(e => allEntities.add(e));
    const { redacted, count } = redact(d.full_text, ents);
    totalRedactions += count;
    const found = [...ents.companies, ...ents.people, ...ents.cages].slice(0, 5).join(', ') || '(none)';
    console.log(`  [${d.doc_type}] ${(d.title || '').slice(0, 40).padEnd(42)} → ${count} redactions | ${found}`);

    if (APPLY && count > 0) {
      await sb.from('mindy_rag_documents').update({ full_text: redacted }).eq('id', d.id);
      // re-chunk: delete old chunks, insert fresh from redacted text
      await sb.from('mindy_rag_chunks').delete().eq('document_id', d.id);
      const chunks = chunkText(redacted);
      const rows = chunks.map((text, i) => ({
        document_id: d.id, chunk_index: i, chunk_text: text, doc_type: d.doc_type,
        doc_title: d.title, word_count: text.split(/\s+/).length, char_count: text.length,
      }));
      if (rows.length) await sb.from('mindy_rag_chunks').insert(rows);
    }
  }

  console.log(`\n  ${APPLY ? 'APPLIED' : 'DRY RUN'} — ${totalRedactions} total redactions across ${list.length} docs`);
  console.log(`  distinct entities found (${allEntities.size}):`);
  [...allEntities].sort().forEach(e => console.log(`    • ${e}`));
  if (!APPLY) console.log(`\n  Review the entities above. Re-run with --apply to write + re-chunk. Backup: ${backupFile}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
