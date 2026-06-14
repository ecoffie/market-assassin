#!/usr/bin/env npx tsx
/**
 * One-time / resumable CTA tag backfill for all cached SAM opportunities.
 * Usage (from market-assassin/):
 *   npx tsx scripts/backfill-cta-tags.ts
 *   npx tsx scripts/backfill-cta-tags.ts --limit=1000 --concurrency=5
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { createClient } from '@supabase/supabase-js';
import { tagCtaBatch } from '../src/lib/cta/tagger';

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const batchSize = limitArg ? parseInt(limitArg.split('=')[1] || '500', 10) : 500;
const activeOnly = !args.includes('--all');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let totalProcessed = 0;
  let totalTags = 0;
  let remaining: number | null = null;

  do {
    const result = await tagCtaBatch(supabase, { limit: batchSize, activeOnly });
    totalProcessed += result.processed;
    totalTags += result.tagsWritten;
    remaining = result.remaining;
    console.log(
      `Batch: processed=${result.processed} tags=${result.tagsWritten} remaining=${remaining ?? 0}`,
    );
    if (result.processed === 0) break;
  } while (remaining && remaining > 0);

  console.log(`Done. processed=${totalProcessed} tagsWritten=${totalTags}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
