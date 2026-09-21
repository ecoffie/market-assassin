#!/usr/bin/env node
/**
 * Export an offline HTML quality report for podcast key_lessons.
 *
 *   node scripts/export-podcast-highlights-review.js
 *   node scripts/export-podcast-highlights-review.js 541512 > /tmp/review.html && open /tmp/review.html
 *
 * Output: tasks/podcast-highlights-qa-YYYY-MM-DD.html (or stdout if second arg is -)
 */

const fs = require('fs');
const path = require('path');
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

// Inline quality heuristics (keep in sync with podcast-highlight-quality.ts)
const WEAK = [
  /\b(build|nurture|maintain)\s+(strong\s+)?relationships?\b/i,
  /\balways consult\b/i,
  /\bnetworking\b/i,
  /\bstay top of mind\b/i,
  /\beric\s+coff/i,
];
const GOOD = [
  /\b\d+\s*(day|week|month|year)s?\b/i,
  /\$\d/i,
  /\b(8\(a\)|hubzone|wosb|sdvosb|gsa|naics|rfp|rfq|sources sought)\b/i,
  /\b(subcontract|prime|teaming|capability statement)\b/i,
];

function assess(lesson, hasGuest) {
  const t = (lesson || '').trim();
  const reasons = [];
  if (!t) return { tier: 'reject', reasons: ['empty'] };
  if (t.length < 24) reasons.push('too short');
  for (const re of WEAK) if (re.test(t)) reasons.push('weak pattern');
  const good = GOOD.some((re) => re.test(t));
  if (!hasGuest) reasons.push('no guest');
  let tier = 'good';
  if (t.length < 24 || reasons.some((r) => r.includes('empty') || r.includes('host'))) tier = 'reject';
  else if (reasons.length >= 1 && !good) tier = 'weak';
  else if (reasons.length >= 2) tier = 'weak';
  return { tier, reasons, good };
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const naicsFilter = (process.argv[2] || '').replace(/\D/g, '').slice(0, 6);
  const outArg = process.argv[3];
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let q = sb
    .from('podcast_episode_metadata')
    .select('*')
    .eq('extraction_status', 'extracted')
    .not('guest_name', 'is', null)
    .order('episode_number', { ascending: false })
    .limit(80);

  if (naicsFilter.length === 6) q = q.overlaps('naics_mentioned', [naicsFilter]);

  const { data: rows, error } = await q;
  if (error) throw error;

  const tiers = { good: 0, weak: 0, reject: 0 };
  let totalLessons = 0;
  const cards = [];

  for (const row of rows || []) {
    const lessons = (row.key_lessons || []).map((text) => {
      const q = assess(text, !!row.guest_name);
      tiers[q.tier]++;
      totalLessons++;
      return { text, ...q };
    });
    cards.push({ row, lessons });
  }

  const goodPct = totalLessons ? Math.round((tiers.good / totalLessons) * 100) : 0;
  const title = naicsFilter ? `NAICS ${naicsFilter}` : 'Random sample';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Podcast Highlights QA — ${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { color: #fff; }
  .stat { display: inline-block; margin-right: 12px; padding: 8px 12px; border-radius: 8px; background: #1e293b; }
  .good { color: #6ee7b7; } .weak { color: #fcd34d; } .reject { color: #fca5a5; }
  article { border: 1px solid #334155; border-radius: 12px; padding: 16px; margin: 16px 0; background: #1e293b; }
  .preview { background: linear-gradient(135deg,#1e293b,#581c87); padding: 12px; border-radius: 8px; margin: 12px 0; font-style: italic; }
  li { margin: 8px 0; }
  .tag { font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-right: 6px; }
  .tag.good { background: #064e3b; color: #6ee7b7; }
  .tag.weak { background: #78350f; color: #fcd34d; }
  .tag.reject { background: #7f1d1d; color: #fca5a5; }
</style></head><body>
<h1>Podcast Highlight Notes — Quality Review</h1>
<p>${esc(title)} · ${rows.length} episodes · ${goodPct}% lessons rated <span class="good">good</span></p>
<p>
  <span class="stat good">Good: ${tiers.good}</span>
  <span class="stat weak">Weak: ${tiers.weak}</span>
  <span class="stat reject">Reject: ${tiers.reject}</span>
</p>
<p><small>Live reviewer: <a href="http://localhost:3000/admin/podcast-highlights" style="color:#a78bfa">/admin/podcast-highlights</a></small></p>
${cards.map(({ row, lessons }) => {
  const best = lessons.find((l) => l.tier === 'good') || lessons[0];
  return `<article>
  <h2>Ep ${row.episode_number ?? '?'} — ${esc(row.guest_name)}${row.guest_company ? ` (${esc(row.guest_company)})` : ''}</h2>
  <p style="color:#94a3b8;font-size:14px">${esc(row.summary_2sent || '')}</p>
  <p style="font-size:12px;color:#64748b">NAICS: ${(row.naics_mentioned || []).join(', ') || '—'}</p>
  ${best ? `<div class="preview"><strong>Mindy card:</strong> &ldquo;${esc(best.text.slice(0, 180))}${best.text.length > 180 ? '…' : ''}&rdquo;</div>` : ''}
  <ul>${lessons.map((l) => `<li><span class="tag ${l.tier}">${l.tier}</span>${esc(l.text)}${l.reasons.length ? `<br><small style="color:#64748b">${esc(l.reasons.join(' · '))}</small>` : ''}</li>`).join('')}</ul>
</article>`;
}).join('')}
</body></html>`;

  if (outArg === '-') {
    process.stdout.write(html);
    return;
  }

  const outDir = path.join(__dirname, '..', 'tasks');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const suffix = naicsFilter || 'sample';
  const outFile = path.join(outDir, `podcast-highlights-qa-${suffix}-${new Date().toISOString().slice(0, 10)}.html`);
  fs.writeFileSync(outFile, html);
  console.log(`Wrote ${outFile}`);
  console.log(`Good: ${tiers.good} / ${totalLessons} (${goodPct}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
