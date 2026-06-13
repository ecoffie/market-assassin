/**
 * Proposal-eval STEP 0: auto-pick a spread of real notices from the cache.
 *
 * Writes scripts/proposal-eval/cases.json — a balanced set across notice types
 * (Sources Sought / RFI / Combined / Solicitation) and NAICS, picking ONLY
 * notices that have real body text (>= MIN_BODY chars), so every case can
 * actually be drafted against. If a row's description is still a noticedesc
 * LINK (backfill hasn't reached it), we resolve it live via SAM — same path the
 * app uses — and keep it only if real text comes back.
 *
 * Run:  npx tsx scripts/proposal-eval/pick-cases.ts
 *       N=20 npx tsx scripts/proposal-eval/pick-cases.ts
 *
 * (Memory: proposal_offline_eval_harness)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { isDescriptionLink, fetchNoticeDescription } from '../../src/lib/sam/notice-description';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SAM_API_KEY = process.env.SAM_API_KEY || '';
const TARGET = parseInt(process.env.N || '18', 10);
const MIN_BODY = 400;

// Match the test set to the bidder's REAL capabilities (GOVCON GIANTS = 541611
// consulting/training). Tuning against domains the vault can't do (knee
// instruments, fuel storage) penalizes the model for a bad test fit, not the
// prompt. Set NAICS_MATCH=0 to go back to a blind spread.
const VAULT_NAICS = (process.env.VAULT_NAICS || '541611,541612,541613,541618,541690,611430,813410,813910').split(',');
const NAICS_MATCH = process.env.NAICS_MATCH !== '0';

// How a notice type maps to the section set Proposal Assist would draft.
// LOI/response set for market-research notices; full RFP set for solicitations.
function sectionSetFor(noticeType: string | null): 'loi' | 'rfp' {
  const t = (noticeType || '').toLowerCase();
  if (t.includes('sources sought') || t.includes('information') || t.includes('special')) return 'loi';
  return 'rfp';
}

// Resolve the best available body text for a row (sow_text > description text >
// live SAM fetch of a description link). Mirrors pursuit-docs notice-body logic.
async function resolveBody(row: {
  notice_id: string;
  title?: string | null;
  description?: string | null;
  sow_text?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw_data?: any;
}): Promise<string> {
  const sow = (row.sow_text || '').trim();
  let desc = (row.description || '').trim();
  const rawDesc = (row.raw_data?.description || '').trim();
  const link =
    (desc && isDescriptionLink(desc) && desc) ||
    (rawDesc && isDescriptionLink(rawDesc) && rawDesc) ||
    '';
  if (desc && isDescriptionLink(desc)) desc = '';
  if (!desc && rawDesc && !isDescriptionLink(rawDesc)) desc = rawDesc;
  if (!desc && link && SAM_API_KEY) {
    desc = (await fetchNoticeDescription(link, SAM_API_KEY).catch(() => '')) || '';
  }
  if (!sow && !desc && SAM_API_KEY) {
    desc = (await fetchNoticeDescription(row.notice_id, SAM_API_KEY).catch(() => '')) || '';
  }
  return [row.title, sow, desc].filter(Boolean).join('\n\n').trim();
}

async function main() {
  // Pull a wide sample, then filter to rows with real (non-link) body text and
  // balance across notice types.
  const wantedTypes = [
    'Sources Sought',
    'Combined Synopsis/Solicitation',
    'Solicitation',
    'Special Notice',
    'Presolicitation',
  ];
  const perType = Math.ceil(TARGET / 3); // over-fetch; we filter hard below

  const cases: Array<{
    notice_id: string;
    label: string;
    notice_type: string;
    naics: string | null;
    sectionSet: 'loi' | 'rfp';
    bodyChars: number;
  }> = [];
  const seenNaics = new Set<string>();

  for (const nt of wantedTypes) {
    if (cases.length >= TARGET) break;
    let q = sb
      .from('sam_opportunities')
      .select('notice_id, notice_type, naics_code, title, description, sow_text, raw_data')
      .eq('notice_type', nt)
      .not('description', 'is', null);
    if (NAICS_MATCH) q = q.in('naics_code', VAULT_NAICS);
    const { data, error } = await q.limit(150);
    if (error) {
      console.warn(`[pick] ${nt}: ${error.message}`);
      continue;
    }
    let addedForType = 0;
    for (const row of data || []) {
      if (cases.length >= TARGET || addedForType >= perType) break;
      if (!row.notice_id || !row.title) continue;
      // Prefer NAICS diversity — but only in blind-spread mode. In NAICS_MATCH
      // mode we WANT multiple notices per the vault's codes (few codes match).
      const naics = row.naics_code || null;
      if (!NAICS_MATCH && naics && seenNaics.has(naics) && cases.length < TARGET - 3) continue;

      const body = await resolveBody(row);
      if (body.length < MIN_BODY) continue;

      cases.push({
        notice_id: row.notice_id,
        label: (row.title as string).slice(0, 70),
        notice_type: nt,
        naics,
        sectionSet: sectionSetFor(nt),
        bodyChars: body.length,
      });
      if (naics) seenNaics.add(naics);
      addedForType++;
    }
    console.log(`[pick] ${nt}: added ${addedForType}`);
  }

  const outPath = join(__dirname, 'cases.json');
  writeFileSync(outPath, JSON.stringify({ vaultEmail: 'eric@govcongiants.com', cases }, null, 2));
  console.log(`\nWrote ${cases.length} cases → ${outPath}`);
  console.log('Breakdown:', cases.reduce((acc: Record<string, number>, c) => {
    acc[c.sectionSet] = (acc[c.sectionSet] || 0) + 1;
    return acc;
  }, {}));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
