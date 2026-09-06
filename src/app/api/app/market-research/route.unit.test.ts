import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import * as bqClient from '@/lib/bigquery/client';
import * as mcpRegistry from '@/lib/mcp/tool-registry';
import { GET, POST, parsePublicMrrIntake } from './route';
import { GET as DOWNLOAD } from './download/route';
import { normalizeRequirement } from '@/lib/mrr/normalizer';
import {
  createOrGetMrrJob,
  normalizedIntakeHash,
  persistCompletedMrrJobFromEvidence,
  resetMrrRunStoreForTests,
  setMrrWorkspaceStoreRootForTests,
  startMrrJob,
} from '@/lib/mrr/run-store';
import { evidence, unknown, value } from '@/lib/mrr/grounding';
import type { Phase1RunResult } from '@/lib/mrr/run-phase1';

const VALID_BODY = {
  title: 'Public requirement',
  agency: 'Defense Health Agency',
  keyword: 'modeling and simulation',
  description: 'A public sources-sought description.',
  naics: '541512',
  psc: 'DA01',
  public_data_only_confirmed: true,
};

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'mrr-workspace-unit-test-secret';
});

function authHeaders(email = 'ko@example.mil') {
  return {
    'content-type': 'application/json',
    'x-mi-auth-token': createMIAuthSessionToken(email),
  };
}

describe('market research workspace API authorization', () => {
  it('rejects unauthenticated status reads', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/app/market-research?id=fixture'),
    );
    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated job creation before research can run', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/app/market-research', {
        method: 'POST',
        body: JSON.stringify(VALID_BODY),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects unauthenticated downloads', async () => {
    const response = await DOWNLOAD(
      new NextRequest(
        'http://localhost/api/app/market-research/download?id=fixture&kind=mrr',
      ),
    );
    expect(response.status).toBe(401);
  });

  it('does not expose internal paths when an authenticated run is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/app/market-research?id=missing-run', {
        headers: authHeaders(),
      }),
    );
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toMatch(/\/Users\/|out\/mrr-workspace/);
  });
});

describe('public-data intake validation', () => {
  it('requires explicit public-data-only confirmation', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/app/market-research', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ...VALID_BODY,
          public_data_only_confirmed: false,
        }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.fieldErrors.public_data_only_confirmed).toMatch(/public information only/i);
  });

  it('rejects prohibited government-estimate and file fields', () => {
    expect(() =>
      parsePublicMrrIntake({ ...VALID_BODY, government_estimate: 500_000 }),
    ).toThrow(/government_estimate/);
    expect(() =>
      parsePublicMrrIntake({ ...VALID_BODY, attachments: ['not-accepted.pdf'] }),
    ).toThrow(/attachments/);
  });

  it('accepts a SAM URL and normalizes its public notice ID', () => {
    const parsed = parsePublicMrrIntake({
      ...VALID_BODY,
      sam_url:
        'https://sam.gov/opp/213a2fe3a447465e8f30699c9f056ec4/view',
    });
    expect(parsed.normalized.notice_id).toBe(
      '213a2fe3a447465e8f30699c9f056ec4',
    );
  });

  it('returns field-specific errors for invalid required intake', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/app/market-research', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          public_data_only_confirmed: true,
          title: '',
          agency: '',
          keyword: '',
          description: '',
        }),
      }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(Object.keys(payload.fieldErrors).sort()).toEqual([
      'agency',
      'description',
      'keyword',
      'title',
    ]);
  });
});

function syntheticResult(
  runId: string,
  intakeHash: string,
  artifactDir: string,
): Phase1RunResult {
  const requirement = normalizeRequirement(VALID_BODY);
  const ev = evidence('fixture public source', { naics: '541512' });
  const mrrPath = join(artifactDir, 'mrr.docx');
  const appendixPath = join(artifactDir, 'appendix.docx');
  const evidencePath = join(artifactDir, 'evidence.json');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(mrrPath, 'synthetic-mrr');
  writeFileSync(appendixPath, 'synthetic-appendix');
  writeFileSync(evidencePath, JSON.stringify({ runId, intakeHash }));
  return {
    runId,
    intakeHash,
    generatedAt: '2026-09-06T12:00:00.000Z',
    requirement,
    section5: { primaryNaics: value('541512', ev), calls: [] } as Phase1RunResult['section5'],
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
  };
}

describe('durable completed-run downloads', () => {
  let storeDir = '';

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'mrr-download-store-'));
    setMrrWorkspaceStoreRootForTests(storeDir);
  });

  afterEach(() => {
    resetMrrRunStoreForTests();
    rmSync(storeDir, { recursive: true, force: true });
  });

  it('downloads all three artifacts after a fresh store instance with zero MCP/BQ calls', async () => {
    const mcpSpy = vi.spyOn(mcpRegistry, 'runMcpTool');
    const bqSpy = vi.spyOn(bqClient, 'bqQuery');
    const normalized = normalizeRequirement(VALID_BODY).normalized;
    const created = createOrGetMrrJob({
      ownerEmail: 'ko@example.mil',
      input: VALID_BODY,
      normalizedRequirement: normalized,
    });
    await startMrrJob(
      created.job.id,
      'ko@example.mil',
      async (_input, options) =>
        syntheticResult(options.runId, options.intakeHash, join(storeDir, options.runId, 'scratch')),
    );

    const first: Record<string, { status: number; sha: string; type: string; name: string }> = {};
    for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
      const response = await DOWNLOAD(
        new NextRequest(
          `http://localhost/api/app/market-research/download?id=${created.job.id}&kind=${kind}`,
          { headers: authHeaders() },
        ),
      );
      expect(response.status).toBe(200);
      first[kind] = {
        status: response.status,
        sha: response.headers.get('X-MRR-Artifact-Sha256') ?? '',
        type: response.headers.get('Content-Type') ?? '',
        name: response.headers.get('Content-Disposition') ?? '',
      };
      expect(response.headers.get('X-MRR-Run-Id')).toBe(created.job.id);
    }
    expect(first.mrr.type).toContain('wordprocessingml');
    expect(first.appendix.type).toContain('wordprocessingml');
    expect(first.evidence.type).toContain('application/json');
    expect(first.mrr.name).toContain('mrr.docx');
    expect(first.appendix.name).toContain('appendix.docx');
    expect(first.evidence.name).toContain('evidence.json');

    resetMrrRunStoreForTests();

    for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
      const response = await DOWNLOAD(
        new NextRequest(
          `http://localhost/api/app/market-research/download?id=${created.job.id}&kind=${kind}`,
          { headers: authHeaders() },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('X-MRR-Run-Id')).toBe(created.job.id);
      expect(response.headers.get('X-MRR-Artifact-Sha256')).toBe(first[kind].sha);
    }

    const unknownRun = await DOWNLOAD(
      new NextRequest(
        'http://localhost/api/app/market-research/download?id=missing-run-id&kind=mrr',
        { headers: authHeaders() },
      ),
    );
    expect(unknownRun.status).toBe(404);

    const otherUser = await DOWNLOAD(
      new NextRequest(
        `http://localhost/api/app/market-research/download?id=${created.job.id}&kind=mrr`,
        { headers: authHeaders('intruder@example.mil') },
      ),
    );
    expect(otherUser.status).toBe(404);

    const traversal = await DOWNLOAD(
      new NextRequest(
        'http://localhost/api/app/market-research/download?id=..%2F..%2Fetc%2Fpasswd&kind=mrr',
        { headers: authHeaders() },
      ),
    );
    expect(traversal.status).toBe(404);

    const reused = await POST(
      new NextRequest('http://localhost/api/app/market-research', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(VALID_BODY),
      }),
    );
    expect(reused.status).toBe(200);
    const reusedBody = await reused.json();
    expect(reusedBody.deduplicated).toBe(true);
    expect(reusedBody.job.id).toBe(created.job.id);

    expect(mcpSpy).not.toHaveBeenCalled();
    expect(bqSpy).not.toHaveBeenCalled();
    mcpSpy.mockRestore();
    bqSpy.mockRestore();
  });
});

describe('reassembled completed run survives process restart', () => {
  const RUN_ID = 'genericVA01';
  const VA_BODY = {
    title: 'Janitorial Services for VA Medical Center',
    agency: 'Department of Veterans Affairs',
    keyword: 'janitorial',
    description: 'The Department of Veterans Affairs is conducting market research on janitorial services.',
    naics: '561720',
    psc: 'S201',
    office: 'Network Contracting Office 8',
    sub_agency: 'Veterans Health Administration',
    solicitation_number: 'VA-NCO8-JANITORIAL-2026',
    public_data_only_confirmed: true,
  };
  let storeDir = '';

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'mrr-reassemble-status-'));
    setMrrWorkspaceStoreRootForTests(storeDir);
  });

  afterEach(() => {
    resetMrrRunStoreForTests();
    rmSync(storeDir, { recursive: true, force: true });
  });

  it('returns review and downloads after restamp, restart, and owner-only access', async () => {
    const mcpSpy = vi.spyOn(mcpRegistry, 'runMcpTool');
    const bqSpy = vi.spyOn(bqClient, 'bqQuery');
    const ev = evidence('fixture public source', { naics: '561720' });
    const normalized = normalizeRequirement(VA_BODY);
    const HASH = normalizedIntakeHash(normalized.normalized);
    const dir = join(storeDir, RUN_ID);
    mkdirSync(dir, { recursive: true });
    const names = {
      mrr: `MRR-VA-NCO8-JANITORIAL-2026-${RUN_ID}.docx`,
      appendix: `MRR-VA-NCO8-JANITORIAL-2026-${RUN_ID}-appendix.docx`,
      evidence: `MRR-VA-NCO8-JANITORIAL-2026-${RUN_ID}-evidence.json`,
    };
    const bundle = {
      runId: RUN_ID,
      intakeHash: HASH,
      generatedAt: '2026-09-05T18:00:00.000Z',
      requirement: normalized.normalized,
      normalizationNotes: normalized.notes,
      cells: [
        { label: '§5 Primary NAICS', state: 'value', text: '561720', evidence: [ev] },
        { label: '§12 Rule of Two determination', state: 'value', text: 'undetermined', evidence: [ev] },
        { label: '§15 Pricing evidence', state: 'degraded', text: 'Degraded — fixture', reason: 'fixture', evidence: [ev] },
      ],
      suppliers: {
        rawUeiCount: value(20, ev),
        evaluatedUeiCount: value(10, ev),
        boundedSampleReturned: value(12, ev),
        capableActiveCount: value(10, ev),
        excludedBeforeFamilyResolution: value(2, ev),
        deduplicatedFamilyCount: unknown('fixture', [ev]),
        ambiguousParentCount: value(2, ev),
        eligiblePopulation: value(100, ev),
        families: [{ uei: 'VAUEI00001', familyKey: null, method: 'lookup_failed', confidence: 'unresolved', ruleOfTwoEligible: false, memberUeis: [] }],
      },
      ruleOfTwo: {
        determination: value('undetermined', ev),
        recommendation: value('Insufficient evidence to support a set-aside.', ev),
      },
      marketIntel: {
        pricingEvidence: { state: 'degraded', reason: 'fixture', evidence: [ev] },
        pricingIsIge: false,
      },
      limitations: ['§11: fixture', '§12: fixture', '§15: fixture'],
    };
    writeFileSync(join(dir, names.mrr), 'generic-mrr');
    writeFileSync(join(dir, names.appendix), 'generic-appendix');
    writeFileSync(join(dir, names.evidence), `${JSON.stringify(bundle, null, 2)}\n`);
    const sha = (fileName: string) =>
      createHash('sha256').update(readFileSync(join(dir, fileName))).digest('hex');
    const hashes = {
      mrr: sha(names.mrr),
      appendix: sha(names.appendix),
      evidence: sha(names.evidence),
    };
    writeFileSync(
      join(dir, 'job.json'),
      `${JSON.stringify({
        version: 1,
        id: RUN_ID,
        ownerEmail: 'ko@example.mil',
        intakeHash: HASH,
        input: { title: VA_BODY.title },
        status: 'done',
        progress: 'complete',
        progressHistory: [{ stage: 'complete', at: bundle.generatedAt }],
        artifacts: {
          mrr: { path: join(dir, names.mrr), fileName: names.mrr, sha256: hashes.mrr },
          appendix: { path: join(dir, names.appendix), fileName: names.appendix, sha256: hashes.appendix },
          evidence: { path: join(dir, names.evidence), fileName: names.evidence, sha256: hashes.evidence },
        },
        review: null,
        error: null,
        createdAt: bundle.generatedAt,
        updatedAt: bundle.generatedAt,
      }, null, 2)}\n`,
    );

    persistCompletedMrrJobFromEvidence({ runId: RUN_ID, ownerEmail: 'ko@example.mil' });
    resetMrrRunStoreForTests();

    const statusBefore = statSync(join(dir, 'job.json'));
    const status = await GET(
      new NextRequest(`http://localhost/api/app/market-research?id=${RUN_ID}`, {
        headers: authHeaders(),
      }),
    );
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody.job.status).toBe('done');
    expect(statusBody.job.review).toBeTruthy();
    expect(statusBody.job.review.runId).toBe(RUN_ID);
    expect(statusBody.job.review.downloads.map((item: { kind: string }) => item.kind)).toEqual([
      'mrr',
      'appendix',
      'evidence',
    ]);
    expect(statSync(join(dir, 'job.json')).mtimeMs).toBe(statusBefore.mtimeMs);
    expect(sha(names.mrr)).toBe(hashes.mrr);
    expect(sha(names.appendix)).toBe(hashes.appendix);
    expect(sha(names.evidence)).toBe(hashes.evidence);

    for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
      const response = await DOWNLOAD(
        new NextRequest(
          `http://localhost/api/app/market-research/download?id=${RUN_ID}&kind=${kind}`,
          { headers: authHeaders() },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('X-MRR-Run-Id')).toBe(RUN_ID);
      if (kind === 'evidence') expect(response.headers.get('Content-Type')).toContain('application/json');
      else expect(response.headers.get('Content-Type')).toContain('wordprocessingml');
    }

    expect(
      (
        await GET(
          new NextRequest(`http://localhost/api/app/market-research?id=${RUN_ID}`, {
            headers: authHeaders('intruder@example.mil'),
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await GET(
          new NextRequest('http://localhost/api/app/market-research?id=missing-run', {
            headers: authHeaders(),
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await DOWNLOAD(
          new NextRequest(
            'http://localhost/api/app/market-research/download?id=..%2F..%2Fetc%2Fpasswd&kind=mrr',
            { headers: authHeaders() },
          ),
        )
      ).status,
    ).toBe(404);

    const reused = await POST(
      new NextRequest('http://localhost/api/app/market-research', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(VA_BODY),
      }),
    );
    expect(reused.status).toBe(200);
    const reusedBody = await reused.json();
    expect(reusedBody.deduplicated).toBe(true);
    expect(reusedBody.job.id).toBe(RUN_ID);
    expect(mcpSpy).not.toHaveBeenCalled();
    expect(bqSpy).not.toHaveBeenCalled();
    mcpSpy.mockRestore();
    bqSpy.mockRestore();
  });
});
