#!/usr/bin/env node
/**
 * Audit user_pipeline.value_estimate to find junk strings.
 * Identifies rows where value_estimate is NOT a dollar amount but
 * instead countdown text / Mindy notes / etc.
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

// A "clean" value_estimate looks like:
//   "$2,500,000", "$2.5M", "$500K - $1M", "TBD", null
// A "polluted" one looks like:
//   "Due in 6 days", "Open market research window...",
//   "Mindy: this looks like a recompete"

function isClean(v) {
  if (!v) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (s.toUpperCase() === 'TBD') return true;
  // Has $ + digits, OR pure numeric ranges (e.g. "1M - 5M"), OR percent
  if (/[\$\d]/.test(s) && /[\d]/.test(s) && s.length <= 60) {
    // Should be primarily numbers/$/K/M/B/comma/dash/space/parens/period
    const nonValueChars = s.replace(/[\$\d,.\sKMB\-+()<>~/]/gi, '');
    return nonValueChars.length <= 3;  // tolerate a few stray chars
  }
  return false;
}

(async () => {
  const { data, error } = await supa
    .from('user_pipeline')
    .select('id, user_email, title, value_estimate, source, created_at')
    .not('value_estimate', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { console.error(error); return; }

  let cleanCount = 0;
  const polluted = [];
  const bySource = {};

  for (const row of data) {
    if (isClean(row.value_estimate)) {
      cleanCount++;
    } else {
      polluted.push(row);
      const src = row.source || '(null source)';
      bySource[src] = (bySource[src] || 0) + 1;
    }
  }

  console.log(`Total rows examined:  ${data.length}`);
  console.log(`Clean (looks like $): ${cleanCount}`);
  console.log(`Polluted:             ${polluted.length}\n`);

  console.log('Polluted by source:');
  Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([src, c]) => {
    console.log(`  ${src.padEnd(40)} ${c}`);
  });

  console.log('\nSample of polluted values:');
  polluted.slice(0, 20).forEach((r, i) => {
    const v = String(r.value_estimate || '').slice(0, 80);
    console.log(`  ${i + 1}. [${r.source || '?'}] "${v}" ← ${r.title?.slice(0, 50)}`);
  });

  // Pattern detection
  console.log('\nPattern signatures:');
  const patterns = {
    'starts "Due in"':           polluted.filter(r => /^due in/i.test(r.value_estimate)).length,
    'contains "days"':           polluted.filter(r => /days/i.test(r.value_estimate)).length,
    'starts "Mindy"':            polluted.filter(r => /^mindy/i.test(r.value_estimate)).length,
    'starts "Open"':             polluted.filter(r => /^open /i.test(r.value_estimate)).length,
    'contains "recompete"':      polluted.filter(r => /recompete/i.test(r.value_estimate)).length,
    'contains "deadline"':       polluted.filter(r => /deadline/i.test(r.value_estimate)).length,
    'contains "window"':         polluted.filter(r => /window/i.test(r.value_estimate)).length,
    'looks like ISO date':       polluted.filter(r => /^\d{4}-\d{2}-\d{2}/.test(r.value_estimate)).length,
    'just whitespace':           polluted.filter(r => /^\s+$/.test(r.value_estimate)).length,
    'starts with a word':        polluted.filter(r => /^[A-Za-z]/.test(r.value_estimate)).length,
  };
  Object.entries(patterns).forEach(([p, n]) => {
    if (n > 0) console.log(`  ${p.padEnd(25)} ${n}`);
  });
})();
