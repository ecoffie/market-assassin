/**
 * Phase 4 end-to-end: prove the evidence weave lands in the drafting prompt.
 *
 *   ENABLE_EVIDENCE_WEAVE=true npx tsx --env-file=.env.local scripts/verify-evidence-weave.ts [email]
 *
 * Builds a real v2 past-performance prompt for a construction/abatement notice with
 * a small compliance matrix, then checks the userPrompt contains the
 * "Requirement → your real evidence" block citing the bidder's actual contracts.
 */
process.env.ENABLE_EVIDENCE_WEAVE = process.env.ENABLE_EVIDENCE_WEAVE || 'true';

import { buildV2Prompt } from '../src/lib/proposal/v2';
import type { ComplianceReq } from '../src/lib/proposal/section-alignment';

const EMAIL = process.argv[2] || 'eric@govcongiants.com';

const SOURCE = `SOURCES SOUGHT — Renovation and hazardous material abatement, federal building.
The Contractor shall perform asbestos abatement and hazardous material remediation in occupied
facilities. The Contractor shall manage general construction and renovation of federal office space,
including historic structures where character-defining features must be preserved.`;

const REQUIREMENTS: ComplianceReq[] = [
  { id: 'REQ-001', requirement: 'Contractor shall perform asbestos abatement and hazardous material remediation in occupied facilities.', category: 'past_performance', section: 'C.1' },
  { id: 'REQ-002', requirement: 'Offeror shall demonstrate experience rehabilitating historic buildings while preserving character-defining features.', category: 'past_performance', section: 'C.2' },
  { id: 'REQ-003', requirement: 'Provide FedRAMP-authorized cloud hosting with continuous ATO monitoring.', category: 'technical', section: 'C.3' },
  { id: 'REQ-004', requirement: 'Contractor shall manage general construction and renovation of federal office space.', category: 'past_performance', section: 'C.4' },
];

(async () => {
  const built = await buildV2Prompt({
    email: EMAIL,
    sectionType: 'cap_past_performance',
    sourceText: SOURCE,
    requirements: REQUIREMENTS,
  });

  const up = built.userPrompt;
  const hasEvidenceHeader = up.includes('Requirement → your real evidence');
  const hasGapHeader = up.includes('NO matching evidence in the vault');

  console.log(`\n=== Evidence weave prompt check for ${EMAIL} ===`);
  console.log(`evidenceMapped (context): ${built.context.evidenceMapped}`);
  console.log(`"Requirement → your real evidence" block present: ${hasEvidenceHeader ? '✅' : '❌'}`);
  console.log(`"NO matching evidence" (FedRAMP gap) block present: ${hasGapHeader ? '✅' : '❌'}`);

  // Print the woven block so we can eyeball the one-to-one citations.
  const start = up.indexOf('### Requirement → your real evidence');
  if (start >= 0) {
    const end = up.indexOf('### Section to draft', start);
    console.log('\n----- WOVEN BLOCK -----');
    console.log(up.slice(start, end > start ? end : start + 1400).trim());
    console.log('----- END -----');
  }

  const pass = hasEvidenceHeader && (built.context.evidenceMapped ?? 0) >= 2;
  console.log(`\nRESULT: ${pass ? '✅ PASS — evidence woven into the drafting prompt' : '❌ FAIL'}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
