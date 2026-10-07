import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(review.suppliers.completenessWarning).toMatch(/each percentage names its denominator/i);
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
  it('accepts a job when the local store root is not writable', () => {
    const root = join(tmpdir(), `mrr-ro-accept-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    chmodSync(root, 0o555);
    setMrrWorkspaceStoreRootForTests(root);
    resetMrrRunStoreForTests();
    try {
      const normalized = normalizeRequirement(REQUIREMENT).normalized;
      const created = createOrGetMrrJob({
        ownerEmail: 'ko@example.mil',
        input: REQUIREMENT,
        normalizedRequirement: normalized,
      });
      expect(created.created).toBe(true);
      expect(created.job.status).toBe('queued');
      expect(getMrrJob(created.job.id, 'ko@example.mil')?.id).toBe(created.job.id);
    } finally {
      chmodSync(root, 0o755);
      rmSync(root, { recursive: true, force: true });
      resetMrrRunStoreForTests();
      setMrrWorkspaceStoreRootForTests('');
    }
  });

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

describe('hosted durability — files survive instance changes, ownership enforced', () => {
  // In-memory stand-in for the private Supabase Storage bucket.
  function memoryStore() {
    const objects = new Map<string, Buffer>();
    return {
      objects,
      store: {
        async put(path: string, bytes: Buffer) {
          objects.set(path, Buffer.from(bytes));
        },
        async get(path: string) {
          return objects.get(path) ?? null;
        },
        async list(runId: string) {
          return [...objects.keys()].filter((k) => k.startsWith(`${runId}/`)).map((k) => k.slice(runId.length + 1));
        },
      },
    };
  }

  async function completedRun(owner = 'ko@example.mil') {
    const normalized = normalizeRequirement(REQUIREMENT).normalized;
    const created = createOrGetMrrJob({ ownerEmail: owner, input: REQUIREMENT, normalizedRequirement: normalized });
    await startMrrJob(created.job.id, owner, async (_input, options) => fakeResult(options.runId, options.intakeHash));
    return { id: created.job.id, normalized };
  }

  /** What another Vercel instance sees: metadata (KV in prod), no local /tmp files. */
  function dropLocalFiles(id: string) {
    for (const name of ['mrr.docx', 'appendix.docx', 'evidence.json']) {
      rmSync(join(storeDir, id, name), { force: true });
    }
  }

  afterEach(async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    setMrrArtifactStoreForTests(null);
  });

  it('stores all three files durably before the run is marked done', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const mem = memoryStore();
    setMrrArtifactStoreForTests(mem.store);
    const { id } = await completedRun();
    expect([...mem.objects.keys()].sort()).toEqual(
      [`${id}/appendix.docx`, `${id}/evidence.json`, `${id}/mrr.docx`],
    );
    const job = getMrrJob(id, 'ko@example.mil');
    expect(job?.status).toBe('done');
  });

  it('serves the durable copy when this instance never had the files, verified by hash', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const { readOwnedMrrArtifact, mrrFilesAvailable, loadJob } = await import('./run-store-read');
    const mem = memoryStore();
    setMrrArtifactStoreForTests(mem.store);
    const { id } = await completedRun();
    dropLocalFiles(id);

    for (const [kind, body] of [['mrr', 'mrr'], ['appendix', 'appendix'], ['evidence', '{}']] as const) {
      const read = await readOwnedMrrArtifact(id, 'ko@example.mil', kind);
      expect(read.status).toBe('ok');
      if (read.status === 'ok') expect(read.bytes.toString()).toBe(body);
    }
    expect(await mrrFilesAvailable(loadJob(id)!)).toBe(true);
  });

  it('another account cannot read the run or any of its files', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const { readOwnedMrrArtifact, loadOwnedMrrJobAsync } = await import('./run-store-read');
    setMrrArtifactStoreForTests(memoryStore().store);
    const { id } = await completedRun();
    expect(await loadOwnedMrrJobAsync(id, 'someone-else@example.com')).toBeNull();
    for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
      expect(await readOwnedMrrArtifact(id, 'someone-else@example.com', kind)).toEqual({ status: 'not_found' });
    }
  });

  it('never serves tampered bytes: a hash mismatch is reported as unavailable', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const { readOwnedMrrArtifact } = await import('./run-store-read');
    const mem = memoryStore();
    setMrrArtifactStoreForTests(mem.store);
    const { id } = await completedRun();
    dropLocalFiles(id);
    mem.objects.set(`${id}/mrr.docx`, Buffer.from('not the report'));
    expect((await readOwnedMrrArtifact(id, 'ko@example.mil', 'mrr')).status).toBe('unavailable');
  });

  it('asking the same question again rebuilds a run whose files are gone — same run id', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const { createOrGetMrrJobAsync, loadJob, mrrFilesAvailable } = await import('./run-store-read');
    const mem = memoryStore();
    setMrrArtifactStoreForTests(mem.store);
    const { id, normalized } = await completedRun();
    // A run assembled before durable storage existed: done, no stored copy, local /tmp gone.
    mem.objects.clear();
    dropLocalFiles(id);
    expect(await mrrFilesAvailable(loadJob(id)!)).toBe(false);

    const again = await createOrGetMrrJobAsync({
      ownerEmail: 'ko@example.mil',
      input: REQUIREMENT,
      normalizedRequirement: normalized,
    });
    expect(again.created).toBe(true);
    expect(again.job.id).toBe(id);
    expect(again.job.status).toBe('queued');

    await startMrrJob(id, 'ko@example.mil', async (_input, options) => fakeResult(options.runId, options.intakeHash));
    dropLocalFiles(id);
    expect(await mrrFilesAvailable(loadJob(id)!)).toBe(true);
  });

  it('a completed run with available files is reused, not re-run', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const { createOrGetMrrJobAsync } = await import('./run-store-read');
    setMrrArtifactStoreForTests(memoryStore().store);
    const { id, normalized } = await completedRun();
    const again = await createOrGetMrrJobAsync({
      ownerEmail: 'ko@example.mil',
      input: REQUIREMENT,
      normalizedRequirement: normalized,
    });
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(id);
    expect(again.job.status).toBe('done');
  });

  it('a failed or stalled run is re-run when the same question is asked again', async () => {
    const { needsRerun, MRR_STALE_RUN_MS, loadJob } = await import('./run-store-read');
    const normalized = normalizeRequirement(REQUIREMENT).normalized;
    const created = createOrGetMrrJob({ ownerEmail: 'ko@example.mil', input: REQUIREMENT, normalizedRequirement: normalized });
    const job = loadJob(created.job.id)!;
    job.status = 'running';
    job.updatedAt = new Date(Date.now() - MRR_STALE_RUN_MS - 1000).toISOString();
    expect(await needsRerun(job)).toBe(true);
    job.updatedAt = new Date().toISOString();
    expect(await needsRerun(job)).toBe(false);
    job.status = 'error';
    expect(await needsRerun(job)).toBe(true);
  });

  it('an unreachable store is "unknown", never "missing" — no needless rebuild', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    const { needsRerun, mrrFilesAvailable, loadJob } = await import('./run-store-read');
    const mem = memoryStore();
    setMrrArtifactStoreForTests(mem.store);
    const { id } = await completedRun();
    dropLocalFiles(id);
    setMrrArtifactStoreForTests({
      ...mem.store,
      async list() {
        throw new Error('storage down');
      },
    });
    expect(await mrrFilesAvailable(loadJob(id)!)).toBeNull();
    expect(await needsRerun(loadJob(id)!)).toBe(false);
  });

  it('a run whose files cannot be saved fails visibly instead of finishing without files', async () => {
    const { setMrrArtifactStoreForTests } = await import('./artifact-storage');
    setMrrArtifactStoreForTests({
      async put() {
        throw new Error('bucket unavailable');
      },
      async get() {
        return null;
      },
      async list() {
        return [];
      },
    });
    const normalized = normalizeRequirement(REQUIREMENT).normalized;
    const created = createOrGetMrrJob({ ownerEmail: 'ko@example.mil', input: REQUIREMENT, normalizedRequirement: normalized });
    await startMrrJob(created.job.id, 'ko@example.mil', async (_input, options) => fakeResult(options.runId, options.intakeHash));
    const job = getMrrJob(created.job.id, 'ko@example.mil');
    expect(job?.status).toBe('error');
    expect(job?.error).toMatch(/report files could not be saved/);
  });
});
