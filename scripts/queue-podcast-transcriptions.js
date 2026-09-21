#!/usr/bin/env node

/**
 * Queue podcast episodes for Groq Whisper transcription.
 *
 * Reads the Libsyn RSS feed, filters to episodes that are:
 *   - >= 15 minutes (skip FHC short-form daily content)
 *   - NOT already transcribed (no <podcast:transcript> in feed)
 *
 * Inserts one podcast_transcription_jobs row per qualifying episode.
 * Idempotent — re-running merges new episodes without disturbing
 * existing jobs.
 *
 * Run before scripts/transcribe-govcon-podcast.js.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const RSS_URL = 'https://feeds.libsyn.com/govcongiants';
const MIN_SECONDS = 15 * 60; // skip <15 min

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
function parseDuration(d) {
  const p = (d || '0:00').split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] || 0;
}

async function main() {
  console.log(`[queue] Fetching RSS: ${RSS_URL}`);
  const res = await fetch(RSS_URL);
  const xml = await res.text();
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  console.log(`[queue] Feed items: ${items.length}`);

  let candidates = 0, skippedShort = 0, skippedTranscribed = 0, inserted = 0, updated = 0;
  for (const item of items) {
    const title = extractTag(item, 'title') || '';
    const link = extractTag(item, 'link') || '';
    const audioUrl = extractAttr(item, 'enclosure', 'url');
    const audioBytes = parseInt(extractAttr(item, 'enclosure', 'length') || '0', 10);
    const durationStr = extractTag(item, 'itunes:duration');
    const seconds = parseDuration(durationStr);
    const hasTranscript = /<podcast:transcript/i.test(item);

    if (!audioUrl || !link) continue;
    if (seconds < MIN_SECONDS) { skippedShort++; continue; }
    if (hasTranscript) { skippedTranscribed++; continue; }

    candidates++;
    const sourcePath = link.replace(/^https?:\/\//, 'libsyn:');

    const { data: existing } = await supabase
      .from('podcast_transcription_jobs')
      .select('id, status')
      .eq('source_path', sourcePath)
      .maybeSingle();

    if (existing?.id) {
      if (existing.status === 'completed') continue;
      // refresh metadata in case the audio URL changed
      await supabase.from('podcast_transcription_jobs').update({
        episode_title: title.replace(/^<!\[CDATA\[|\]\]>$/g, ''),
        episode_url: link,
        audio_url: audioUrl,
        audio_bytes: audioBytes,
        duration_seconds: seconds,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      updated++;
      continue;
    }

    const { error } = await supabase.from('podcast_transcription_jobs').insert({
      source_path: sourcePath,
      episode_title: title.replace(/^<!\[CDATA\[|\]\]>$/g, ''),
      episode_url: link,
      audio_url: audioUrl,
      duration_seconds: seconds,
      audio_bytes: audioBytes,
      status: 'pending',
    });
    if (error) console.error(`  insert failed (${title.slice(0, 60)}): ${error.message}`);
    else inserted++;
  }

  console.log('\n[queue] ✅ Done');
  console.log(`  Candidates (>=15min, no transcript): ${candidates}`);
  console.log(`  Skipped — too short: ${skippedShort}`);
  console.log(`  Skipped — already transcribed: ${skippedTranscribed}`);
  console.log(`  Inserted (new pending jobs): ${inserted}`);
  console.log(`  Updated (refreshed metadata): ${updated}`);
}

main().catch(e => { console.error(e); process.exit(1); });
