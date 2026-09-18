/**
 * Read-only: render Open Now + Coming Back HTML for the five ranking-replay users.
 * Proves the sections stay visually and semantically separate. Does not send email.
 *
 *   npx tsx --env-file=.env.local scripts/render-coming-back-alert-examples.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { OPEN_NOW_EXPLAIN, OPEN_NOW_HEADING } from '../src/lib/alerts/open-contract-d';
import {
  COMING_BACK_EXPLAIN,
  COMING_BACK_HEADING,
  loadComingBackSection,
  renderComingBackSection,
} from '../src/lib/alerts/coming-back-to-market';
import { knownNaicsForMatch } from '../src/lib/codes/validate-market-codes';
import { sanitizeKeywords } from '../src/lib/market/keyword-sanitize';

const USERS = [
  '7hillstransportation@gmail.com',
  'americanpatriot1872@pm.me',
  'civelladante@gmail.com',
  'diannewilsoncontact@gmail.com',
  'wednel.joseph@gmail.com',
];

function fail(msg: string): never {
  console.error('RENDER PROOF FAILED:', msg);
  process.exit(1);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('missing supabase env');
  const sb = createClient(url, key);
  const outDir = '/tmp/coming-back-alert-examples';
  mkdirSync(outDir, { recursive: true });

  const proofs: string[] = [];

  for (const email of USERS) {
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('user_email,naics_codes,psc_codes,keywords,business_type,business_description')
      .eq('user_email', email)
      .maybeSingle();
    if (error) fail(`${email}: ${error.message}`);
    if (!data) fail(`${email}: profile not found`);

    const naics = knownNaicsForMatch(data.naics_codes || []).slice(0, 12);
    const pscs = (data.psc_codes || []).filter(Boolean).slice(0, 12);
    const keywords = sanitizeKeywords(data.keywords || []);

    const comingBack = await loadComingBackSection({
      storedNaics: naics,
      storedPsc: pscs,
      keywords,
      businessType: data.business_type,
      businessDescription: data.business_description,
    });

    const naicsOr = naics
      .map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`))
      .join(',');
    let openRows: { notice_id: string | null; title: string | null }[] = [];
    if (naicsOr) {
      const { data: opps, error: openErr } = await sb
        .from('sam_opportunities')
        .select('notice_id,title')
        .eq('active', true)
        .or(naicsOr)
        .order('posted_date', { ascending: false })
        .limit(5);
      if (openErr) fail(`${email} open fetch: ${openErr.message}`);
      openRows = opps || [];
    }

    const openHtml = openRows.length
      ? `<p style="text-transform:uppercase;font-weight:700;letter-spacing:1.1px;font-size:11px;margin:32px 0 0 0;">${OPEN_NOW_HEADING}</p>
<p>${esc(OPEN_NOW_EXPLAIN)}</p>
<table>${openRows
          .map(
            (r) =>
              `<tr><td><a href="https://getmindy.ai/app?opp=${esc(r.notice_id || '')}">${esc((r.title || 'Untitled').slice(0, 90))}</a></td></tr>`,
          )
          .join('')}</table>`
      : `<p style="text-transform:uppercase;font-weight:700;letter-spacing:1.1px;font-size:11px;margin:32px 0 0 0;">${OPEN_NOW_HEADING}</p>
<p>Nothing new matched your filters today. Coming Back below is work returning to market later — not an open solicitation.</p>`;

    const comingHtml = renderComingBackSection(comingBack, {
      panelUrl: 'https://getmindy.ai/app?panel=recompetes',
    });

    if (!openHtml.includes(OPEN_NOW_HEADING)) fail(`${email}: Open Now heading missing`);
    if (comingBack.kind === 'show') {
      if (!comingHtml.includes(COMING_BACK_HEADING) && !comingHtml.includes('Based on your starter market')) {
        fail(`${email}: Coming Back heading missing`);
      }
      if (!comingHtml.includes(COMING_BACK_EXPLAIN)) fail(`${email}: Coming Back explain missing`);
      if (/currently soliciting/i.test(comingHtml)) fail(`${email}: Coming Back implies currently soliciting`);
      if (comingHtml.includes(OPEN_NOW_HEADING)) fail(`${email}: Open Now leaked into Coming Back`);
    }
    if (openHtml.includes(COMING_BACK_HEADING)) fail(`${email}: Coming Back leaked into Open Now`);

    const openIds = new Set(openRows.map((r) => r.notice_id).filter(Boolean));
    const recompeteIds =
      comingBack.kind === 'show' ? comingBack.rows.map((r) => r.contract_id) : [];
    for (const id of recompeteIds) {
      if (openIds.has(id)) fail(`${email}: mixed id ${id} in both sections`);
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(email)} daily alert sections</title></head>
<body style="font-family:system-ui;max-width:640px;margin:24px auto;color:#0f172a;">
<p><strong>${esc(email)}</strong></p>
<p>NAICS ${esc(naics.join(', ') || '(none)')} · keywords ${esc(keywords.slice(0, 6).join(', ') || '(none)')}</p>
${openHtml}
${comingHtml || '<p><em>Coming Back omitted (none qualify / no market).</em></p>'}
</body></html>`;
    const slug = email.replace(/[^a-z0-9]+/gi, '-');
    const path = `${outDir}/${slug}.html`;
    writeFileSync(path, html);
    const cbSummary =
      comingBack.kind === 'show'
        ? comingBack.rows.map((r) => `${r.incumbent} ${r.window} ${r.value}`).join(' | ')
        : `omit:${comingBack.reason}`;
    proofs.push(`${email} open=${openRows.length} comingBack=${comingBack.kind} ${cbSummary} → ${path}`);
    console.log(proofs[proofs.length - 1]);
  }

  console.log(`\nWrote ${USERS.length} HTML examples to ${outDir}`);
  console.log('PROOF: Open Now and Coming Back are separate headings; recompete copy is prepare-not-solicit; ids do not mix.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
