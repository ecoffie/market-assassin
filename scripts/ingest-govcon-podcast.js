#!/usr/bin/env node

/**
 * Ingest the GovCon Giants Podcast back-catalog into Mindy's RAG library.
 *
 * Source: https://feeds.libsyn.com/govcongiants — 743 episodes (of 763
 * total, the remainder being scheduled drafts), 8 years of small-biz
 * federal contracting interviews.
 *
 * Why: the existing RAG corpus is Eric's teaching material (frameworks,
 * slide decks). The podcast adds primary-source field intel — real
 * small-business owners describing real wins, with specific NAICS,
 * agencies, and dollar amounts. Different complementary signal.
 *
 * What this ingest captures TODAY (metadata-first):
 *   - Title (e.g. "8 Brutal Truths About Government Subcontracting…")
 *   - Episode number
 *   - Pub date
 *   - Full show notes / description (rich — Eric pre-summarizes lessons)
 *   - Permalink for citation
 *   - .srt transcript text inline IF the feed provides one (71 of 743)
 *
 * What's DEFERRED:
 *   - Whisper transcription for the other ~672 episodes (Phase 2)
 *   - Guest-name + NAICS extraction (Phase 2, AI pass)
 *
 * Schema fit:
 *   - One mindy_rag_documents row per episode, doc_type='podcast_interview'
 *   - Chunked into mindy_rag_chunks via the same ~500-word strategy
 *   - source_path = libsyn permalink (unique key)
 *
 * Idempotent: re-running deletes the prior copy of each episode + its
 * chunks first via source_path match.
 *
 * Usage:
 *   node scripts/ingest-govcon-podcast.js                    # ingest all
 *   node scripts/ingest-govcon-podcast.js --limit=10         # first 10 only
 *   node scripts/ingest-govcon-podcast.js --skip-transcripts # metadata only
 *   node scripts/ingest-govcon-podcast.js --dry-run          # preview, no DB writes
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

const RSS_URL = 'https://feeds.libsyn.com/govcongiants';
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const skipTranscripts = args.includes('--skip-transcripts');
const limitArg = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = limitArg ? parseInt(limitArg, 10) : Infinity;

// ---- HTML helpers ---------------------------------------------------

function stripHtml(s) {
  if (!s) return '';
  return s
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Naive but resilient XML item parser: scoop tag values without depending
// on a full XML lib (avoid the lib churn for a one-shot script).
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  return v;
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function parseItems(rssXml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(rssXml))) {
    items.push(m[1]);
  }
  return items;
}

function parseEpisodeNumber(title) {
  const m = title.match(/Ep:?\s*#?(\d+)/i) || title.match(/Episode\s*#?(\d+)/i) || title.match(/\|\s*(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

// ---- transcript fetcher --------------------------------------------

function parseSrt(srtText) {
  // SRT format: blocks separated by blank lines; first line is index,
  // second is timestamps, remainder is the spoken text. We only want
  // the spoken text, deduped (auto-transcribers sometimes repeat).
  const blocks = srtText.split(/\r?\n\r?\n/);
  const lines = [];
  let prev = '';
  for (const block of blocks) {
    const blockLines = block.split(/\r?\n/);
    // Skip the index + timestamp lines
    const spoken = blockLines.slice(2).join(' ').trim();
    if (!spoken || spoken === prev) continue;
    lines.push(spoken);
    prev = spoken;
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

async function fetchTranscript(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return parseSrt(text);
  } catch (e) {
    console.error(`  transcript fetch failed: ${e.message}`);
    return null;
  }
}

// ---- chunking (mirrors scripts/chunk-mindy-rag.js) -----------------
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

// ---- narrative assembly --------------------------------------------

function buildNarrative({ title, episodeNumber, pubDate, link, description, transcriptText }) {
  let out = '';
  out += `# ${title}\n\n`;
  if (episodeNumber) out += `**Episode ${episodeNumber}**`;
  if (pubDate) out += `${episodeNumber ? ' · ' : ''}Published ${pubDate}`;
  out += '\n\n';
  out += `Source: GovCon Giants Podcast — federal contracting interviews with small business owners, agency insiders, and industry leaders.\n\n`;
  if (link) out += `Episode permalink: ${link}\n\n`;

  if (description) {
    out += `## Show Notes\n\n${description}\n\n`;
  }

  if (transcriptText) {
    out += `## Transcript\n\n${transcriptText}\n`;
  }

  return out.trim();
}

// ---- main -----------------------------------------------------------

async function main() {
  console.log(`[govcon-podcast] Fetching RSS: ${RSS_URL}`);
  const res = await fetch(RSS_URL);
  if (!res.ok) {
    console.error(`  RSS fetch failed: ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  const items = parseItems(xml);
  console.log(`[govcon-podcast] Found ${items.length} items in feed`);

  let inserted = 0;
  let chunksTotal = 0;
  let transcriptsPulled = 0;
  let skipped = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let idx = 0; idx < items.length && idx < LIMIT; idx++) {
    const itemXml = items[idx];
    const titleRaw = extractTag(itemXml, 'title') || '(untitled)';
    const title = stripHtml(titleRaw);
    const link = extractTag(itemXml, 'link') || '';
    const pubDate = extractTag(itemXml, 'pubDate') || '';
    const guid = extractTag(itemXml, 'guid') || '';
    const descRaw = extractTag(itemXml, 'description') || extractTag(itemXml, 'itunes:summary') || '';
    const description = stripHtml(descRaw);
    const transcriptUrl = extractAttr(itemXml, 'podcast:transcript', 'url');
    const episodeNumber = parseEpisodeNumber(title);

    if (!link) {
      console.log(`  [${idx + 1}/${items.length}] (skip — no link) ${title.slice(0, 60)}`);
      skipped++;
      continue;
    }

    // source_path = libsyn permalink as a stable unique key
    const sourcePath = link.replace(/^https?:\/\//, 'libsyn:');

    let transcriptText = null;
    if (transcriptUrl && !skipTranscripts) {
      transcriptText = await fetchTranscript(transcriptUrl);
      if (transcriptText) transcriptsPulled++;
    }

    const narrative = buildNarrative({
      title,
      episodeNumber,
      pubDate,
      link,
      description,
      transcriptText,
    });

    if (narrative.length < 200) {
      console.log(`  [${idx + 1}/${items.length}] (skip — narrative too short) ${title.slice(0, 60)}`);
      skipped++;
      continue;
    }

    const wordCount = narrative.split(/\s+/).filter(Boolean).length;
    const sha = crypto.createHash('sha256').update(narrative).digest('hex');

    const oneLine = description
      ? description.slice(0, 200).replace(/\s+/g, ' ').trim() + (description.length > 200 ? '…' : '')
      : `Episode ${episodeNumber || '?'} of the GovCon Giants Podcast.`;

    if (isDryRun) {
      console.log(`  [${idx + 1}/${items.length}] DRY: "${title.slice(0, 70)}" (${wordCount} words${transcriptText ? ' + transcript' : ''})`);
      continue;
    }

    try {
      // Idempotent: drop prior copy + chunks
      const { data: existing } = await supabase
        .from('mindy_rag_documents')
        .select('id')
        .eq('source_path', sourcePath)
        .maybeSingle();

      if (existing?.id) {
        await supabase.from('mindy_rag_chunks').delete().eq('document_id', existing.id);
        await supabase.from('mindy_rag_documents').delete().eq('id', existing.id);
      }

      const { data: doc, error: docErr } = await supabase
        .from('mindy_rag_documents')
        .insert({
          source_path: sourcePath,
          filename: `${title.replace(/[^\w\s.-]/g, '').slice(0, 100)}.txt`,
          file_extension: 'rss',
          size_bytes: Buffer.byteLength(narrative, 'utf8'),
          file_mtime: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          file_sha256: sha,
          doc_type: 'podcast_interview',
          top_level_folder: 'govcon-giants-podcast',
          folder_path: 'govcon-giants-podcast',
          title,
          full_text: narrative,
          text_length: narrative.length,
          word_count: wordCount,
          topic_tags: ['podcast', 'small-business-stories', 'federal-contracting'],
          related_naics: [],
          one_line_summary: oneLine,
          has_pii: false,
          usage_rights: 'eric_owned',
          ingestion_status: 'extracted',
          ingested_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (docErr || !doc) {
        console.error(`  [${idx + 1}/${items.length}] doc insert failed: ${docErr?.message}`);
        failed++;
        continue;
      }

      const chunks = chunkText(narrative);
      const rows = chunks.map((text, ci) => ({
        document_id: doc.id,
        chunk_index: ci,
        chunk_text: text,
        doc_type: 'podcast_interview',
        doc_title: title,
        doc_top_level_folder: 'govcon-giants-podcast',
        source_path: sourcePath,
        word_count: text.split(/\s+/).filter(Boolean).length,
        char_count: text.length,
      }));

      if (rows.length) {
        const { error: chunkErr } = await supabase.from('mindy_rag_chunks').insert(rows);
        if (chunkErr) {
          console.error(`  [${idx + 1}/${items.length}] chunk insert failed: ${chunkErr.message}`);
          failed++;
          continue;
        }
      }

      chunksTotal += rows.length;
      inserted++;

      const tag = transcriptText ? ' [TRANSCRIPT]' : '';
      const ep = episodeNumber ? `Ep ${episodeNumber}` : 'Ep ?';
      console.log(`  [${idx + 1}/${items.length}] ✓ ${ep}: "${title.slice(0, 60)}" (${rows.length} chunks)${tag}`);
    } catch (e) {
      console.error(`  [${idx + 1}/${items.length}] error: ${e.message}`);
      failed++;
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n[govcon-podcast] ✅ Complete');
  console.log(`  Inserted:  ${inserted} episodes`);
  console.log(`  Chunks:    ${chunksTotal}`);
  console.log(`  Transcripts pulled: ${transcriptsPulled}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Elapsed:   ${elapsed}s`);
  console.log('');
  console.log('  Try: /api/admin/rag-library?op=search&q=8a+certification+small+business&password=$ADMIN_PASSWORD');
}

main().catch(e => { console.error(e); process.exit(1); });
