/**
 * Verify Proposal Assist grounds in a user's REAL Vault corpus.
 * Loads the exact context the proposal pipeline uses and prints what would be
 * injected into the prompt, per section. Proves the model sees YOUR data.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-proposal-grounding.ts <email>
 */
import { loadVaultContext, formatVaultForPrompt, loadBidderProfile, formatProfileForPrompt, filterRealRows } from '../src/lib/proposal/loaders';

const email = process.argv[2] || 'eric@govcongiants.com';
// Sections that pull evidence from the Vault.
const SECTIONS = ['past_performance', 'differentiators', 'company_overview', 'capabilities', 'exec_summary'] as const;

(async () => {
  console.log(`\n=== Proposal Assist grounding check for: ${email} ===\n`);

  const profile = await loadBidderProfile(email);
  console.log('--- Bidder profile (from user_notification_settings) ---');
  console.log(formatProfileForPrompt(profile));
  console.log('');

  for (const section of SECTIONS) {
    const ctx = await loadVaultContext(email, section as any);
    const realPP = filterRealRows(ctx.past_performance);
    const realCaps = filterRealRows(ctx.capabilities);
    console.log(`\n========== SECTION: ${section} ==========`);
    console.log(`has_any=${ctx.has_any} | pastPerf loaded=${ctx.past_performance?.length ?? 0} (real=${realPP.length}) | caps loaded=${ctx.capabilities?.length ?? 0} (real=${realCaps.length}) | identity=${ctx.identity ? 'yes' : 'no'}`);
    const promptBlock = formatVaultForPrompt(ctx);
    if (!promptBlock) { console.log('  ⚠️  NO VAULT CONTEXT INJECTED — model would write generically.'); continue; }
    // Show a trimmed preview of what the model actually receives.
    console.log('  --- injected into prompt (preview) ---');
    console.log(promptBlock.split('\n').slice(0, 14).map(l => '  ' + l).join('\n'));
    if (promptBlock.split('\n').length > 14) console.log('  … (truncated)');
  }

  console.log('\n=== VERDICT ===');
  const ppCtx = await loadVaultContext(email, 'past_performance' as any);
  const realPP = filterRealRows(ppCtx.past_performance);
  if (realPP.length > 0) {
    console.log(`✅ Proposal Assist IS grounding in your corpus: ${realPP.length} real past-performance contracts will be cited (e.g. "${(realPP[0] as any).contract_title}" — $${Number((realPP[0] as any).contract_value||0).toLocaleString()}).`);
  } else {
    console.log('❌ No real past-performance rows survive the stub filter — proposals would be generic. Add/enrich Vault rows.');
  }
})();
