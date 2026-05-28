#!/usr/bin/env node

/**
 * Extract structured metadata from GovCon Giants Podcast transcripts.
 *
 * For each podcast_interview document in mindy_rag_documents that has
 * a transcript (full_text contains the "## Transcript" marker we wrote
 * during the Phase 2 refold), call Groq Llama 3.3 70B with a strict
 * JSON prompt and store the result in podcast_episode_metadata.
 *
 * The transcripts can be 20k+ words. Llama 3.3 70B context is 128K
 * tokens, so we send up to ~12K words (~16K tokens) — the first part
 * of the transcript carries the introductions, guest name, key claims;
 * the late-episode wrap-up rarely adds structured intel.
 *
 * Resumable: only processes documents where the metadata row is
 * 'pending' or doesn't exist yet. Use --force to re-extract.
 *
 * Usage:
 *   node scripts/extract-podcast-metadata.js               # all pending
 *   node scripts/extract-podcast-metadata.js --limit=5     # first 5
 *   node scripts/extract-podcast-metadata.js --force       # re-extract all
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
const envVars = {};
// Reads both quoted/escaped Vercel CLI format ("value\n") AND plain
// KEY=value lines. The trailing \n artifact appears when vercel env
// pull --environment=production runs against secrets stored with a
// final newline in the dashboard.
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const eq = line.indexOf('=');
  if (eq < 0) return;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n$/, '').replace(/\\n/g, '');
  envVars[k] = v;
});

const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Provider switch: 2026-05-28 (afternoon) — flipped from Groq 8b
// to OpenAI gpt-4o-mini after the Groq Free TPM ceiling stalled
// throughput to ~15-min waits between extractions. gpt-4o-mini is
// $0.15 per 1M input + $0.60 per 1M output tokens; at ~3.5K input +
// ~500 output per episode, this is ~$0.0008/episode, ~$0.10 total
// for the remaining ~103 extractions. Bypasses all rate-limit pain
// for a one-time spend that's a rounding error.
const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase();
const OPENAI_API_KEY = envVars.OPENAI_API_KEY;
const GROQ_API_KEY = envVars.GROQ_API_KEY;
if (PROVIDER === 'openai' && !OPENAI_API_KEY) { console.error('OPENAI_API_KEY missing from .env.local'); process.exit(1); }
if (PROVIDER === 'groq' && !GROQ_API_KEY) { console.error('GROQ_API_KEY missing from .env.local'); process.exit(1); }

const PROVIDER_CFG = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    apiKey: OPENAI_API_KEY,
    providerTag: 'openai_gpt4o_mini',
  },
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-8b-instant',
    apiKey: GROQ_API_KEY,
    providerTag: 'groq_llama_8b',
  },
}[PROVIDER];

const args = process.argv.slice(2);
const force = args.includes('--force');
const limitArg = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

// gpt-4o-mini has 128K context. We can send the FULL transcript with
// huge headroom. Bumped from Groq's 2.5K-word cap → 12K words (~ a
// 50-min episode's worth of speech), which captures the entire guest
// arc instead of just the intro.
const MAX_INPUT_WORDS = 12000;
const MAX_ATTEMPTS = 3;

// Pull a numeric episode number out of "049: Foo" or "Foo | Ep: 49"
function parseEpisodeNumber(title) {
  const m = title.match(/Ep:?\s*#?(\d+)/i) || title.match(/Episode\s*#?(\d+)/i) || title.match(/^\s*(\d{1,3})\s*[:.]/);
  return m ? parseInt(m[1], 10) : null;
}

const SYSTEM_PROMPT = `You analyze federal contracting podcast interview transcripts and extract structured intel. You MUST respond with valid JSON only — no preamble, no explanation, no markdown.

Output format (use null for unknown fields, empty array [] for empty lists):
{
  "guest_name": string | null,         // The guest's full name. NULL for solo episodes where Eric Coffey is the only speaker.
  "guest_company": string | null,      // Guest's company name
  "guest_role": string | null,         // Guest's role/title at that company
  "topics": string[],                  // 3-7 short topic tags (lowercase, hyphenated). E.g. ["teaming-agreements", "8a-certification", "construction"]
  "naics_mentioned": string[],         // 6-digit NAICS codes EXPLICITLY mentioned by speakers
  "agencies_mentioned": string[],      // Federal agencies named (e.g. "Army Corps of Engineers", "NAVFAC", "GSA", "VA"). De-dupe and normalize.
  "set_asides_mentioned": string[],    // Set-aside programs named (e.g. "8(a)", "WOSB", "HUBZone", "SDVOSB")
  "contract_size_mentioned": string | null,  // Largest specific contract value the guest mentions winning. E.g. "$4.2M", "$50K", "8-figure". NULL if no specific dollar figure.
  "key_lessons": string[],             // 3-5 concrete lessons/takeaways from the guest's experience. Each lesson should be one sentence, actionable, and specific. NOT generic platitudes.
  "summary_2sent": string              // 2-3 sentences (max 60 words) capturing the episode's core story or argument. Write it as a search-result snippet — would help a user decide if this episode is relevant.
}

Rules:
- Skip the intro/sponsor read at the top — those mention "Mindy" and "GovCon Giants" but are not episode content.
- If the guest is unnamed or it's a solo host episode, guest_name/company/role = null.
- NEVER use the host's name (Eric Coffie / Eric Coffey) in summary_2sent or key_lessons. The summary should be guest-focused or topic-focused, e.g. "This episode breaks down how..." or "The guest explains...", not "Eric discusses...". This is for exit-strategy brand reasons.
- NAICS extraction: scan for both digit form ("541512", "236220") and spelled-out form ("five forty-one five twelve" or "two thirty-six two twenty"). Normalize to 6 digits. ALSO recognize industry references that map to common NAICS even if the code isn't spoken — but only if the industry is named explicitly (construction = 236220, IT services = 541512, janitorial = 561720, security guards = 561612). Skip if there's any doubt.
- For agencies, prefer the official name. Skip vague references like "the government" or "federal agencies".
- Lessons must be ACTIONABLE and SPECIFIC to this episode, not generic federal contracting advice. If the episode has no actionable lessons, return [].
- summary_2sent should be a hook — what makes this episode worth listening to?
`;

async function extractFromTranscript(title, transcript) {
  // Trim the transcript intro (sponsor reads) + cap at MAX_INPUT_WORDS.
  // The Mindy/Eric intro is always at the top — skip the first ~150 words.
  const words = transcript.replace(/\s+/g, ' ').trim().split(' ');
  const trimmed = words.slice(150, MAX_INPUT_WORDS + 150).join(' ');

  const userMsg = `Episode title: ${title}\n\nTranscript (first ~${trimmed.split(' ').length} words):\n${trimmed}`;

  const res = await fetch(PROVIDER_CFG.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PROVIDER_CFG.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PROVIDER_CFG.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1500,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 429) {
      // Parse rate-limit hint
      const m = text.match(/try again in (\d+(?:\.\d+)?)([ms]?)/i);
      const wait = m ? Math.ceil(parseFloat(m[1]) * (m[2] === 'm' ? 60 : 1)) + 2 : 30;
      throw Object.assign(new Error(`429 — retry after ${wait}s`), { retryAfter: wait });
    }
    throw new Error(`${PROVIDER} ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = JSON.parse(text);
  const content = body?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

function normalizeArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x).trim()).filter(Boolean);
}

async function main() {
  console.log(`[extract] Mode: ${force ? 'FORCE re-extract' : 'pending only'}`);

  // Find candidate documents: podcast_interview docs with a transcript
  // (full_text contains "## Transcript") that don't already have
  // 'extracted' metadata.
  const { data: docs, error } = await supabase
    .from('mindy_rag_documents')
    .select('id, title, source_path, full_text, word_count')
    .eq('doc_type', 'podcast_interview')
    .like('full_text', '%## Transcript%')
    .order('word_count', { ascending: false })
    .limit(2000);

  if (error) { console.error('Fetch docs failed:', error.message); process.exit(1); }
  console.log(`[extract] Candidates with transcripts: ${docs?.length || 0}`);

  // Pull existing metadata rows
  const { data: existing } = await supabase
    .from('podcast_episode_metadata')
    .select('document_id, extraction_status, attempts');
  const existingByDoc = new Map();
  (existing || []).forEach(e => existingByDoc.set(e.document_id, e));

  const todo = [];
  for (const doc of docs || []) {
    const meta = existingByDoc.get(doc.id);
    if (!force && meta && meta.extraction_status === 'extracted') continue;
    if (meta && meta.attempts >= MAX_ATTEMPTS) continue;
    todo.push(doc);
    if (todo.length >= LIMIT) break;
  }
  console.log(`[extract] To process: ${todo.length}`);

  let done = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const doc = todo[i];
    console.log(`\n[${i + 1}/${todo.length}] ${doc.title.slice(0, 70)}`);

    // Strip the header before sending; keep just the transcript body
    const tMatch = doc.full_text.match(/## Transcript\s*([\s\S]+)$/);
    const transcript = tMatch ? tMatch[1].trim() : '';
    if (transcript.length < 1000) {
      console.log('  (skip — transcript too short)');
      continue;
    }

    let attempt = 0;
    let extracted = null;
    let lastErr = null;
    while (attempt < 3) {
      try {
        extracted = await extractFromTranscript(doc.title, transcript);
        break;
      } catch (e) {
        attempt++;
        if (e.retryAfter) {
          console.log(`  [rate-limit] sleeping ${e.retryAfter}s...`);
          await new Promise(r => setTimeout(r, e.retryAfter * 1000));
        } else {
          lastErr = e;
          break;
        }
      }
    }

    if (!extracted) {
      failed++;
      const errMsg = String(lastErr?.message || 'unknown').slice(0, 500);
      console.error(`  ✗ ${errMsg}`);
      await supabase.from('podcast_episode_metadata').upsert({
        document_id: doc.id,
        episode_title: doc.title,
        episode_url: doc.source_path?.replace(/^libsyn:/, 'https:'),
        episode_number: parseEpisodeNumber(doc.title),
        extraction_status: 'failed',
        extraction_error: errMsg,
        attempts: (existingByDoc.get(doc.id)?.attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'document_id' });
      continue;
    }

    const row = {
      document_id: doc.id,
      episode_number: parseEpisodeNumber(doc.title),
      episode_title: doc.title,
      episode_url: doc.source_path?.replace(/^libsyn:/, 'https:'),
      guest_name: extracted.guest_name || null,
      guest_company: extracted.guest_company || null,
      guest_role: extracted.guest_role || null,
      topics: normalizeArray(extracted.topics),
      naics_mentioned: normalizeArray(extracted.naics_mentioned),
      agencies_mentioned: normalizeArray(extracted.agencies_mentioned),
      set_asides_mentioned: normalizeArray(extracted.set_asides_mentioned),
      contract_size_mentioned: extracted.contract_size_mentioned || null,
      key_lessons: normalizeArray(extracted.key_lessons),
      summary_2sent: extracted.summary_2sent || null,
      extraction_status: 'extracted',
      extraction_error: null,
      extraction_model: PROVIDER_CFG.providerTag,
      extracted_at: new Date().toISOString(),
      attempts: (existingByDoc.get(doc.id)?.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase.from('podcast_episode_metadata').upsert(row, { onConflict: 'document_id' });
    if (upErr) {
      failed++;
      console.error(`  ✗ upsert failed: ${upErr.message}`);
      continue;
    }
    done++;
    console.log(`  ✓ guest=${extracted.guest_name || '(solo)'} | agencies=${row.agencies_mentioned.length} | naics=${row.naics_mentioned.length} | lessons=${row.key_lessons.length}`);
  }

  console.log('\n[extract] ✅ Run complete');
  console.log(`  Done:   ${done}`);
  console.log(`  Failed: ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
