import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Packer } from 'docx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAppendixDoc } from './appendix';
import {
  PROTOTYPE_BANNER,
  getDocumentXml,
  readDocxParts,
} from './docx-fill';
import { evidence, trueZero, unknown, value } from './grounding';
import { normalizeRequirement } from './normalizer';
import {
  createOrGetMrrJob,
  getMrrArtifact,
  getMrrJob,
  resetMrrRunStoreForTests,
  setMrrWorkspaceStoreRootForTests,
  startMrrJob,
} from './run-store';
import {
  WORKSPACE_PROTOTYPE_BANNER,
  applyWorkspacePrototypeBanner,
  runPhase1,
  type Phase1RunResult,
  type Phase1ProgressStage,
} from './run-phase1';
import { createPhase1ReviewDto } from './workspace-dto';

const REQUIREMENT = {
  title: 'Public requirement',
  agency: 'Defense Health Agency',
  keyword: 'modeling and simulation',
  description: 'A public sources-sought description.',
  naics: '541512',
  psc: 'DA01',
};

const ev = evidence('fixture public source', { naics: '541512' });

function fakeResult(
  runId = 'fixture-run',
  intakeHash = 'fixture-hash',
  artifactDir = mkdtempSync(join(tmpdir(), 'mrr-workspace-result-')),
): Phase1RunResult {
  const requirement = normalizeRequirement(REQUIREMENT);
  const mrrPath = join(artifactDir, 'mrr.docx');
  const appendixPath = join(artifactDir, 'appendix.docx');
  const evidencePath = join(artifactDir, 'evidence.json');
  writeFileSync(mrrPath, 'mrr');
  writeFileSync(appendixPath, 'appendix');
  writeFileSync(evidencePath, '{}');

  return {
    runId,
    intakeHash,
    generatedAt: '2026-09-05T12:00:00.000Z',
    requirement,
    section5: {
      primaryNaics: value('541512', ev),
      calls: [],
    } as Phase1RunResult['section5'],
    section9: {
      calls: [],
      predecessorStatus: 'unknown',
      predecessorChecks: [],
    } as Phase1RunResult['section9'],
    section11: {
      suppliers: [],
      rawUeiCount: value(20, ev),
      evaluatedUeiCount: value(10, ev),
      boundedSampleReturned: value(12, ev),
      capableActiveCount: value(10, ev),
      excludedBeforeFamilyResolution: value(2, ev),
      toolLimit: value(50, ev),
      deduplicatedFamilyCount: unknown(
        'corporate-family resolution incomplete',
        [ev],
      ),
      ambiguousParentCount: value(2, ev),
      eligiblePopulation: value(100, ev),
      matchingCoverage: value(0.2, ev),
      sampleToMatchingCoverage: value(0.6, ev),
      effortsToLocate: value('fixture search', ev),
      calls: [],
      limitations: ['The evaluated sample is incomplete.'],
    },
    section12: {
      determination: value('undetermined', ev),
      recommendation: value(
        'Insufficient evidence to support a set-aside.',
        ev,
      ),
      capableFamilyCount: unknown(
        'business-size evidence is incomplete',
        [ev],
      ),
      countedFamilies: [],
      excluded: [{ uei: 'FIXTUREUEI01', reason: 'business size not established' }],
      socioCounts: [],
      goalingContext: unknown('not queried'),
      matchingCoverage: value(0.2, ev),
      calls: [],
      limitations: ['sample_coverage=0.2'],
    },
    section15: {
      totalMarket: value(1_000_000, ev),
      marketBasis: 'fixture',
      supplierConcentration: unknown('not established', [ev]),
      marketDiversity: value('fixture diversity', ev),
      sbFootprint: unknown('incomplete §12 evidence', [ev]),
      socioeconomicFootprint: unknown('not established', [ev]),
      pricingEvidence: {
        state: 'degraded',
        reason: 'pricing source unavailable',
        evidence: [ev],
      },
      pricingIsIge: false,
      calls: [],
      limitations: ['Pricing is supporting evidence only.'],
    },
    cells: [
      {
        label: '§5 Primary NAICS',
        state: 'value',
        text: '541512',
        evidence: [ev],
      },
      {
        label: '§9 Award history',
        state: 'true_zero',
        text: 'Recorded: 0 — no awards in measured fixture',
        evidence: [ev],
      },
      {
        label: '§11 Resolved corporate families',
        state: 'unknown',
        text: 'Unknown / Insufficient evidence — corporate-family resolution incomplete',
        reason: 'corporate-family resolution incomplete',
        evidence: [ev],
      },
      {
        label: '§12 Rule of Two determination',
        state: 'value',
        text: 'undetermined',
        evidence: [ev],
      },
      {
        label: '§15 Pricing evidence',
        state: 'degraded',
        text: 'Degraded — pricing source unavailable',
        reason: 'pricing source unavailable',
        evidence: [ev],
      },
    ],
    limitations: [],
    artifacts: {
      mrr: { path: mrrPath, fileName: 'mrr.docx' },
      appendix: { path: appendixPath, fileName: 'appendix.docx' },
      evidence: { path: evidencePath, fileName: 'evidence.json' },
    },
  };
}

let storeDir = mkdtempSync(join(tmpdir(), 'mrr-workspace-store-'));

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'mrr-workspace-store-'));
  setMrrWorkspaceStoreRootForTests(storeDir);
});

afterEach(() => {
  resetMrrRunStoreForTests();
  delete process.env.MRR_WORKSPACE_STORE_ROOT;
  rmSync(storeDir, { recursive: true, force: true });
});

describe('Phase 1 workspace orchestrator', () => {
  it('puts the public-data prototype banner into generated DOCX artifacts', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'mrr-workspace-banner-'));
    const outPath = join(outDir, 'appendix.docx');
    const document = buildAppendixDoc({
      requirementTitle: 'Public requirement',
      generatedAt: '2026-09-05T12:00:00.000Z',
      runId: 'fixture-run',
      cells: [],
      calls: [],
      limitations: [],
    });
    writeFileSync(outPath, await Packer.toBuffer(document));

    applyWorkspacePrototypeBanner(outPath);

    const xml = getDocumentXml(readDocxParts(outPath));
    expect(xml).toContain(WORKSPACE_PROTOTYPE_BANNER);
    expect(xml).not.toContain(`>${PROTOTYPE_BANNER}<`);
  });

  it('calls the existing section builders in order and emits one bound artifact set', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'mrr-workspace-orchestrator-'));
    const progress: Phase1ProgressStage[] = [];
    const base = fakeResult('run-one', 'hash-one', outDir);

    const result = await runPhase1(REQUIREMENT, {
      runId: 'run-one',
      intakeHash: 'hash-one',
      outDir,
      now: () => new Date('2026-09-05T12:00:00.000Z'),
      onProgress(stage) {
        progress.push(stage);
      },
      dependencies: {
        buildSection5: async () => base.section5,
        buildSection9: async () => base.section9,
        buildSection11: async () => base.section11,
        buildSection12: async () => base.section12,
        buildSection15: async () => base.section15,
        assembleMrr: (_req, _s5, _s9, _s11, _s12, _s15, outPath) => {
          writeFileSync(outPath, 'fixture docx');
          return { outPath, cells: base.cells };
        },
        writeAppendix: async (_input, outPath) => {
          writeFileSync(outPath, 'fixture appendix');
        },
        templateSha256: () => 'fixture-template-sha',
        applyWorkspaceBanner: () => {},
      },
    });

    expect(progress).toEqual([
      'running_section_5',
      'running_section_9',
      'running_section_11',
      'running_section_12',
      'running_section_15',
      'assembling_documents',
      'complete_degraded',
    ]);
    expect(result.runId).toBe('run-one');
    expect(result.intakeHash).toBe('hash-one');
    expect(existsSync(result.artifacts.mrr.path)).toBe(true);
    expect(existsSync(result.artifacts.appendix.path)).toBe(true);
    const evidenceJson = JSON.parse(readFileSync(result.artifacts.evidence.path, 'utf8'));
    expect(evidenceJson).toMatchObject({
      runId: 'run-one',
      intakeHash: 'hash-one',
      marketIntel: { pricingIsIge: false },
    });
  });
});

describe('workspace review DTO', () => {
  it('preserves sourced, unknown, degraded, and measured-zero states', () => {
    const review = createPhase1ReviewDto(fakeResult());
    expect(review.sections.map((section) => [section.id, section.state])).toEqual([
      ['5', 'Sourced'],
      ['9', 'Measured zero'],
      ['11', 'Unknown'],
      ['12', 'Sourced'],
      ['15', 'Degraded'],
    ]);
  });

  it('does not convert a failed or incomplete supplier read into zero', () => {
    const result = fakeResult();
    result.section11.rawUeiCount = unknown('market-depth source failed', [ev]);
    const review = createPhase1ReviewDto(result);
    expect(review.suppliers.matchingUeis.state).toBe('Unknown');
    expect(review.suppliers.matchingUeis.text).not.toContain('Recorded: 0');
    expect(review.suppliers.displayedVendorRows.state).toBe('Unknown');
  });

  it('renders bounded sample, capable/active, and submitted-for-resolution as distinct counts', () => {
    const result = fakeResult();
    result.section11.eligiblePopulation = value(39848, ev);
    result.section11.rawUeiCount = value(791, ev);
    result.section11.boundedSampleReturned = value(50, ev);
    result.section11.capableActiveCount = value(43, ev);
    result.section11.evaluatedUeiCount = value(43, ev);
    result.section11.excludedBeforeFamilyResolution = value(7, ev);
    result.section11.deduplicatedFamilyCount = value(20, ev);
    result.section11.ambiguousParentCount = value(23, ev);
    result.section11.suppliers = Array.from({ length: 25 }, (_, i) => ({
      uei: value(`UEI${String(i).padStart(9, '0')}`, ev),
    })) as Phase1RunResult['section11']['suppliers'];
    const review = createPhase1ReviewDto(result);
    expect(review.suppliers.eligiblePopulation.text).toBe('39848');
    expect(review.suppliers.matchingUeis.text).toBe('791');
    expect(review.suppliers.boundedSampleReturned.text).toBe('50');
    expect(review.suppliers.capableActiveUeis.text).toBe('43');
    expect(review.suppliers.evaluatedUeis.text).toBe('43');
    expect(review.suppliers.evaluatedUeis.label).toMatch(/family resolution/i);
    expect(review.suppliers.displayedVendorRows.text).toBe('25');
    expect(review.suppliers.matchingCoverageRatio).toBe('2.0% (791 / 39,848)');
    expect(review.suppliers.familyResolutionCoverageRatio).toBe('5.4% (43 / 791)');
    expect(review.suppliers.sampleToMatchingRatio).toBe('6.3% (50 / 791)');
    expect(review.suppliers.exclusionNote).toBe(
      '50 suppliers sampled; 43 met the capable/active evaluation gate; 7 were excluded before corporate-family resolution.',
    );
    expect(review.suppliers.completenessWarning).not.toMatch(/six counts are separate/i);
    expect(review.suppliers.completenessWarning).toMatch(/Capable\/active is never the complete bounded sample/i);
  });

  it('keeps Rule of Two undetermined when sample and size evidence are incomplete', () => {
    const review = createPhase1ReviewDto(fakeResult());
    expect(review.ruleOfTwo.determination.text).toBe('undetermined');
    expect(review.ruleOfTwo.recommendation.text).toMatch(/Insufficient evidence/i);
    expect(review.ruleOfTwo.evidenceBoundary).toMatch(/incomplete samples/i);
  });

  it('never represents pricing as a government estimate', () => {
    const review = createPhase1ReviewDto(fakeResult());
    expect(review.pricing.isGovernmentEstimate).toBe(false);
    expect(review.pricing.label).toBe(
      'Supporting pricing evidence — not a government estimate',
    );
  });
});

describe('workspace run store', () => {
  it('deduplicates normalized intake for the same owner', () => {
    const normalized = normalizeRequirement(REQUIREMENT).normalized;
    const first = createOrGetMrrJob({
      ownerEmail: 'ko@example.mil',
      input: REQUIREMENT,
      normalizedRequirement: normalized,
    });
    const second = createOrGetMrrJob({
      ownerEmail: 'ko@example.mil',
      input: { ...REQUIREMENT, ignored: 'not persisted' },
      normalizedRequirement: normalized,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it('binds status and every download to the authenticated owner and one run identity', async () => {
    const normalized = normalizeRequirement(REQUIREMENT).normalized;
    const created = createOrGetMrrJob({
      ownerEmail: 'ko@example.mil',
      input: REQUIREMENT,
      normalizedRequirement: normalized,
    });
    await startMrrJob(
      created.job.id,
      'ko@example.mil',
      async (_input, options) => fakeResult(options.runId, options.intakeHash),
    );

    expect(getMrrJob(created.job.id, 'other@example.mil')).toBeNull();
    expect(getMrrArtifact(created.job.id, 'other@example.mil', 'mrr')).toBeNull();
    const mrr = getMrrArtifact(created.job.id, 'ko@example.mil', 'mrr');
    const appendix = getMrrArtifact(created.job.id, 'ko@example.mil', 'appendix');
    const evidenceArtifact = getMrrArtifact(created.job.id, 'ko@example.mil', 'evidence');
    expect(mrr?.intakeHash).toBe(created.job.intakeHash);
    expect(appendix?.intakeHash).toBe(created.job.intakeHash);
    expect(evidenceArtifact?.intakeHash).toBe(created.job.intakeHash);
  });

  it('serves the same bound artifacts after a process-local store restart', async () => {
    const normalized = normalizeRequirement(REQUIREMENT).normalized;
    const created = createOrGetMrrJob({
      ownerEmail: 'ko@example.mil',
      input: REQUIREMENT,
      normalizedRequirement: normalized,
    });
    await startMrrJob(
      created.job.id,
      'ko@example.mil',
      async (_input, options) => fakeResult(options.runId, options.intakeHash),
    );
    const before = {
      mrr: getMrrArtifact(created.job.id, 'ko@example.mil', 'mrr'),
      appendix: getMrrArtifact(created.job.id, 'ko@example.mil', 'appendix'),
      evidence: getMrrArtifact(created.job.id, 'ko@example.mil', 'evidence'),
    };
    expect(before.mrr?.sha256).toMatch(/^[a-f0-9]{64}$/);

    resetMrrRunStoreForTests();

    const after = {
      mrr: getMrrArtifact(created.job.id, 'ko@example.mil', 'mrr'),
      appendix: getMrrArtifact(created.job.id, 'ko@example.mil', 'appendix'),
      evidence: getMrrArtifact(created.job.id, 'ko@example.mil', 'evidence'),
    };
    expect(after.mrr?.intakeHash).toBe(created.job.intakeHash);
    expect(after.appendix?.intakeHash).toBe(created.job.intakeHash);
    expect(after.evidence?.intakeHash).toBe(created.job.intakeHash);
    expect(after.mrr?.sha256).toBe(before.mrr?.sha256);
    expect(after.appendix?.sha256).toBe(before.appendix?.sha256);
    expect(after.evidence?.sha256).toBe(before.evidence?.sha256);
    expect(readFileSync(after.mrr!.path, 'utf8')).toBe('mrr');
    expect(getMrrJob(created.job.id, 'ko@example.mil')?.status).toBe('done');
    expect(getMrrJob(created.job.id, 'ko@example.mil')?.review).not.toBeNull();
    expect(getMrrJob(created.job.id, 'ko@example.mil')?.review?.runId).toBe(created.job.id);
    expect(getMrrArtifact(created.job.id, 'other@example.mil', 'mrr')).toBeNull();
    expect(getMrrArtifact('missing-run-id', 'ko@example.mil', 'mrr')).toBeNull();
    expect(getMrrArtifact('../etc/passwd', 'ko@example.mil', 'mrr')).toBeNull();
    expect(getMrrArtifact(`${created.job.id}/../${created.job.id}`, 'ko@example.mil', 'mrr')).toBeNull();

    const reused = createOrGetMrrJob({
      ownerEmail: 'ko@example.mil',
      input: REQUIREMENT,
      normalizedRequirement: normalized,
    });
    expect(reused.created).toBe(false);
    expect(reused.job.id).toBe(created.job.id);
  });
});

describe('page render boundary', () => {
  it('does not import section builders or the Phase 1 orchestrator', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/app/app/market-research/page.tsx'),
      'utf8',
    );
    expect(page).not.toMatch(/run-phase1|section-5|section-9|section-11|section-12|section-15/);
    expect(page).not.toMatch(/bigquery|assessMarketDepth|assess_market_depth/);
  });
});
