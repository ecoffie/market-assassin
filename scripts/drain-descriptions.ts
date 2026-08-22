/**
 * One-time drain: fill sam_opportunities.description from SAM's noticedesc endpoint.
 *
 * WHY A LOCAL RUNNER AND NOT THE CRON (rule #7: >1000 rows -> local tsx runner):
 * two description crons run 144x/day and report "success" while 17,748 ACTIVE rows still
 * have no description. They are not stalled on logic — they draw from the SHARED key pool,
 * and measured 2026-08-22 that pool is crippled:
 *
 *     SAM_API_KEY        401      SAM_API_KEY_1       429
 *     SAM_API_KEY_2      200      SAM_API_KEY_BACKUP  429
 *
 * ...while all NINE distinct SOW_DRAIN_KEY_* return 200 on the same URL. So the work is
 * possible, just not with the keys the cron uses.
 *
 * Eric has these drain keys for a limited window ("we won't have them forever but if we can
 * take advantage of them now why not do it for something useful"), so this spends that
 * expiring quota on the biggest gap SAM can actually close.
 *
 * WHY DESCRIPTIONS AND NOT sow_text: SOW extraction needs attachment downloads (several
 * calls + PDF parsing per record) — 155K rows is far beyond what these keys will cover
 * before they lapse. A description is ONE call per record.
 *
 *   npx tsx scripts/drain-descriptions.ts                  # dry run, active only
 *   npx tsx scripts/drain-descriptions.ts --go             # write
 *   npx tsx scripts/drain-descriptions.ts --go --inactive --limit=5000
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { createClient } from '@supabase/supabase-js';
import { fetchNoticeDescription, isDescriptionLink } from '../src/lib/sam/notice-description';

const GO = process.argv.includes('--go');
const INACTIVE = process.argv.includes('--inactive');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const CONCURRENCY = 9; // one in flight per distinct drain key

/** NUL bytes — Postgres rejects them in text columns (repo rule #7). */
const NUL = new RegExp(String.fromCharCode(0), 'g');

/** The NINE distinct working drain keys. Deliberately NOT the shared pool. */
function drainKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`SOW_DRAIN_KEY_${i}`];
    if (k && k.trim()) keys.push(k.trim());
  }
  return [...new Set(keys)]; // slots 1 and 2 hold the SAME key; 10 is a dead 401
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const keys = drainKeys();
  if (!keys.length) {
    console.error('No SOW_DRAIN_KEY_* set — refusing to fall back to the shared pool.');
    process.exit(1);
  }

  // Verify the keys BEFORE touching 17k rows: a dead key silently wastes the whole run.
  const live: string[] = [];
  for (const k of keys) {
    const r = await fetch(`https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=probe&api_key=${k}`);
    if (r.status !== 401 && r.status !== 429) live.push(k);
  }
  console.log(`Drain keys: ${keys.length} distinct, ${live.length} usable (~${live.length * 1000}/day quota)`);
  if (!live.length) {
    console.error('Every drain key is 401/429. Stopping.');
    process.exit(1);
  }

  // PAGINATE. PostgREST hard-caps a response at 1,000 rows no matter what .limit() says —
  // the documented trap in this repo (it once silently left ~540 alert subscribers
  // unprocessed). A plain .limit(50000) here returned exactly 1000 and would have drained
  // 1,000 of 17,748 while reporting success.
  const want = LIMIT || Number.MAX_SAFE_INTEGER;
  const PAGE = 1000;
  const all: { notice_id: string; raw_data?: { description?: unknown } }[] = [];
  for (let from = 0; all.length < want; from += PAGE) {
    let q = sb
      .from('sam_opportunities')
      .select('notice_id, raw_data')
      .or('description.is.null,description.eq.')
      .order('posted_date', { ascending: false }) // freshest first — what users actually see
      .range(from, from + PAGE - 1);
    q = INACTIVE ? q.eq('active', false) : q.eq('active', true);
    const { data, error } = await q;
    if (error) {
      console.error('Query failed:', error.message);
      process.exit(1);
    }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break; // last page
  }

  const scanned = all.slice(0, want);
  const rows = scanned.filter((r) => isDescriptionLink(r?.raw_data?.description));
  console.log(`${scanned.length} rows missing a description; ${rows.length} carry a resolvable link.`);

  if (!GO) {
    console.log('\nDRY RUN — nothing written. Re-run with --go.');
    console.log(`Would resolve ${rows.length} notices using ${live.length} keys at concurrency ${CONCURRENCY}.`);
    return;
  }

  let ok = 0;
  let empty = 0;
  let failed = 0;
  let notFound = 0;
  let done = 0;
  const started = Date.now();
  let cursor = 0;

  async function worker(slot: number) {
    while (cursor < rows.length) {
      const row = rows[cursor++] as { notice_id: string; raw_data: { description: string } };
      const key = live[slot % live.length];
      try {
        const text = await fetchNoticeDescription(row.raw_data.description, key);
        const clean = (text || '').replace(NUL, '').trim();
        if (clean) {
          const { error: upErr } = await sb
            .from('sam_opportunities')
            .update({ description: clean, description_checked_at: new Date().toISOString() })
            .eq('notice_id', row.notice_id);
          if (upErr) {
            failed++;
            console.error(`  write failed ${row.notice_id}: ${upErr.message}`);
          } else ok++;
        } else {
          // Stamp it so a later run does not retry a notice SAM genuinely has no text for.
          await sb
            .from('sam_opportunities')
            .update({ description_checked_at: new Date().toISOString() })
            .eq('notice_id', row.notice_id);
          empty++;
        }
      } catch (e) {
        const msg = String((e as Error)?.message || '');
        // "noticedesc 404" = SAM genuinely HAS NO description for this notice
        // ({"errorMessage":"Description Not Found"}) — measured mid-run, it is ~26% of the
        // remaining corpus. That is an honest MISS, not a failure: stamp it so every future
        // run does not re-fetch a notice SAM will never have text for. Without this the
        // drainer burns the same quota on the same dead rows forever.
        if (/\b404\b/.test(msg)) {
          notFound++;
          await sb
            .from('sam_opportunities')
            .update({ description_checked_at: new Date().toISOString() })
            .eq('notice_id', row.notice_id);
        } else {
          failed++;
          if (failed <= 5) console.error(`  fetch failed ${row.notice_id}: ${msg.slice(0, 80)}`);
        }
      }
      if (++done % 250 === 0) {
        const rate = done / ((Date.now() - started) / 60000);
        console.log(`  ${done}/${rows.length}  ok=${ok} no-text=${notFound} empty=${empty} failed=${failed}  ${rate.toFixed(0)}/min`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  const mins = (Date.now() - started) / 60000;
  console.log(`\nDone in ${mins.toFixed(1)} min — written ${ok}, SAM has no text ${notFound}, empty ${empty}, failed ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
