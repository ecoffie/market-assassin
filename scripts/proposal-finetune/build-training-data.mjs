/**
 * Build the proposal fine-tune training data (mirrors the Content Reaper
 * LinkedIn pipeline). Pulls winning proposal docs from mindy_rag_documents,
 * shapes them into {system, user, assistant} examples, and writes:
 *   - proposal_finetune.jsonl        (the OpenAI training file)
 *   - proposal_finetune_review.md    (REVIEW THIS BEFORE TRAINING)
 *
 * Run: node scripts/proposal-finetune/build-training-data.mjs
 * (loads .env.local for Supabase creds)
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// --- load .env.local via dotenv (handles quoting/multiline correctly) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase env — check .env.local'); process.exit(1);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Section "voice" prompts per doc type — what the model should learn to write.
const SYSTEM_BY_TYPE = {
  sources_sought_loi: 'You are a senior federal proposal writer. Write a Sources Sought / Letter of Intent response in a confident, specific, capability-forward voice — concrete past performance and scope fit, no marketing fluff, no "world-class/cutting-edge/leverage".',
  technical_volume: 'You are a senior federal proposal writer. Write a technical volume section that is compliant, evaluation-factor aware, and grounded in concrete approach + past performance. No fluff, no GPT intros, no stacked adjectives.',
  cap_statement: 'You are a senior federal proposal writer. Write a capability statement in a crisp, differentiator-forward voice — core competencies, past performance, and the agency-fit angle. No fluff.',
  past_performance: 'You are a senior federal proposal writer. Write a past performance write-up: relevant contract, scope, outcomes, and why it maps to the requirement. Specific and factual.',
  proposal_template: 'You are a senior federal proposal writer. Produce a clean, compliant proposal section in federal capture voice.',
};

// CLEAN a doc into training-worthy prose: strip letterhead/contact blocks, PII
// (names/emails/phones/DUNS/CAGE — also cannot legally go to OpenAI), page
// furniture, and leading list-fragments. Returns cleaned text.
function cleanText(raw) {
  let t = raw;
  // Remove PII / identifiers (also a legal requirement for OpenAI training).
  t = t.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]');
  t = t.replace(/\b(?:DUNS|CAGE\s*Code|CAGE|UEI|EIN|TIN)\s*:?\s*[A-Z0-9-]+/gi, '');
  t = t.replace(/\b\d{3}[.\-\s]\d{3}[.\-\s]\d{4}\b/g, '[phone]'); // phone numbers
  t = t.replace(/\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Suite|Ste|Lane|Blvd|Boulevard)\b[^\n]*/g, '[address]');
  // Strip a leading letterhead/salutation block (everything up to and incl.
  // "Dear ...," when present in the first ~800 chars — that's the letter header).
  const dear = t.slice(0, 900).search(/\bDear\s+[A-Z][^,\n]{0,40},/);
  if (dear >= 0) t = t.slice(t.indexOf(',', t.search(/\bDear\b/)) + 1);
  // Strip page furniture.
  t = t.replace(/page\s+\d+\s+of\s+\d+/gi, '').replace(/\f/g, '\n');
  // Drop a leading fragment: if the text starts mid-list/mid-sentence (lowercase
  // or a bare number), cut to the first real heading or capitalized sentence.
  const startMatch = t.search(/(?:^|\n)\s*(?:[A-Z][a-z]+\s){2,}|(?:SECTION|VOLUME|[0-9]+\.[0-9]?\s+[A-Z])/);
  if (startMatch > 0 && /^\s*(?:\d+\.|[a-z])/.test(t)) t = t.slice(startMatch);
  return t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// Quality gates — flag (don't silently drop) so Eric can review.
function qualityFlags(text) {
  const flags = [];
  const wc = text.split(/\s+/).filter(Boolean).length;
  if (wc < 120) flags.push(`SHORT (${wc} words)`);
  if (wc > 1400) flags.push(`LONG (${wc} words) — consider slicing`);
  if (/world-class|cutting-edge|state-of-the-art|leverage|synergistic|robust scalable/i.test(text)) flags.push('AI-TELL phrases present');
  if (/lorem ipsum|\[insert|\[placeholder|xxxx/i.test(text)) flags.push('PLACEHOLDER text');
  if (/page \d+ of \d+|\f/i.test(text)) flags.push('PAGE-FURNITURE (headers/footers leaked)');
  const printable = text.replace(/[^\x20-\x7E\n]/g, '').length / Math.max(text.length, 1);
  if (printable < 0.9) flags.push('NON-TEXT (likely OCR/table noise)');
  return flags;
}

// Reverse-engineer a plausible "user" prompt from the doc itself (we don't have
// the original RFP). Uses the title + the first lines for context.
function userPrompt(docType, title, text) {
  const subject = (text.match(/subject:\s*(.+)/i)?.[1] || title || '').slice(0, 120).trim();
  const label = {
    sources_sought_loi: 'a Sources Sought / Letter of Intent response',
    technical_volume: 'the technical approach section',
    cap_statement: 'a capability statement',
    past_performance: 'a past performance write-up',
    proposal_template: 'a proposal section',
  }[docType] || 'a proposal section';
  return `Write ${label} for this opportunity: ${subject || title}`;
}

// Slice a long technical volume into section-sized chunks at heading boundaries.
function sliceSections(text, maxWords = 900) {
  const parts = text.split(/\n(?=(?:[0-9]+\.[0-9]?\s+[A-Z]|SECTION\s|VOLUME\s|[A-Z][A-Z ]{6,}\n))/);
  const out = [];
  for (const p of parts) {
    const wc = p.split(/\s+/).filter(Boolean).length;
    if (wc >= 120 && wc <= maxWords) out.push(p.trim());
  }
  return out.length ? out : [text]; // fallback: whole doc
}

async function main() {
  const TYPES = Object.keys(SYSTEM_BY_TYPE);
  const examples = [];
  const review = ['# Proposal fine-tune — REVIEW BEFORE TRAINING\n'];

  for (const docType of TYPES) {
    const { data } = await sb
      .from('mindy_rag_documents')
      .select('title, full_text, word_count')
      .eq('doc_type', docType)
      .eq('has_pii', false)
      .gt('word_count', 100);

    for (const doc of (data || [])) {
      const fullText = (doc.full_text || '').trim();
      if (!fullText) continue;
      // Slice big technical volumes; keep others whole.
      const rawChunks = docType === 'technical_volume' ? sliceSections(fullText) : [fullText.slice(0, 6000)];
      for (const raw of rawChunks) {
        const chunk = cleanText(raw); // strip letterhead/PII/page-furniture/fragments
        if (chunk.split(/\s+/).filter(Boolean).length < 120) continue; // too short after cleaning
        const flags = qualityFlags(chunk);
        // Residual PII = block (legal + quality).
        if (/\b[A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+\b/.test(chunk) && /\b(Mr|Ms|Mrs|Dr|Contracting Officer|Contract Specialist)\b/.test(chunk)) {
          flags.push('RESIDUAL-PII (name/title)');
        }
        const ex = {
          messages: [
            { role: 'system', content: SYSTEM_BY_TYPE[docType] },
            { role: 'user', content: userPrompt(docType, doc.title, chunk) },
            { role: 'assistant', content: chunk },
          ],
        };
        examples.push({ ex, flags, docType, title: doc.title });
      }
    }
  }

  // Write the JSONL (only examples with NO blocking flags by default; flagged
  // ones go to review so Eric decides). Blocking = placeholder/non-text.
  const blocking = (f) => f.some(x => x.startsWith('PLACEHOLDER') || x.startsWith('NON-TEXT') || x.startsWith('PAGE-FURNITURE') || x.startsWith('RESIDUAL-PII'));
  const clean = examples.filter(e => !blocking(e.flags));
  const flaggedOut = examples.filter(e => blocking(e.flags));

  const outJsonl = path.join(__dirname, 'proposal_finetune.jsonl');
  fs.writeFileSync(outJsonl, clean.map(e => JSON.stringify(e.ex)).join('\n') + '\n');

  // Review file — by type, with flags + a snippet.
  review.push(`Total candidate examples: ${examples.length}`);
  review.push(`Written to JSONL (clean): ${clean.length}`);
  review.push(`Excluded (placeholder/non-text/page-furniture): ${flaggedOut.length}`);
  review.push(`\n> OpenAI needs ≥10; 50-100+ is better. Cut anything off-voice below.\n`);
  const byType = {};
  for (const e of clean) (byType[e.docType] ||= []).push(e);
  for (const [t, list] of Object.entries(byType)) {
    review.push(`\n## ${t} — ${list.length} examples`);
    list.forEach((e, i) => {
      review.push(`\n### ${i + 1}. ${e.title?.slice(0, 60)}${e.flags.length ? `  ⚠️ ${e.flags.join(', ')}` : ''}`);
      review.push('```');
      review.push(e.ex.messages[2].content.slice(0, 400) + (e.ex.messages[2].content.length > 400 ? ' …' : ''));
      review.push('```');
    });
  }
  fs.writeFileSync(path.join(__dirname, 'proposal_finetune_review.md'), review.join('\n'));

  console.log(`✅ ${clean.length} training examples → proposal_finetune.jsonl`);
  console.log(`📋 Review ${flaggedOut.length} excluded + voice-check all in proposal_finetune_review.md`);
  console.log(`   (OpenAI minimum is 10; aim for 50+ clean ones before training.)`);
}

main().catch(e => { console.error(e); process.exit(1); });
