#!/usr/bin/env node

/**
 * Ingest the Fort Belvoir Building 508 sample bid into Mindy's RAG library.
 *
 * Source: docs/Sample Fort Belovoir.xlsx - Building 508.csv
 *         A real winning $185,524.93 federal construction bid (Jan 2015),
 *         with line-item bid notes explaining the reasoning behind each
 *         cost. This is exactly the kind of fuel Mindy's Proposal Assist
 *         needs when a construction-NAICS user is drafting.
 *
 * What this does:
 *   1. Reads the CSV, extracts the labor / equipment / per-diem / ODC /
 *      G&A / fee / bond structure + bid notes.
 *   2. Reshapes into a narrative document that an LLM can actually use
 *      as a style + reasoning reference (not raw cells).
 *   3. Inserts ONE row into mindy_rag_documents with:
 *        doc_type = 'estimating_example'
 *        related_naics = ['236220','236210','236118','238210','238220']
 *        usage_rights = 'eric_owned'
 *   4. Chunks it into mindy_rag_chunks the same way scripts/chunk-mindy-rag.js
 *      does (~500 words, 50-word overlap), so retrieveRagContext() picks it up.
 *
 * Idempotent — re-running deletes the prior row + chunks first.
 *
 * Why this fits the simplification rule: NO new UI, NO new endpoint,
 * NO new tool. Just becomes Mindy fuel for construction proposals.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

const CSV_PATH = path.join(__dirname, '..', 'docs', 'Sample Fort Belovoir.xlsx - Building 508.csv');
const SOURCE_PATH = 'docs/Sample Fort Belovoir.xlsx - Building 508.csv';

// ---- naive CSV parser (handles quoted commas) -------------------
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// ---- chunking (mirrors scripts/chunk-mindy-rag.js) --------------
const WORDS_PER_CHUNK = 500;
const OVERLAP_WORDS = 50;

function chunkText(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  if (words.length <= WORDS_PER_CHUNK) return [cleaned];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    if (i + WORDS_PER_CHUNK >= words.length) break;
    i += WORDS_PER_CHUNK - OVERLAP_WORDS;
  }
  return chunks;
}

// ---- reshape CSV → narrative text -------------------------------
//
// The CSV is a multi-CLIN budget grid. What we want is the reasoning,
// not the spreadsheet. So we extract:
//   - Header context (project, total, bid date)
//   - Each line item: label, rate, total hours, total $, bid note
//   - Roll-up math: direct labor, ODCs, G&A %, fee %, bond %
//
// Bid notes are the gold — that's what a draft prompt would learn from.

function buildNarrative(csvText) {
  const lines = csvText.split(/\r?\n/).map(parseCsvLine);

  // Sniff totals + project metadata
  let projectTotal = '';
  let bidDate = '';
  let projectName = '';
  const clinLabels = [];
  const lineItems = [];

  // CLIN labels live on row 2 (index 1)
  if (lines[1]) {
    for (const cell of lines[1]) {
      if (cell.startsWith('CLIN ') || cell.match(/^00\d+ --/)) {
        clinLabels.push(cell);
      }
    }
  }

  for (const cols of lines) {
    if (!cols || !cols[0]) continue;
    const label = cols[0].trim();
    if (!label) continue;

    if (label.startsWith('$') && cols[0].match(/\$[\d,]+\.\d{2}/)) {
      projectTotal = cols[0];
    }
    if (label.startsWith('Bid Submitted')) {
      bidDate = label.replace('Bid Submitted - ', '').trim();
    }
    if (label === 'Project - Enter Project Name and CSI Division Number') {
      projectName = cols[2] || cols[1] || '';
    }

    // Extract line items: ones with rate + total + note (skip pure
    // total rows like "TOTAL DIRECT LABOR" — those we capture
    // separately below).
    const rateCell = cols[1] || '';
    const noteCell = cols[33] || cols[cols.length - 1] || '';

    const isRateRow = /\$[\d.]+|\d+\.\d{2}%/.test(rateCell);
    const hasNote = noteCell && noteCell.length > 30 && !noteCell.match(/^[\$\d.,\s]+$/);

    if (isRateRow && hasNote) {
      // Total $ is in the last "Hours $" pair before the Summary col.
      // Easiest: find the last currency-looking number in the row.
      let totalDollar = '';
      for (let i = cols.length - 1; i >= 0; i--) {
        const cell = cols[i];
        if (cell && /\$[\d,]+\.\d{2}/.test(cell) && !cell.includes('$0.00')) {
          totalDollar = cell.trim();
          break;
        }
      }
      lineItems.push({
        label,
        rate: rateCell.trim(),
        total: totalDollar,
        note: noteCell.trim(),
      });
    }
  }

  // Pick out the roll-up rows
  const rollups = {};
  for (const cols of lines) {
    const lbl = (cols[0] || '').trim().toUpperCase();
    if (!lbl) continue;
    const lastDollar = (() => {
      for (let i = cols.length - 1; i >= 0; i--) {
        const c = cols[i] || '';
        if (/\$[\d,]+\.\d{2}/.test(c) && !c.includes('$0.00')) return c.trim();
      }
      return '';
    })();
    if (lbl.startsWith('TOTAL DIRECT "L" LABOR')) rollups.directLabor = lastDollar;
    if (lbl === 'TOTAL OTHER DIRECT COSTS') rollups.odcs = lastDollar;
    if (lbl === 'TOTAL DIRECT PLUS ODCS') rollups.directPlusOdcs = lastDollar;
    if (lbl.startsWith('G & A')) rollups.ga = `${cols[1] || ''} → ${lastDollar}`;
    if (lbl === 'TOTAL COST W/O FEE') rollups.costWithoutFee = lastDollar;
    if (lbl === 'FEE') rollups.fee = `${cols[1] || ''} → ${lastDollar}`;
    if (lbl === 'TOTAL COST WITH FEE') rollups.costWithFee = lastDollar;
    if (lbl === 'BONDS') rollups.bonds = lastDollar;
    if (lbl === 'TOTAL COST WITH BONDS') rollups.grandTotal = lastDollar;
  }

  // Assemble narrative text
  let out = '';
  out += `# Federal Construction Bid Reference — Fort Belvoir Building 508\n\n`;
  out += `This is a real winning federal construction proposal cost structure. ASL `;
  out += `submitted this bid on ${bidDate || 'January 27, 2015'} for ${projectTotal || '$185,524.93'} `;
  out += `to renovate lab and office space in Building 508 at Fort Belvoir, with `;
  out += `additional CLINs for power installation, autoclave install/removal, and `;
  out += `cooler/freezer removal. Use this as a reasoning + cost-structure reference `;
  out += `when drafting federal construction proposals — especially the bid notes `;
  out += `that explain WHY each cost is what it is.\n\n`;

  if (clinLabels.length) {
    out += `## CLINs Bid On\n\n`;
    for (const c of clinLabels) out += `- ${c}\n`;
    out += `\n`;
  }

  out += `## Line-Item Cost Structure with Bid-Note Reasoning\n\n`;
  out += `Each line below is a real cost the contractor included, with the `;
  out += `reasoning that justified it to the contracting officer.\n\n`;
  for (const item of lineItems) {
    out += `### ${item.label}\n`;
    out += `- Rate: ${item.rate}\n`;
    if (item.total) out += `- Total: ${item.total}\n`;
    out += `- Reasoning: ${item.note}\n\n`;
  }

  out += `## Cost Roll-Up Structure (the math chain)\n\n`;
  out += `Federal construction bids stack costs in a specific order. This bid `;
  out += `followed the standard chain:\n\n`;
  if (rollups.directLabor) out += `1. Total Direct Labor: ${rollups.directLabor}\n`;
  if (rollups.odcs) out += `2. Total Other Direct Costs (equipment, per diem, materials, subs): ${rollups.odcs}\n`;
  if (rollups.directPlusOdcs) out += `3. Total Direct + ODCs: ${rollups.directPlusOdcs}\n`;
  if (rollups.ga) out += `4. G&A (General & Administrative overhead): ${rollups.ga}\n`;
  if (rollups.costWithoutFee) out += `5. Total Cost Without Fee: ${rollups.costWithoutFee}\n`;
  if (rollups.fee) out += `6. Fee (profit): ${rollups.fee}\n`;
  if (rollups.costWithFee) out += `7. Total Cost With Fee: ${rollups.costWithFee}\n`;
  if (rollups.bonds) out += `8. Performance + Payment Bonds: ${rollups.bonds}\n`;
  if (rollups.grandTotal) out += `9. **Grand Total Bid: ${rollups.grandTotal}**\n`;
  out += `\n`;

  out += `## Federal Construction Estimating Lessons from This Bid\n\n`;
  out += `- **Per-diem realism beats GSA defaults**: ASL substituted a $400/week `;
  out += `weekly-rental rate for the GSA $186/night standard, because they actually `;
  out += `priced what 3 months of housing costs in the region. Specificity > defaults.\n`;
  out += `- **Time the personnel against the schedule, not the contract**: PM is `;
  out += `priced at 45 days × 8 hours (half the 90-day duration); Superintendent at `;
  out += `the full 90 days. Different roles burn different shares of the timeline.\n`;
  out += `- **Show the math on every line**: Every line item carries a bid note that `;
  out += `explains "based on X days × Y hours" — that's what gets you past technical evaluation.\n`;
  out += `- **Travel home is a real cost**: Per-trip airfare × 4 trips covers the `;
  out += `every-other-weekend pattern field staff actually use. Hiding it gets you a `;
  out += `change order; surfacing it gets you paid.\n`;
  out += `- **Bonds + G&A + Fee + Bonds (again)**: This bid wrapped bonds OUTSIDE of `;
  out += `the G&A+fee chain, because bonds are a percentage of the bonded contract `;
  out += `value, not part of cost-plus-fee math. Order matters.\n`;
  out += `- **CLIN structure**: One primary CLIN held most of the labor and overhead; `;
  out += `optional CLINs were priced lean so the gov could exercise without `;
  out += `triggering a new BPA. Defense in depth on award shaping.\n`;

  return out.trim();
}

// ---- main -------------------------------------------------------
async function main() {
  console.log('[fort-belvoir-bid] Reading CSV…');
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const narrative = buildNarrative(csv);

  console.log(`[fort-belvoir-bid] Narrative built: ${narrative.length} chars, ${narrative.split(/\s+/).length} words`);

  // Sha for change detection on future re-runs
  const sha = crypto.createHash('sha256').update(narrative).digest('hex');

  // Delete prior copy (idempotent re-ingest)
  const { data: existing } = await supabase
    .from('mindy_rag_documents')
    .select('id')
    .eq('source_path', SOURCE_PATH)
    .maybeSingle();

  if (existing?.id) {
    console.log(`[fort-belvoir-bid] Removing prior copy ${existing.id}…`);
    await supabase.from('mindy_rag_chunks').delete().eq('document_id', existing.id);
    await supabase.from('mindy_rag_documents').delete().eq('id', existing.id);
  }

  // Insert document
  const stat = fs.statSync(CSV_PATH);
  const wordCount = narrative.split(/\s+/).filter(Boolean).length;
  const { data: doc, error: docErr } = await supabase
    .from('mindy_rag_documents')
    .insert({
      source_path: SOURCE_PATH,
      filename: 'Sample Fort Belovoir.xlsx - Building 508.csv',
      file_extension: 'csv',
      size_bytes: stat.size,
      file_mtime: stat.mtime.toISOString(),
      file_sha256: sha,
      doc_type: 'estimating_example',
      top_level_folder: 'docs',
      folder_path: 'docs',
      title: 'Fort Belvoir Building 508 — Winning Federal Construction Bid ($185K)',
      full_text: narrative,
      text_length: narrative.length,
      word_count: wordCount,
      topic_tags: ['federal-construction', 'cost-estimating', 'bid-structure', 'per-diem', 'g-and-a', 'fee', 'bonds', 'CLINs'],
      related_naics: ['236220', '236210', '236118', '238210', '238220'],
      one_line_summary: 'Real winning $185K federal construction bid (Fort Belvoir, 2015) with line-item bid notes — use as cost-structure + reasoning reference for construction proposals.',
      has_pii: false,
      usage_rights: 'eric_owned',
      ingestion_status: 'extracted',
      ingested_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (docErr || !doc) {
    console.error('[fort-belvoir-bid] doc insert failed:', docErr?.message);
    process.exit(1);
  }
  console.log(`[fort-belvoir-bid] Inserted document ${doc.id}`);

  // Chunk + insert
  const chunks = chunkText(narrative);
  console.log(`[fort-belvoir-bid] Chunked into ${chunks.length} passages`);

  const rows = chunks.map((text, idx) => ({
    document_id: doc.id,
    chunk_index: idx,
    chunk_text: text,
    doc_type: 'estimating_example',
    doc_title: 'Fort Belvoir Building 508 — Winning Federal Construction Bid ($185K)',
    doc_top_level_folder: 'docs',
    source_path: SOURCE_PATH,
    word_count: text.split(/\s+/).filter(Boolean).length,
    char_count: text.length,
  }));

  const { error: chunkErr } = await supabase.from('mindy_rag_chunks').insert(rows);
  if (chunkErr) {
    console.error('[fort-belvoir-bid] chunk insert failed:', chunkErr.message);
    process.exit(1);
  }

  console.log(`[fort-belvoir-bid] ✅ Done: 1 doc + ${chunks.length} chunks indexed for retrieval.`);
  console.log('[fort-belvoir-bid] Try: /api/admin/rag-library?op=search&q=federal+construction+per+diem');
}

main().catch(e => { console.error(e); process.exit(1); });
