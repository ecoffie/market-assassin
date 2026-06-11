/**
 * Local SOW embedding drainer — mirrors sow-catalog-drain.ts.
 * Embeds has_sow_doc + sow_text rows into sow_embedding (OpenAI text-embedding-3-small).
 *
 * Run:  npx tsx scripts/sow-embed-drain.ts
 *       CONCURRENCY=10 npx tsx scripts/sow-embed-drain.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { embedText } from '../src/lib/market/embeddings';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const PAGE = 200;

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
    // Stamp embedded_at without vector so poison rows don't block forever.
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

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set');
    process.exit(1);
  }

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

    if (error) {
      console.error('[embed] fetch error:', error.message);
      process.exit(1);
    }
    if (!rows?.length) {
      console.log(`[embed] ✅ done — ${embedded}/${total} embedded successfully`);
      break;
    }

    const ok = await pool(rows as Row[]);
    total += rows.length;
    embedded += ok;
    const rate = Math.round(total / ((Date.now() - start) / 60000));
    console.log(`[embed] +${rows.length} (${ok} ok) | total ${total} | ~${rate}/min`);
  }

  process.exit(0);
})();
