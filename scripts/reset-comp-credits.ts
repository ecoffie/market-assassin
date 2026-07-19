/**
 * One-time comp-credit reset (2026-07-18 three-tier model).
 * Comp/testimonial accounts get a ONE-TIME trial and then run out — NO monthly refill
 * (the grant cron excludes COMP_TESTIMONIAL_EMAILS). This sets each to its cap:
 *   Ryan (ryan@radiumgovcon.com) → 1,000 · everyone else comp/testimonial → 500.
 * SET (both directions): reduces anyone above cap (e.g. Kurt 911 → 500), tops up to the
 * trial cap otherwise. Ledger reason 'comp_reset'.
 *
 * DRY RUN by default — prints the plan. Re-run with --go to apply.
 *   npx tsx scripts/reset-comp-credits.ts          # preview
 *   npx tsx scripts/reset-comp-credits.ts --go      # apply
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

// Dynamic imports AFTER config — src/lib/supabase/server-clients reads env at module load,
// so it must not be imported until .env.local is populated (ESM hoists static imports).
const GO = process.argv.includes('--go');
const RYAN = 'ryan@radiumgovcon.com';
const RYAN_CAP = 1000;
const COMP_CAP = 500;

async function main() {
  const { getBalance, grantCredits, debitCredits } = await import('../src/lib/mcp/credits');
  const { COMP_TESTIMONIAL_EMAILS } = await import('../src/lib/mindy/campaign-exclusions');
  const emails = [...COMP_TESTIMONIAL_EMAILS].map((e) => e.toLowerCase().trim());
  console.log(`Comp reset — ${GO ? 'EXECUTE' : 'DRY RUN'} — ${emails.length} comp/testimonial accounts\n`);
  let changed = 0;
  for (const email of emails) {
    const cap = email === RYAN ? RYAN_CAP : COMP_CAP;
    const current = await getBalance(email);
    const delta = cap - current;
    const tag = delta === 0 ? 'ok' : delta > 0 ? `+${delta}` : `${delta}`;
    console.log(`  ${email.padEnd(38)} ${String(current).padStart(6)} → ${String(cap).padStart(5)}   ${tag}`);
    if (delta === 0) continue;
    changed++;
    if (!GO) continue;
    if (delta > 0) {
      await grantCredits(email, delta, 'comp_reset');
    } else {
      const r = await debitCredits(email, -delta, { reason: 'comp_reset', toolName: 'comp_reset' });
      if (!r.ok) console.error(`    ⚠️ debit failed (insufficient balance) for ${email}`);
    }
  }
  console.log(`\n${changed} account(s) ${GO ? 'adjusted' : 'would change'}.`);
  if (!GO) console.log('Dry run — re-run with --go to apply.');
}

main().catch((e) => { console.error(e); process.exit(1); });
