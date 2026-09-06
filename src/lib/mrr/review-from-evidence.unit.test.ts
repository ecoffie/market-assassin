import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evidence, unknown, value } from './grounding';
import { normalizeRequirement } from './normalizer';
import {
  reviewSourceFromEvidence,
  requireEvidenceRequirement,
  requireFiniteCensus,
  requireRunIdentity,
} from './review-from-evidence';
import {
  persistCompletedMrrJobFromEvidence,
  resetMrrRunStoreForTests,
  setMrrWorkspaceStoreRootForTests,
  getMrrJob,
} from './run-store';
import { createPhase1ReviewDto } from './workspace-dto';

const HASH = '1111111111111111111111111111111111111111111111111111111111111111';
const RUN_ID = 'generic-va-janitorial';
const ev = evidence('fixture public source', { naics: '561720' });

const REQUIREMENT = {
  title: 'Janitorial Services for VA Medical Center',
  agency: 'Department of Veterans Affairs',
  sub_agency: 'Veterans Health Administration',
  office: 'Network Contracting Office 8',
  naics: '561720',
  psc: 'S201',
  keyword: 'janitorial',
  description: 'The Department of Veterans Affairs is conducting market research on janitorial services.',
  solicitation_number: 'VA-NCO8-JANITORIAL-2026',
};

function reviewableResult() {
  const requirement = normalizeRequirement(REQUIREMENT);
  return {
    runId: RUN_ID,
    intakeHash: HASH,
    generatedAt: '2026-09-05T18:00:00.000Z',
    requirement,
    cells: [
      {
        label: '§5 Primary NAICS',
        state: 'value' as const,
        text: '561720',
        evidence: [ev],
      },
      {
        label: '§9 Award history',
        state: 'true_zero' as const,
        text: 'Recorded: 0 — no awards in measured fixture',
        evidence: [ev],
      },
      {
        label: '§11 Resolved corporate families',
        state: 'unknown' as const,
        text: 'Unknown / Insufficient evidence — corporate-family resolution incomplete',
        reason: 'corporate-family resolution incomplete',
        evidence: [ev],
      },
      {
        label: '§12 Rule of Two determination',
        state: 'value' as const,
        text: 'undetermined',
        evidence: [ev],
      },
      {
        label: '§15 Pricing evidence',
        state: 'degraded' as const,
        text: 'Degraded — pricing source unavailable',
        reason: 'pricing source unavailable',
        evidence: [ev],
      },
    ],
    section11: {
      suppliers: [{ uei: 'VAUEI00001' }, { uei: 'VAUEI00002' }],
      rawUeiCount: value(20, ev),
      evaluatedUeiCount: value(10, ev),
      boundedSampleReturned: value(12, ev),
      capableActiveCount: value(10, ev),
      excludedBeforeFamilyResolution: value(2, ev),
      deduplicatedFamilyCount: unknown('corporate-family resolution incomplete', [ev]),
      ambiguousParentCount: value(2, ev),
      eligiblePopulation: value(100, ev),
      limitations: ['The evaluated sample is incomplete.'],
    },
    section12: {
      determination: value('undetermined' as const, ev),
      recommendation: value('Insufficient evidence to support a set-aside.', ev),
      limitations: ['sample_coverage=0.2'],
    },
    section15: {
      pricingEvidence: {
        state: 'degraded' as const,
        reason: 'pricing source unavailable',
        evidence: [ev],
      },
      limitations: ['Pricing is supporting evidence only.'],
    },
  };
}

export function evidenceBundleFromReviewSource(source: ReturnType<typeof reviewableResult>) {
  return {
    runId: source.runId,
    intakeHash: source.intakeHash,
    generatedAt: source.generatedAt,
    requirement: source.requirement.normalized,
    normalizationNotes: source.requirement.notes,
    cells: source.cells,
    suppliers: {
      rawUeiCount: source.section11.rawUeiCount,
      evaluatedUeiCount: source.section11.evaluatedUeiCount,
      boundedSampleReturned: source.section11.boundedSampleReturned,
      capableActiveCount: source.section11.capableActiveCount,
      excludedBeforeFamilyResolution: source.section11.excludedBeforeFamilyResolution,
      deduplicatedFamilyCount: source.section11.deduplicatedFamilyCount,
      ambiguousParentCount: source.section11.ambiguousParentCount,
      eligiblePopulation: source.section11.eligiblePopulation,
      families: source.section11.suppliers.map((row, index) => ({
        uei: 'uei' in row ? row.uei : `UEI${index}`,
        familyKey: null,
        method: 'lookup_failed',
        confidence: 'unresolved',
        ruleOfTwoEligible: false,
        memberUeis: [],
      })),
    },
    ruleOfTwo: {
      determination: source.section12.determination,
      recommendation: source.section12.recommendation,
    },
    marketIntel: {
      pricingEvidence: source.section15.pricingEvidence,
      pricingIsIge: false,
    },
    limitations: [
      ...source.section11.limitations.map((item) => `§11: ${item}`),
      ...source.section12.limitations.map((item) => `§12: ${item}`),
      ...source.section15.limitations.map((item) => `§15: ${item}`),
    ],
  };
}

describe('review reconstruction from evidence', () => {
  it('produces the same canonical review payload as createPhase1ReviewDto on the live result', () => {
    const source = reviewableResult();
    const fromLive = createPhase1ReviewDto(source);
    const fromEvidence = createPhase1ReviewDto(
      reviewSourceFromEvidence(evidenceBundleFromReviewSource(source), { runId: RUN_ID, intakeHash: HASH }),
    );
    expect(fromEvidence).toEqual(fromLive);
    expect(fromEvidence.requirement.agency).toBe('Department of Veterans Affairs');
    expect(fromEvidence.requirement.naics).toBe('561720');
    expect(fromEvidence.requirement.agency).not.toMatch(/Defense Health/);
  });

  it('fails closed on missing identity, requirement, census, cells, or Rule-of-Two vocabulary', () => {
    const source = reviewableResult();
    const bundle = evidenceBundleFromReviewSource(source);
    expect(() => requireRunIdentity({ generatedAt: bundle.generatedAt })).toThrow(/missing runId/);
    expect(() => requireFiniteCensus('eligiblePopulation', undefined)).toThrow(/eligiblePopulation/);
    expect(() => requireEvidenceRequirement({})).toThrow(/missing requirement/);
    expect(() =>
      reviewSourceFromEvidence({ ...bundle, intakeHash: undefined }, { runId: RUN_ID }),
    ).toThrow(/intakeHash/);
    expect(() =>
      reviewSourceFromEvidence({ ...bundle, cells: [] }, { runId: RUN_ID, intakeHash: HASH }),
    ).toThrow(/cells are missing/);
    expect(() =>
      reviewSourceFromEvidence(
        {
          ...bundle,
          ruleOfTwo: { ...bundle.ruleOfTwo, determination: { ...bundle.ruleOfTwo.determination, value: 'maybe' } },
        },
        { runId: RUN_ID, intakeHash: HASH },
      ),
    ).toThrow(/vocabulary/);
    expect(() =>
      reviewSourceFromEvidence(
        { ...bundle, requirement: { ...bundle.requirement, keyword: '' } },
        { runId: RUN_ID, intakeHash: HASH },
      ),
    ).toThrow(/keyword/);
  });
});

describe('persist completed job from evidence', () => {
  let storeDir = '';

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'mrr-review-persist-'));
    setMrrWorkspaceStoreRootForTests(storeDir);
  });

  afterEach(() => {
    resetMrrRunStoreForTests();
    rmSync(storeDir, { recursive: true, force: true });
  });

  it('restamps a completed job.json that had review:null without rewriting artifacts', () => {
    const source = reviewableResult();
    const dir = join(storeDir, RUN_ID);
    mkdirSync(dir, { recursive: true });
    const names = {
      mrr: `MRR-VA-NCO8-JANITORIAL-2026-${RUN_ID}.docx`,
      appendix: `MRR-VA-NCO8-JANITORIAL-2026-${RUN_ID}-appendix.docx`,
      evidence: `MRR-VA-NCO8-JANITORIAL-2026-${RUN_ID}-evidence.json`,
    };
    writeFileSync(join(dir, names.mrr), 'generic-mrr');
    writeFileSync(join(dir, names.appendix), 'generic-appendix');
    writeFileSync(join(dir, names.evidence), `${JSON.stringify(evidenceBundleFromReviewSource(source), null, 2)}\n`);
    const sha = (fileName: string) =>
      createHash('sha256').update(readFileSync(join(dir, fileName))).digest('hex');
    const before = {
      mrr: sha(names.mrr),
      appendix: sha(names.appendix),
      evidence: sha(names.evidence),
    };
    writeFileSync(
      join(dir, 'job.json'),
      `${JSON.stringify(
        {
          version: 1,
          id: RUN_ID,
          ownerEmail: 'ko@example.mil',
          intakeHash: HASH,
          input: { title: source.requirement.normalized.title },
          status: 'done',
          progress: 'complete',
          progressHistory: [{ stage: 'complete', at: source.generatedAt }],
          artifacts: {
            mrr: { path: join(dir, names.mrr), fileName: names.mrr, sha256: before.mrr },
            appendix: { path: join(dir, names.appendix), fileName: names.appendix, sha256: before.appendix },
            evidence: { path: join(dir, names.evidence), fileName: names.evidence, sha256: before.evidence },
          },
          review: null,
          error: null,
          createdAt: source.generatedAt,
          updatedAt: source.generatedAt,
        },
        null,
        2,
      )}\n`,
    );

    const persisted = persistCompletedMrrJobFromEvidence({
      runId: RUN_ID,
      ownerEmail: 'ko@example.mil',
    });
    expect(persisted.status).toBe('done');
    expect(persisted.review).not.toBeNull();
    expect(persisted.review?.runId).toBe(RUN_ID);
    expect(persisted.review?.requirement.agency).toBe('Department of Veterans Affairs');

    resetMrrRunStoreForTests();
    const afterRestart = getMrrJob(RUN_ID, 'ko@example.mil');
    expect(afterRestart?.status).toBe('done');
    expect(afterRestart?.review).toEqual(persisted.review);
    expect(sha(names.mrr)).toBe(before.mrr);
    expect(sha(names.appendix)).toBe(before.appendix);
    expect(sha(names.evidence)).toBe(before.evidence);
    expect(JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')).review).not.toBeNull();
  });
});
