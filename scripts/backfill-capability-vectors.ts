/**
 * Backfill per-user capability VECTORS for base-wide semantic hidden-match alerts.
 *
 * One-time drain (bulk-job rule: local tsx runner + concurrency pool, NOT an HTTP
 * cron loop — 10k rows throttle a Vercel route). Resumable: only touches rows where
 * capability_embedded_at IS NULL, so re-running picks up where it left off. The
 * embed-user-capabilities cron handles steady state; this catches the existing base.
 *
 * Writes land on user_notification_settings (the ~10k-row base-wide home). Each row:
 *   - 'embedded'  → had a real (non-seed) NAICS/keyword/Vault/UEI signal → vector stored
 *   - 'skipped'   → thin/placeholder/seed-sweep only → vector nulled, stamped (won't retry)
 *   - 'unchanged' → meaning hash matched an existing vector → just stamped
 *
 * DRY-RUN FIRST (bulk-action rule): shows counts + a sample, writes nothing.
 *   npx tsx --env-file=.env.local scripts/backfill-capability-vectors.ts --dry
 * Then execute:
 *   npx tsx --env-file=.env.local scripts/backfill-capability-vectors.ts
 * One user:
 *   npx tsx --env-file=.env.local scripts/backfill-capability-vectors.ts eric@govcongiants.com
 * Cap the run:
 *   npx tsx --env-file=.env.local scripts/backfill-capability-vectors.ts --limit=500
 */
import { createClient } from '@supabase/supabase-js';
import { buildCapabilityProfile, embedAndStoreCapabilityVector } from '../src/lib/alerts/capability-vector';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY_EMAIL = args.find((a) => a.includes('@')) || null;
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const CONCURRENCY = 6;

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

  // Resumable: only active rows still needing a vector.
  let q = sb.from('user_notification_settings')
    .select('user_email')
    .is('capability_embedded_at', null)
    .eq('is_active', true);
  if (ONLY_EMAIL) q = sb.from('user_notification_settings').select('user_email').eq('user_email', ONLY_EMAIL);
  if (LIMIT > 0) q = q.limit(LIMIT);

  const { data, error } = await q;
  if (error) {
    console.error(`query failed: ${error.message}`);
    console.error('→ has the 20260706_capability_vector_notification_settings migration been run?');
    process.exit(1);
  }
  const emails = (data || []).map((r: { user_email: string }) => r.user_email).filter(Boolean);
  console.log(`Pending rows to process: ${emails.length}${ONLY_EMAIL ? ` (single user ${ONLY_EMAIL})` : ''}${LIMIT ? ` (capped at ${LIMIT})` : ''}`);

  if (DRY) {
    // Dry-run: build profiles WITHOUT embedding, so we can see how many would become
    // eligible (the real question — does the base-wide fallback actually light users up?).
    const sample = emails.slice(0, 20);
    let eligible = 0, skipped = 0;
    const shown: string[] = [];
    await pool(sample, CONCURRENCY, async (email) => {
      const p = await buildCapabilityProfile(email);
      if (p.eligible) { eligible++; if (shown.length < 5) shown.push(`  ✓ ${email}: "${p.blob.slice(0, 90)}…"`); }
      else skipped++;
    });
    console.log(`\nDRY RUN over first ${sample.length} of ${emails.length}:`);
    console.log(`  would embed:  ${eligible}`);
    console.log(`  would skip:   ${skipped} (thin/placeholder/seed-sweep)`);
    if (shown.length) { console.log('\n  sample eligible profiles:'); shown.forEach((s) => console.log(s)); }
    console.log(`\nNo writes made. Re-run without --dry to execute.`);
    return;
  }

  const stats = { embedded: 0, skipped: 0, unchanged: 0, failed: 0 };
  await pool(emails, CONCURRENCY, async (email, i) => {
    try {
      const r = await embedAndStoreCapabilityVector(email);
      stats[r]++;
    } catch (err) {
      stats.failed++;
      console.warn(`  failed ${email}: ${err instanceof Error ? err.message : err}`);
    }
    if ((i + 1) % 200 === 0) console.log(`  …${i + 1}/${emails.length} (embedded ${stats.embedded}, skipped ${stats.skipped})`);
  });

  console.log(`\nDONE: embedded ${stats.embedded}, skipped ${stats.skipped}, unchanged ${stats.unchanged}, failed ${stats.failed} (of ${emails.length}).`);
})();
