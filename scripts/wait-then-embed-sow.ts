/**
 * Poll until sow_embedding column exists, then run sow-embed-drain logic inline.
 * Use when migration was just pasted in Supabase SQL editor.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { embedText } from '../src/lib/market/embeddings';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const PAGE = 200;
const POLL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60_000;

async function columnsReady(): Promise<boolean> {
  const { error } = await sb.from('sam_opportunities').select('sow_embedding,sow_embedded_at').limit(1);
  return !error;
}

type Row = { id: string; sow_text: string };

async function processOne(row: Row): Promise<boolean> {
  const embeddedAt = new Date().toISOString();
  try {
    const vec = await Promise.race([
      embedText(row.sow_text),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('embed-timeout')), 30_000)),
    ]);
    const { error } = await sb
      .from('sam_opportunities')
      .update({ sow_embedding: vec, sow_embedded_at: embeddedAt })
      .eq('id', row.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error(`[embed] failed id=${row.id}:`, (e as Error).message);
    await sb.from('sam_opportunities').update({ sow_embedded_at: embeddedAt }).eq('id', row.id);
    return false;
  }
}

async function pool(rows: Row[]): Promise<number> {
  let i = 0;
  let ok = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++];
      if (await processOne(row)) ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return ok;
}

async function drain() {
  let total = 0;
  let embedded = 0;
  const start = Date.now();
  for (;;) {
    const { data: rows, error } = await sb
      .from('sam_opportunities')
      .select('id, sow_text')
      .eq('has_sow_doc', true)
      .not('sow_text', 'is', null)
      .is('sow_embedded_at', null)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    if (!rows?.length) {
      console.log(`[embed] ✅ done — ${embedded}/${total} embedded successfully`);
      return;
    }
    const ok = await pool(rows as Row[]);
    total += rows.length;
    embedded += ok;
    const rate = Math.round(total / Math.max(1, (Date.now() - start) / 60000));
    console.log(`[embed] +${rows.length} (${ok} ok) | total ${total} | ~${rate}/min`);
  }
}

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set');
    process.exit(1);
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  console.log('[wait] polling for sow_embedding column (paste migration in Supabase if needed)…');
  while (!(await columnsReady())) {
    if (Date.now() > deadline) {
      console.error('[wait] timed out — run supabase/migrations/20260611_sow_embeddings.sql first');
      process.exit(1);
    }
    console.log('[wait] column not ready, retry in 10s…');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.log('[wait] ✅ columns exist — starting embed drain');
  await drain();
  process.exit(0);
})();
