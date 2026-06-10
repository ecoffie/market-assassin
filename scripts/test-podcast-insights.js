#!/usr/bin/env node
/**
 * Smoke-test podcast_episode_metadata coverage for Mindy Insight guest quotes.
 *
 * Run: node scripts/test-podcast-insights.js [NAICS]
 * Example: node scripts/test-podcast-insights.js 541512
 */

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
  if (!line || line.startsWith('#')) return;
  const eq = line.indexOf('=');
  if (eq < 0) return;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n$/, '').replace(/\\n/g, '');
  process.env[k] = v;
});

const naics = (process.argv[2] || '541512').replace(/\D/g, '').slice(0, 6);

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { count: extracted } = await sb
    .from('podcast_episode_metadata')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_status', 'extracted')
    .not('guest_name', 'is', null);

  const { data: matches } = await sb
    .from('podcast_episode_metadata')
    .select('episode_number, guest_name, guest_company, key_lessons, naics_mentioned')
    .overlaps('naics_mentioned', [naics])
    .eq('extraction_status', 'extracted')
    .not('guest_name', 'is', null)
    .limit(5);

  console.log(`Extracted guest episodes (total): ${extracted ?? '?'}`);
  console.log(`NAICS ${naics} matches: ${(matches || []).length}`);
  for (const row of matches || []) {
    const lesson = (row.key_lessons || [])[0];
    console.log(`\nEp ${row.episode_number} — ${row.guest_name} (${row.guest_company || 'n/a'})`);
    console.log(`  Lesson: ${lesson || '(none)'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
