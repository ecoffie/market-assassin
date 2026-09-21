/**
 * Local three-tool baseline for Cyrus audit closure.
 * Live BQ/SAM against local code — NOT authenticated public MCP.
 * Uses the shared checker; exits non-zero on any failed assertion or tool error.
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/cyrus-audit-closure-baseline.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { makeTier2Tools } from '../src/lib/chat/tier2-tools';
import { lookupSamEntity } from '../src/mcp/tools/sam-entity';
import { contractorAwardHistory } from '../src/mcp/tools/contractor-award-history';
import { clearAwardsWarehouseCoverageCache } from '../src/lib/awards-ingest/read-warehouse-coverage';
import {
  assertCyrusAcceptanceOrThrow,
  checkCyrusThreeToolAcceptance,
  CYRUS_COMPANY,
  CYRUS_UEI,
  normalizeHistoryPayload,
} from '../src/lib/contractor/cyrus-acceptance';

const OUT = join(process.cwd(), 'tasks/evidence/cyrus-audit-closure-2026-09-20');

function sha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  clearAwardsWarehouseCoverageCache();
  mkdirSync(OUT, { recursive: true });
  const startedAt = new Date().toISOString();
  const codeSha = sha();

  const tools = makeTier2Tools('cyrus-audit-closure@getmindy.ai');
  let profile: unknown;
  let sam: unknown;
  let historyRaw: unknown;

  try {
    profile = await tools.execute('get_contractor_profile', {
      company_name: CYRUS_COMPANY,
    });
  } catch (e) {
    throw new Error(`get_contractor_profile threw: ${e instanceof Error ? e.message : e}`);
  }
  if (profile && typeof profile === 'object' && (profile as { ok?: boolean }).ok === false) {
    throw new Error(
      `get_contractor_profile returned ok:false ${JSON.stringify((profile as { error?: unknown }).error)}`,
    );
  }

  try {
    sam = await lookupSamEntity({ uei: CYRUS_UEI });
  } catch (e) {
    throw new Error(`lookup_sam_entity threw: ${e instanceof Error ? e.message : e}`);
  }

  try {
    historyRaw = await contractorAwardHistory({
      uei: CYRUS_UEI,
      award_limit: 20,
      actor: 'cyrus-audit-closure@getmindy.ai',
    });
  } catch (e) {
    throw new Error(`get_contractor_award_history threw: ${e instanceof Error ? e.message : e}`);
  }

  const acceptance = checkCyrusThreeToolAcceptance({
    profile,
    sam,
    history: historyRaw,
    expectedUei: CYRUS_UEI,
  });
  assertCyrusAcceptanceOrThrow(acceptance, 'local cyrus baseline');

  const histPayload = normalizeHistoryPayload(historyRaw);
  const packet = {
    environment: 'local_code_against_live_data',
    not: 'authenticated_public_mcp',
    startedAt,
    finishedAt: new Date().toISOString(),
    codeSha,
    checker: 'src/lib/contractor/cyrus-acceptance.ts',
    inputs: {
      get_contractor_profile: { company_name: CYRUS_COMPANY },
      lookup_sam_entity: { uei: CYRUS_UEI },
      get_contractor_award_history: { uei: CYRUS_UEI, award_limit: 20 },
    },
    acceptance: {
      ok: acceptance.ok,
      flags: acceptance.flags,
      assertion_count: acceptance.assertions.length,
      failures: acceptance.failures,
    },
    identity: {
      profile_uei: (profile as { company?: { uei?: string } })?.company?.uei ?? null,
      sam_uei: (sam as { entity?: { ueiSAM?: string } })?.entity?.ueiSAM ?? null,
      history_match: (histPayload as { match?: unknown }).match ?? null,
    },
    raw_paths: {
      profile: '01-profile.json',
      sam: '02-sam.json',
      history: '03-history.json',
    },
  };

  writeFileSync(join(OUT, '01-profile.json'), JSON.stringify(profile, null, 2));
  writeFileSync(join(OUT, '02-sam.json'), JSON.stringify(sam, null, 2));
  writeFileSync(join(OUT, '03-history.json'), JSON.stringify(historyRaw, null, 2));
  writeFileSync(join(OUT, '04-baseline-summary.json'), JSON.stringify(packet, null, 2));
  console.log(
    JSON.stringify(
      {
        codeSha,
        startedAt,
        ok: acceptance.ok,
        assertion_count: acceptance.assertions.length,
        flags: acceptance.flags,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
