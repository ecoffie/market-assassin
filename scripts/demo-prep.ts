/**
 * demo-prep.ts — pre-stage and VERIFY a Mindy Day live demo account.
 *
 * The live "watch Mindy find federal contracts for this company" moment runs on the
 * hidden-match engine (capability-vector → SOW-embedding cosine match). Measured
 * reality (2026-06-19): only ~9 users have a capability vector and ~5K active opps
 * are embedded — so a COLD demo on a random volunteer finds nothing ~99% of the time.
 *
 * This script de-risks it. Given an email, it:
 *   1. Builds (or refreshes) that account's capability vector via the SAME production
 *      function the cron uses (embedAndStoreCapabilityVector) — no simulation.
 *   2. Runs the REAL matcher (fetchHiddenMatchPool + findHiddenMatches) and prints
 *      exactly what Mindy would surface on stage, with scores.
 *   3. Gives a GREEN / YELLOW / RED verdict so you know before you walk on stage.
 *
 * Usage:
 *   npx tsx scripts/demo-prep.ts <email>                 # build vector + verify
 *   npx tsx scripts/demo-prep.ts <email> --verify-only   # skip rebuild, just check
 *   npx tsx scripts/demo-prep.ts <email> --threshold 0.30 --max 8
 *
 * Read-only on the corpus; only writes the ONE account's capability vector (the same
 * write the nightly cron does). Safe to run repeatedly.
 */
import { config } from 'dotenv'; config({ path: '.env.local' });
import {
  embedAndStoreCapabilityVector,
  getCapabilityVector,
  buildCapabilityProfile,
} from '../src/lib/alerts/capability-vector';
import { fetchHiddenMatchPool, findHiddenMatches } from '../src/lib/alerts/hidden-match';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = process.argv[2]?.toLowerCase().trim();
  if (!email || email.startsWith('--')) {
    console.error('Usage: npx tsx scripts/demo-prep.ts <email> [--verify-only] [--threshold 0.30] [--max 8]');
    process.exit(1);
  }
  const verifyOnly = process.argv.includes('--verify-only');
  const threshold = arg('--threshold') ? parseFloat(arg('--threshold')!) : undefined;
  const max = arg('--max') ? parseInt(arg('--max')!, 10) : 8;

  console.log(`\n=== Mindy Day demo prep — ${email} ===\n`);

  // --- 1. Capability profile eligibility (what the vector is built from) ---
  const profile = await buildCapabilityProfile(email);
  console.log('CAPABILITY PROFILE');
  console.log(`  eligible:    ${profile.eligible ? '✅ yes' : '🔴 NO (thin/placeholder — vector will be empty)'}`);
  console.log(`  source text: ${profile.blob ? `${profile.blob.length} chars` : '(none)'}`);
  if (profile.blob) console.log(`  preview:     "${profile.blob.slice(0, 120).replace(/\s+/g, ' ')}…"`);

  if (!profile.eligible) {
    console.log('\n🔴 RED: this account has no real capability text (one-liner / pitch / capabilities / past-perf).');
    console.log('   Fix before staging: have them fill the Vault (one-liner + 2-3 capabilities) OR autofill from UEI.');
    process.exit(2);
  }

  // --- 2. Build / refresh the vector (same write the cron does) ---
  if (!verifyOnly) {
    const result = await embedAndStoreCapabilityVector(email);
    console.log(`\n  vector build: ${result === 'embedded' ? '✅ embedded (fresh)' : result === 'unchanged' ? '✅ unchanged (already current)' : '🔴 skipped'}`);
  }
  const vec = await getCapabilityVector(email);
  if (!vec || !vec.length) {
    console.log('\n🔴 RED: no capability vector stored. Run without --verify-only to build it.');
    process.exit(2);
  }
  console.log(`  vector:      ✅ ${vec.length}-d present`);

  // --- 3. Run the REAL matcher against the live pool ---
  console.log('\nMATCH POOL (live hidden-match engine)');
  const pool = await fetchHiddenMatchPool();
  console.log(`  embedded active opps in window: ${pool.length}`);
  if (!pool.length) {
    console.log('\n🔴 RED: match pool is empty (no embedded active opps in the recency window). Demo cannot surface anything.');
    process.exit(2);
  }

  // No exclusions for the demo — we WANT to see what Mindy would surface.
  const matches = findHiddenMatches(vec, new Set(), pool, { threshold, max });
  console.log(`\nWHAT MINDY WOULD SHOW ON STAGE (top ${max}, threshold ${threshold ?? 'default'})`);
  if (!matches.length) {
    console.log('  (nothing cleared the similarity floor)');
    console.log('\n🟡 YELLOW: vector is built but NO opp clears the match threshold for this company.');
    console.log('   Options: (a) pick a different demo company, (b) lower --threshold to preview weaker matches,');
    console.log('   (c) enrich their capability text so the vector sharpens. Do NOT demo cold — it will find nothing.');
    process.exit(3);
  }
  matches.forEach((m, i) => {
    console.log(`  ${i + 1}. [${m.score.toFixed(3)}] ${m.title.slice(0, 70)}`);
    console.log(`     ${m.agency} · NAICS ${m.naics} · deadline ${m.deadline?.slice(0, 10) || 'n/a'}`);
    console.log(`     ${m.url}`);
  });

  const strong = matches.filter(m => m.score >= 0.40).length;
  console.log('\n' + '='.repeat(60));
  if (strong >= 2) {
    console.log(`🟢 GREEN: ${matches.length} matches, ${strong} strong (≥0.40). This account is demo-ready.`);
  } else {
    console.log(`🟡 YELLOW: ${matches.length} matches but only ${strong} strong (≥0.40). Demo-able but pick the top result carefully, and have the Vimeo fallback ready.`);
  }
  console.log('='.repeat(60) + '\n');
}

main().catch((e) => { console.error('demo-prep failed:', e); process.exit(1); });
