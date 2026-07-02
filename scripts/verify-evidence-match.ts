/**
 * Prove the Phase 3 requirement→evidence matcher works against the REAL vault.
 *
 *   npx tsx --env-file=.env.local scripts/verify-evidence-match.ts [email]
 *
 * Feeds a handful of realistic federal requirements at the bidder's embedded vault
 * and prints the matched evidence (with the LLM "why"). A CORRECT result maps each
 * requirement to the on-topic contracts/capabilities and cleanly reports a gap for
 * a requirement the vault genuinely can't support.
 */
import { matchRequirementsToEvidence, type RequirementInput } from '../src/lib/proposal/evidence-match';

const EMAIL = process.argv[2] || 'eric@govcongiants.com';

const REQS: RequirementInput[] = [
  { id: 'REQ-001', requirement: 'Contractor shall perform asbestos abatement and hazardous material remediation in occupied facilities.', source_quote: 'removal and lawful disposal of asbestos-containing material' },
  { id: 'REQ-002', requirement: 'Offeror shall demonstrate experience rehabilitating historic buildings while preserving character-defining features.', source_quote: 'rehabilitation of a historic structure listed on the National Register' },
  { id: 'REQ-003', requirement: 'Provide FedRAMP-authorized cloud hosting with continuous ATO monitoring.', source_quote: 'FedRAMP Moderate authorization and continuous monitoring' },
  { id: 'REQ-004', requirement: 'Contractor shall manage general construction and renovation of federal office space.', source_quote: 'general contracting for interior renovation' },
];

(async () => {
  const started = Date.now();
  const results = await matchRequirementsToEvidence(EMAIL, REQS, { useRerank: true, topN: 4 });
  const ms = Date.now() - started;

  console.log(`\n=== Requirement → Evidence for ${EMAIL} (${ms}ms) ===\n`);
  let matched = 0;
  for (const r of results) {
    console.log(`${r.requirementId}  ${r.requirement}`);
    if (r.gap) {
      console.log('   ⚠️  GAP — no vault evidence cleared the floor (honest bracket).');
    } else {
      matched++;
      for (const e of r.evidence) {
        console.log(`   ✓ [${e.kind}] ${e.label}  (score ${e.score.toFixed(4)})`);
        if (e.why) console.log(`       why: ${e.why}`);
      }
    }
    console.log('');
  }

  const gaps = results.filter((r) => r.gap).length;
  console.log(`SUMMARY: ${matched}/${results.length} requirements matched, ${gaps} honest gap(s).`);
  // Sanity: at least one requirement should match, and the FedRAMP one SHOULD be a
  // gap for a construction/services vault (no cloud-hosting evidence).
  const fedramp = results.find((r) => r.requirementId === 'REQ-003');
  console.log(`CHECK: FedRAMP requirement is ${fedramp?.gap ? 'a GAP ✅ (expected for this vault)' : 'MATCHED ⚠️ (inspect — is the match real?)'}`);
})().catch((e) => { console.error(e); process.exit(1); });
