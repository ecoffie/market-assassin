import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evidence, value } from './grounding';
import { createPhase1ReviewDto } from './workspace-dto';
import { normalizeRequirement } from './normalizer';
import type { Phase1RunResult } from './run-phase1';

const ROOT = join(__dirname, '../../..');

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('artifact identity and reopen-without-requery', () => {
  it('binds MRR DOCX, appendix DOCX, and evidence JSON to one runId', () => {
    const assemble = src('src/lib/mrr/assemble.ts');
    const appendix = src('src/lib/mrr/appendix.ts');
    const phase1 = src('src/lib/mrr/run-phase1.ts');
    expect(assemble).toMatch(/runId: string/);
    expect(assemble).toMatch(/Run ID: \$\{runId\}/);
    expect(appendix).toMatch(/runId: string/);
    expect(appendix).toMatch(/Run ID: \$\{input\.runId\}/);
    expect(phase1).toMatch(/options\.runId/);
    expect(phase1).toMatch(/runId: result\.runId/);
    expect(phase1).toMatch(/generatedAt,/);
    expect(phase1).toMatch(/templateSha256/);
  });

  it('opening or downloading an artifact performs zero MCP/BQ calls', () => {
    const download = src('src/app/api/app/market-research/download/route.ts');
    const page = src('src/app/app/market-research/page.tsx');
    const getRoute = src('src/app/api/app/market-research/route.ts');
    expect(download).toMatch(/readBoundArtifactFile/);
    expect(download).toMatch(/getMrrArtifact/);
    expect(download).not.toMatch(/from ['"]@\/lib\/mrr\/run-store['"]/);
    expect(download).not.toMatch(/from ['"]@\/lib\/mrr\/run-phase1['"]/);
    expect(download).not.toMatch(/assessMarketDepth|bqQuery|callTool|mindy-client|assembleMrr|writeAppendix|docx-fill/);
    expect(page).not.toMatch(/run-phase1|assessMarketDepth|bigquery|callTool/);
    const getFn = getRoute.slice(getRoute.indexOf('export async function GET'));
    expect(getFn).toMatch(/getMrrJob/);
    expect(getFn).not.toMatch(/startMrrJob|runPhase1|bqQuery|callTool|persistCompletedMrrJobFromEvidence|writeFileSync/);
    expect(download).not.toMatch(/persistCompletedMrrJobFromEvidence|writeFileSync/);
    const persist = src('src/lib/mrr/run-store.ts');
    const persistFn = persist.slice(persist.indexOf('export function persistCompletedMrrJobFromEvidence'));
    expect(persistFn).toMatch(/reviewSourceFromEvidence/);
    expect(persistFn).toMatch(/createPhase1ReviewDto/);
    expect(persistFn).not.toMatch(/runPhase1|runMcpTool|bqQuery|assessMarketDepth/);
    const fromEvidence = src('src/lib/mrr/review-from-evidence.ts');
    expect(fromEvidence).not.toMatch(/runMcpTool|bqQuery|assessMarketDepth|DEFAULT_REQUIREMENT|Defense Health/);
  });

  it('workspace UI renders distinct sample, capable/active, and coverage ratios', () => {
    const ui = src('src/components/app/market-research/MarketResearchWorkspace.tsx');
    expect(ui).toMatch(/review\.suppliers\.eligiblePopulation/);
    expect(ui).toMatch(/review\.suppliers\.matchingUeis/);
    expect(ui).toMatch(/review\.suppliers\.boundedSampleReturned/);
    expect(ui).toMatch(/review\.suppliers\.capableActiveUeis/);
    expect(ui).toMatch(/review\.suppliers\.evaluatedUeis/);
    expect(ui).toMatch(/review\.suppliers\.resolvedCorporateFamilies/);
    expect(ui).toMatch(/review\.suppliers\.ambiguousOrUnresolvedParents/);
    expect(ui).toMatch(/review\.suppliers\.displayedVendorRows/);
    expect(ui).toMatch(/Matching coverage:/);
    expect(ui).toMatch(/Family-resolution coverage:/);
    expect(ui).toMatch(/Sample coverage:/);
    expect(ui).toMatch(/exclusionNote/);
  });

  it('pricingIsIge remains false through the review DTO', () => {
    const ev = evidence('fixture', { naics: '541512' });
    const requirement = normalizeRequirement({
      title: 'Public requirement',
      agency: 'Defense Health Agency',
      keyword: 'modeling and simulation',
      description: 'A public sources-sought description.',
      naics: '541512',
      psc: 'DA01',
    });
    const review = createPhase1ReviewDto({
      runId: 'shared-run',
      intakeHash: 'hash',
      generatedAt: '2026-09-05T12:00:00.000Z',
      requirement,
      section5: { primaryNaics: value('541512', ev), calls: [], limitations: [] } as Phase1RunResult['section5'],
      section9: {
        calls: [],
        predecessorStatus: 'unknown',
        predecessorChecks: [],
      } as Phase1RunResult['section9'],
      section11: {
        suppliers: [],
        rawUeiCount: value(791, ev),
        evaluatedUeiCount: value(43, ev),
        boundedSampleReturned: value(50, ev),
        capableActiveCount: value(43, ev),
        excludedBeforeFamilyResolution: value(7, ev),
        toolLimit: value(50, ev),
        deduplicatedFamilyCount: value(32, ev),
        ambiguousParentCount: value(18, ev),
        eligiblePopulation: value(39848, ev),
        matchingCoverage: value(791 / 39848, ev),
        sampleToMatchingCoverage: value(50 / 791, ev),
        effortsToLocate: value('fixture', ev),
        calls: [],
        limitations: [],
      } as Phase1RunResult['section11'],
      section12: {
        determination: value('undetermined', ev),
        recommendation: value('Insufficient evidence to support a set-aside.', ev),
        capableFamilyCount: value(0, ev),
        countedFamilies: [],
        excluded: [],
        socioCounts: [],
        goalingContext: value('fixture', ev),
        matchingCoverage: value(791 / 39848, ev),
        calls: [],
        limitations: [],
      } as Phase1RunResult['section12'],
      section15: {
        totalMarket: value(1, ev),
        marketBasis: 'fixture',
        supplierConcentration: value('n/a', ev),
        marketDiversity: value('n/a', ev),
        sbFootprint: value('n/a', ev),
        socioeconomicFootprint: value('n/a', ev),
        pricingEvidence: value('supporting market research rates', ev),
        pricingIsIge: false,
        calls: [],
        limitations: [],
      },
      cells: [],
      limitations: [],
      artifacts: {
        mrr: { path: 'mrr.docx', fileName: 'mrr.docx' },
        appendix: { path: 'appendix.docx', fileName: 'appendix.docx' },
        evidence: { path: 'evidence.json', fileName: 'evidence.json' },
      },
    });
    expect(review.runId).toBe('shared-run');
    expect(review.pricing.isGovernmentEstimate).toBe(false);
    expect(review.pricing.label).toMatch(/not a government estimate/i);
  });
});

describe('BigQuery activity query guards in source', () => {
  it('labels the activity job and caps billed bytes; never retries quota in client', () => {
    const mr = src('src/lib/gov-buyer/market-research.ts');
    const client = src('src/lib/bigquery/client.ts');
    expect(mr).toMatch(/queryFamily: 'market-depth-activity'/);
    expect(mr).toMatch(/maximumBytesBilled: ACTIVITY_MAX_BYTES/);
    expect(mr).toMatch(/ACTIVITY_MAX_BYTES/);
    expect(client).toMatch(/quotaExceeded/);
    expect(client).toMatch(/shouldRetryBigQueryError/);
    expect(mr).not.toMatch(/COALESCE\(parent_uei, recipient_uei\)\s*=\s*@familyKey/);
  });
});
