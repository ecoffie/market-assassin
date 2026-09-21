/**
 * clean-generic-keywords.ts — strip auto-seeded NAICS-title filler from saved
 * profiles, re-deriving real keywords where stripping would empty the list.
 *
 * WHY: deriveKeywordsFromNaics used to seed generic NAICS-title words (computer,
 * systems, design, management, …) that match hundreds of active opps and carry no
 * capability signal. 90% of keyworded profiles (609) carried >=1; 531 were ENTIRELY
 * such filler. The derivation is now fixed forward (runs through isDistinctiveKeyword),
 * but existing saved profiles still hold the noise. This cleans them.
 *
 * PER-PROFILE LOGIC (safe — never leaves a user worse off):
 *   cleaned = distinctive(current keywords)
 *   if cleaned non-empty → save cleaned (drops only the wildcards)
 *   if cleaned EMPTY     → re-derive from the user's naics_codes (real words), which
 *                          is what a fresh onboarding would now produce. If that's
 *                          ALSO empty (no usable NAICS), leave keywords UNTOUCHED
 *                          (NAICS matching still works; don't blank them out).
 *
 * DRY BY DEFAULT. Pass --go to write. Excludes staff/advocate/test.
 *   npx tsx scripts/clean-generic-keywords.ts            # dry-run (default)
 *   npx tsx scripts/clean-generic-keywords.ts --go       # execute
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { isDistinctiveKeyword } from '../src/lib/market/keyword-sanitize';
import { isExcludedFromMetrics } from '../src/lib/mindy/campaign-exclusions';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const GO = process.argv.includes('--go');

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

(async () => {
  const { data, error } = await sb
    .from('user_notification_settings')
    .select('user_email,keywords,naics_codes')
    .not('keywords', 'is', null)
    .limit(5000);
  if (error) throw error;

  let scanned = 0;
  let strippedOnly = 0; // had generics, distinctive survivors kept
  let leftUntouched = 0; // would-be-empty → skip (NAICS matching still covers them)
  let noChange = 0; // already clean
  let wrote = 0;
  const samples: string[] = [];

  for (const p of data || []) {
    const email = (p.user_email || '').toLowerCase();
    if (!email || isExcludedFromMetrics(email)) continue;
    const current = ((p.keywords || []) as string[]).map((k) => String(k || '').trim()).filter(Boolean);
    if (current.length === 0) continue;
    scanned++;

    const cleaned = current.filter((k) => isDistinctiveKeyword(k));
    let next: string[];
    let mode: string;

    if (cleaned.length === current.length) {
      noChange++;
      continue; // nothing generic to strip
    }

    if (cleaned.length > 0) {
      next = cleaned;
      mode = 'strip';
      strippedOnly++;
    } else {
      // Stripping would empty it. We do NOT re-derive from NAICS here: the dry-run
      // proved re-derive is UNSAFE — an IT consultant (541xxx, no exact title)
      // fell through the prefix fallback to "pharmaceutical, iron, steel, cutlery"
      // (wrong industry entirely). A wrong keyword is worse than a generic one.
      // Leave these UNTOUCHED — NAICS matching still covers them, and the fixed
      // derivation only helps NEW onboardings. (These users are better served by
      // the zero-alert-nudge re-onboarding flow than a blind re-derive.)
      leftUntouched++;
      continue;
    }

    if (arraysEqual(current, next)) {
      noChange++;
      continue;
    }

    if (samples.length < 8) {
      samples.push(
        `  [${mode}] ${email.slice(0, 30)}\n     before: ${current.join(', ')}\n     after : ${next.join(', ')}`,
      );
    }

    if (GO) {
      const { error: upErr } = await sb
        .from('user_notification_settings')
        .update({ keywords: next })
        .eq('user_email', p.user_email);
      if (upErr) console.error(`  update failed ${email}: ${upErr.message}`);
      else wrote++;
    }
  }

  console.log(`\n=== clean-generic-keywords (${GO ? 'EXECUTE' : 'DRY-RUN'}) ===`);
  console.log('samples:');
  console.log(samples.join('\n'));
  console.log('\n=== scope ===');
  console.log(`  scanned (has keywords, non-excluded): ${scanned}`);
  console.log(`  strip-only (kept distinctive survivors): ${strippedOnly}`);
  console.log(`  left untouched (would empty → keep as-is): ${leftUntouched}`);
  console.log(`  already clean / no net change:           ${noChange}`);
  console.log(`  TOTAL to change: ${strippedOnly}`);
  if (GO) console.log(`  ROWS WRITTEN: ${wrote}`);
  else console.log('\n  (dry-run — re-run with --go to write)');
})().catch((e) => {
  console.error('failed:', e);
  process.exit(1);
});
