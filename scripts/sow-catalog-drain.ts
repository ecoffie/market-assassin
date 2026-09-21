/**
 * Local SOW catalog drainer (#66) — bypasses the Vercel cron route (which was
 * throttle-bound by cold-starts) and runs the SAME proven scanAttachmentsForSow
 * logic straight against Supabase + SAM's file store, with controlled concurrency.
 *
 * Drains ACTIVE first (biddable now), then INACTIVE (the recompete corpus).
 * Resumable — stamps sow_checked_at, so re-running picks up where it left off and
 * the 5-min dispatcher cron stays the permanent steady-state handler.
 *
 * Run:  npx tsx scripts/sow-catalog-drain.ts            (active only, default)
 *       npx tsx scripts/sow-catalog-drain.ts --inactive (recompete corpus too)
 *       CONCURRENCY=12 npx tsx scripts/sow-catalog-drain.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { attachmentUrls, scanAttachmentsForSow } from '../src/lib/sam/sow-detect';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
// DEDICATED drain keys, not the shared rotation. This drainer runs at CONCURRENCY=10
// and issues one authenticated SAM fetch per attachment — pointing it at SAM_API_KEY
// drained the same quota daily-alerts and sync-sam-opportunities depend on.
// Set SOW_DRAIN_KEY (and SOW_DRAIN_KEY_1..10); falls back to SAM_API_KEY when unset.
const DRAIN_KEYS = [
  process.env.SOW_DRAIN_KEY,
  ...Array.from({ length: 10 }, (_, i) => process.env[`SOW_DRAIN_KEY_${i + 1}`]),
].map(k => (k || '').trim()).filter(Boolean);
if (!DRAIN_KEYS.length && process.env.SAM_API_KEY) {
  console.warn('[sow-drain] No SOW_DRAIN_KEY set — falling back to the SHARED SAM_API_KEY. This competes with alerts/sync.');
  DRAIN_KEYS.push(process.env.SAM_API_KEY.trim());
}
// Round-robin so a multi-key pool spreads load instead of exhausting key 1 first.
let keyIdx = 0;
const nextKey = () => DRAIN_KEYS.length ? DRAIN_KEYS[keyIdx++ % DRAIN_KEYS.length] : '';
const API_KEY = DRAIN_KEYS[0] || '';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const PAGE = 200;                       // rows to claim per DB fetch
const includeInactive = process.argv.includes('--inactive');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = { id: any; title: string; attachments: unknown };

async function processOne(row: Row): Promise<{ sow: boolean; text: boolean }> {
  const checkedAt = new Date().toISOString();
  const urls = attachmentUrls(row.attachments);
  if (!urls.length) {
    await sb.from('sam_opportunities').update({ has_sow_doc: false, sow_checked_at: checkedAt }).eq('id', row.id);
    return { sow: false, text: false };
  }
  try {
    // Race against a hard timeout — a few records have a hanging/huge attachment
    // download that stalls a pool worker forever, so the loop re-fetches the same
    // un-stamped rows endlessly ("stuck on the last 13"). 30s cap → stamp + move on.
    const scan = await Promise.race([
      scanAttachmentsForSow(urls, nextKey() || API_KEY),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('scan-timeout')), 30_000)),
    ]);
    await sb.from('sam_opportunities').update({
      has_sow_doc: scan.hasSowDoc, sow_doc_type: scan.docType,
      sow_filename: scan.filename, sow_text: scan.text, sow_checked_at: checkedAt,
    }).eq('id', row.id);
    return { sow: scan.hasSowDoc, text: !!scan.text };
  } catch {
    // Stamp checked even on timeout/failure so a poison record never blocks the queue.
    await sb.from('sam_opportunities').update({ has_sow_doc: false, sow_checked_at: checkedAt }).eq('id', row.id);
    return { sow: false, text: false };
  }
}

// Simple promise-pool: keep CONCURRENCY workers busy off a shared queue.
async function pool(rows: Row[]): Promise<{ sow: number; text: number }> {
  let i = 0, sow = 0, text = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++];
      const r = await processOne(row);
      if (r.sow) sow++;
      if (r.text) text++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { sow, text };
}

async function drainPhase(active: boolean, label: string) {
  let totalChecked = 0, totalSow = 0;
  const start = Date.now();
  for (;;) {
    let q = sb.from('sam_opportunities')
      .select('id, title, attachments')
      .eq('active', active)
      .not('attachments', 'is', null)
      .is('sow_checked_at', null)
      .limit(PAGE);
    q = active ? q.order('id', { ascending: true }) : q.order('archive_date', { ascending: false });
    const { data: rows, error } = await q;
    if (error) { console.error(`[${label}] fetch error:`, error.message); break; }
    if (!rows || rows.length === 0) { console.log(`[${label}] ✅ drained — ${totalChecked} checked, ${totalSow} SOWs`); break; }

    const { sow } = await pool(rows as Row[]);
    totalChecked += rows.length; totalSow += sow;
    const rate = Math.round(totalChecked / ((Date.now() - start) / 60000));
    console.log(`[${label}] +${rows.length} (+${sow} sow) | total ${totalChecked} checked, ${totalSow} SOWs | ~${rate}/min`);
  }
  return { totalChecked, totalSow };
}

(async () => {
  if (!API_KEY) { console.error('SAM_API_KEY not set'); process.exit(1); }
  console.log(`[drain] starting — concurrency=${CONCURRENCY}, inactive=${includeInactive}`);
  await drainPhase(true, 'ACTIVE');
  if (includeInactive) await drainPhase(false, 'RECOMPETE');
  console.log('[drain] done.');
  process.exit(0);
})();
