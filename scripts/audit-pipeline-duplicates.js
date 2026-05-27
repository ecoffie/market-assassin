#!/usr/bin/env node
/**
 * Audit user_pipeline for duplicate entries within the same user_email.
 * Duplicates = same title (after normalization) OR same notice_id.
 *
 * The Shadehill case Eric flagged: two rows in 'bidding' stage for the
 * same project. Likely caused by:
 *  - Adding via email "Track This" link AND from briefing AND from pursuit
 *    detail — different code paths, different dedup behavior
 *  - One row had a junk notice_id (e.g. 'deadline-XXX'), the other had
 *    the real one — dedup checks notice_id but both routes
 *    "save anyway" when notice_id is null
 *
 * Reports counts per user_email. Use with `--email=<x>` to drill in.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(line => {
  if (!line || line.startsWith('#')) return;
  const [k, ...r] = line.split('='); if (!k || !r.length) return;
  let v = r.join('=').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k.trim()] = v;
});
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const argEmail = (process.argv.find(a => a.startsWith('--email=')) || '').split('=')[1];

function normalizeTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

(async () => {
  let query = supa.from('user_pipeline')
    .select('id, user_email, title, notice_id, stage, source, created_at, is_archived')
    .eq('is_archived', false)
    .order('created_at', { ascending: true });
  if (argEmail) query = query.eq('user_email', argEmail.toLowerCase());

  const { data, error } = await query.limit(5000);
  if (error) { console.error(error); return; }

  // Group by user_email -> normalized title
  const byUser = new Map();
  for (const row of data || []) {
    if (!byUser.has(row.user_email)) byUser.set(row.user_email, new Map());
    const titleMap = byUser.get(row.user_email);
    const key = normalizeTitle(row.title);
    if (!titleMap.has(key)) titleMap.set(key, []);
    titleMap.get(key).push(row);
  }

  let totalDuplicateGroups = 0;
  let totalDuplicateRows = 0;
  for (const [email, titleMap] of byUser) {
    const dupGroups = [...titleMap.entries()].filter(([, rows]) => rows.length > 1);
    if (dupGroups.length === 0) continue;
    console.log(`\n${email} — ${dupGroups.length} duplicate group${dupGroups.length === 1 ? '' : 's'}:`);
    for (const [key, rows] of dupGroups) {
      totalDuplicateGroups++;
      totalDuplicateRows += rows.length - 1;
      console.log(`  '${rows[0].title.slice(0, 60)}' — ${rows.length} rows`);
      for (const r of rows) {
        console.log(`    id=${r.id.slice(0,8)} stage=${r.stage} notice=${(r.notice_id || 'null').slice(0,12)} source=${r.source} created=${r.created_at.slice(0,10)}`);
      }
    }
  }
  console.log(`\n========================`);
  console.log(`Total duplicate groups: ${totalDuplicateGroups}`);
  console.log(`Total redundant rows:  ${totalDuplicateRows} (these can be archived)`);
})();
