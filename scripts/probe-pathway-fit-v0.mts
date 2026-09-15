/**
 * Blind PATHWAY FIT probes A/B/C — live CAI + UEI when env available;
 * always prints fixture-based results for deterministic acceptance evidence.
 *
 * Usage: npx tsx scripts/probe-pathway-fit-v0.mts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '../../.env.local') });

import { matchCompanyToPathwaysPure } from '@/lib/pathways/pathway-fit-match';
import {
  caiConstruction,
  caiSocomCyber,
  caiVaIt,
  companyCyberRelevant,
  companyUnrelatedConstruction,
} from '@/lib/pathways/pathway-fit-fixtures';
import type { MatchCompanyToPathwaysResult } from '@/lib/pathways/pathway-fit-types';

function summarize(label: string, r: MatchCompanyToPathwaysResult) {
  const positive = r.doors.filter(
    (d) => d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT',
  );
  console.log(`\n=== ${label} ===`);
  console.log(
    JSON.stringify(
      {
        no_proven_door: r.summary.no_proven_door,
        headline: r.summary.headline,
        supported: r.summary.supported_count,
        possible: r.summary.possible_count,
        ranked_positive: positive.map((d) => ({
          door: d.door,
          determination: d.determination,
          score: d.rank.score,
          components: d.rank.components,
          why: d.why_this_fit,
          buyer_n: d.buyer_evidence.length,
          company_n: d.company_evidence.length,
          proof_to_lead_with: d.proof_to_lead_with.map((p) => p.label),
          proof_missing: d.proof_missing.map((m) => m.code),
          additional_advantages: d.additional_advantages.map((a) => a.statement.slice(0, 80)),
        })),
        _next: r._next,
      },
      null,
      2,
    ),
  );
}

async function maybeLive() {
  const uei = process.env.PATHWAY_FIT_PROBE_UEI;
  if (!uei) {
    console.log('\n(live UEI probe skipped — set PATHWAY_FIT_PROBE_UEI to exercise load path)');
    return;
  }
  try {
    const { matchCompanyToPathways } = await import('@/lib/pathways');
    const { getCurrentAcquisitionIntelligence } = await import(
      '@/lib/opportunities/current-acquisition-intelligence'
    );
    const cai = await getCurrentAcquisitionIntelligence({
      agency: 'SOCOM',
      capability: 'cybersecurity',
      window_days: 90,
    });
    const r = await matchCompanyToPathways({
      uei,
      cai,
      actor: 'eric@govcongiants.com',
    });
    summarize('LIVE A: SOCOM cyber + PATHWAY_FIT_PROBE_UEI', r);
  } catch (e) {
    console.log('LIVE probe failed:', e instanceof Error ? e.message : e);
  }
}

async function main() {
  // A — SOCOM cyber + relevant cyber company (fixture)
  summarize('A fixture: SOCOM cyber + cyber-relevant UEI', matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant()));

  // B — VA IT + cert
  summarize(
    'B fixture: VA IT + SDVOSB authoritative + IT awards',
    matchCompanyToPathwaysPure(
      caiVaIt(),
      companyCyberRelevant({
        certifications: [
          { code: 'SDVOSB', label: 'SDVOSB', provenance_state: 'sba', authoritative: true },
        ],
      }),
    ),
  );

  // C — construction buyer + construction company (positive conventional)
  // Also demonstrate NO_PROVEN_DOOR: construction company vs SOCOM cyber
  summarize(
    'C fixture: USACE construction + construction UEI',
    matchCompanyToPathwaysPure(caiConstruction(), companyUnrelatedConstruction()),
  );
  summarize(
    'C-miss fixture: SOCOM cyber + construction-only UEI (expect NO_PROVEN_DOOR)',
    matchCompanyToPathwaysPure(caiSocomCyber(), companyUnrelatedConstruction()),
  );

  await maybeLive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
