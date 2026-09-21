/**
 * Local-only helper: persist one synthetic completed MRR run so a fresh
 * Next.js process can download artifacts without research/MCP/BigQuery.
 * Writes under out/mrr-workspace (gitignored). Not a live DHA generator.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidence, unknown, value } from '../src/lib/mrr/grounding';
import { normalizeRequirement } from '../src/lib/mrr/normalizer';
import {
  createOrGetMrrJob,
  startMrrJob,
} from '../src/lib/mrr/run-store';
import type { Phase1RunResult } from '../src/lib/mrr/run-phase1';

const REQUIREMENT = {
  title: 'Public synthetic requirement',
  agency: 'Department of Veterans Affairs',
  keyword: 'janitorial',
  description: 'Synthetic public-data fixture for download persistence proof.',
  naics: '561720',
  psc: 'S201',
};

async function main() {
  const normalized = normalizeRequirement(REQUIREMENT).normalized;
  const created = createOrGetMrrJob({
    ownerEmail: 'ko@example.mil',
    input: REQUIREMENT,
    normalizedRequirement: normalized,
  });
  await startMrrJob(
    created.job.id,
    'ko@example.mil',
    async (_input, options) => {
      const dir = join(process.cwd(), 'out', 'mrr-workspace', options.runId, 'scratch');
      mkdirSync(dir, { recursive: true });
      const mrrPath = join(dir, 'mrr.docx');
      const appendixPath = join(dir, 'appendix.docx');
      const evidencePath = join(dir, 'evidence.json');
      writeFileSync(mrrPath, 'synthetic-mrr');
      writeFileSync(appendixPath, 'synthetic-appendix');
      writeFileSync(
        evidencePath,
        JSON.stringify({ runId: options.runId, intakeHash: options.intakeHash }, null, 2),
      );
      const ev = evidence('synthetic fixture', { naics: '561720' });
      return {
        runId: options.runId,
        intakeHash: options.intakeHash,
        generatedAt: '2026-09-06T12:00:00.000Z',
        requirement: normalizeRequirement(REQUIREMENT),
        section5: { primaryNaics: value('561720', ev), calls: [] },
        section9: { calls: [], predecessorStatus: 'unknown', predecessorChecks: [] },
        section11: {
          suppliers: [],
          rawUeiCount: value(20, ev),
          evaluatedUeiCount: value(10, ev),
          boundedSampleReturned: value(12, ev),
          capableActiveCount: value(10, ev),
          excludedBeforeFamilyResolution: value(2, ev),
          toolLimit: value(50, ev),
          deduplicatedFamilyCount: unknown('fixture', [ev]),
          ambiguousParentCount: value(2, ev),
          eligiblePopulation: value(100, ev),
          matchingCoverage: value(0.2, ev),
          sampleToMatchingCoverage: value(0.6, ev),
          effortsToLocate: value('fixture', ev),
          calls: [],
          limitations: [],
        },
        section12: {
          determination: value('undetermined', ev),
          recommendation: value('Insufficient evidence to support a set-aside.', ev),
          capableFamilyCount: unknown('fixture', [ev]),
          countedFamilies: [],
          excluded: [],
          socioCounts: [],
          goalingContext: unknown('not queried'),
          matchingCoverage: value(0.2, ev),
          calls: [],
          limitations: [],
        },
        section15: {
          totalMarket: value(1, ev),
          marketBasis: 'fixture',
          supplierConcentration: unknown('n/a', [ev]),
          marketDiversity: value('n/a', ev),
          sbFootprint: unknown('n/a', [ev]),
          socioeconomicFootprint: unknown('n/a', [ev]),
          pricingEvidence: { state: 'degraded', reason: 'fixture', evidence: [ev] },
          pricingIsIge: false,
          calls: [],
          limitations: [],
        },
        cells: [],
        limitations: [],
        artifacts: {
          mrr: { path: mrrPath, fileName: 'mrr.docx' },
          appendix: { path: appendixPath, fileName: 'appendix.docx' },
          evidence: { path: evidencePath, fileName: 'evidence.json' },
        },
      } as unknown as Phase1RunResult;
    },
  );
  process.stdout.write(`${created.job.id}\n`);
}

void main();
