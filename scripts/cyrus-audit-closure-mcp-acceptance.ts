/**
 * Public MCP acceptance for Cyrus audit closure — run ONLY after an approved
 * production release that contains this branch's merge SHA.
 *
 * Shares checkCyrusThreeToolAcceptance with the local baseline runner.
 * Exits non-zero on tool errors or failed assertions.
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/cyrus-audit-closure-mcp-acceptance.ts
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { issueApiKey, revokeApiKey } from '../src/lib/mcp/api-keys';
import { grantSignupCreditsIfFirst, getBalance, grantCredits } from '../src/lib/mcp/credits';
import {
  assertCyrusAcceptanceOrThrow,
  checkCyrusThreeToolAcceptance,
  CYRUS_COMPANY,
  CYRUS_UEI,
} from '../src/lib/contractor/cyrus-acceptance';

const MCP_URL = process.env.MCP_URL || 'https://mcp.getmindy.ai/mcp';
const ACTOR = 'cyrus-audit-closure-mcp@getmindy.ai';
const OUT_DIR = join(process.cwd(), 'tasks/evidence/cyrus-audit-closure-mcp-acceptance');
const LOCAL_BASELINE = join(
  process.cwd(),
  'tasks/evidence/cyrus-audit-closure-2026-09-20/04-baseline-summary.json',
);

function parseToolJson(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  if (r?.isError) {
    const text = (r?.content || []).map((c) => c.text || '').join('\n');
    throw new Error(`MCP tool isError: ${text.slice(0, 500)}`);
  }
  if (r?.structuredContent) return r.structuredContent;
  const text = (r?.content || []).map((c) => c.text || '').join('\n');
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`MCP tool returned non-JSON: ${text.slice(0, 300)}`);
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return parseToolJson(result);
  } catch (e) {
    throw new Error(`${name} failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  let localBaseline: unknown = null;
  try {
    localBaseline = JSON.parse(readFileSync(LOCAL_BASELINE, 'utf8'));
  } catch {
    localBaseline = { error: 'local baseline missing' };
  }

  const { key, row } = await issueApiKey(ACTOR, {
    label: 'cyrus-audit-closure-mcp-one-shot',
    scopes: [],
  });

  try {
    await grantSignupCreditsIfFirst(ACTOR);
    const bal = await getBalance(ACTOR);
    if ((bal ?? 0) < 50) {
      await grantCredits(ACTOR, 100, 'admin_grant');
    }

    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    });
    const client = new Client({ name: 'cyrus-audit-closure', version: '1.0.0' });
    await client.connect(transport);

    const profile = await callTool(client, 'get_contractor_profile', {
      company_name: CYRUS_COMPANY,
    });
    const sam = await callTool(client, 'lookup_sam_entity', { uei: CYRUS_UEI });
    const history = await callTool(client, 'get_contractor_award_history', {
      uei: CYRUS_UEI,
      award_limit: 20,
    });

    await client.close().catch(() => {});

    const acceptance = checkCyrusThreeToolAcceptance({
      profile,
      sam,
      history,
      expectedUei: CYRUS_UEI,
    });
    assertCyrusAcceptanceOrThrow(acceptance, 'public MCP cyrus acceptance');

    const runnerSha = (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return 'unknown-local';
      }
    })();

    const localFlags =
      (localBaseline as { acceptance?: { flags?: Record<string, boolean> } } | null)?.acceptance
        ?.flags ?? null;
    const flagDrift =
      localFlags == null
        ? null
        : Object.keys({ ...localFlags, ...acceptance.flags }).filter(
            (k) => Boolean(localFlags[k]) !== Boolean(acceptance.flags[k]),
          );

    const summary = {
      environment: 'authenticated_public_mcp',
      mcpUrl: MCP_URL,
      startedAt,
      finishedAt: new Date().toISOString(),
      runnerSha,
      checker: 'src/lib/contractor/cyrus-acceptance.ts',
      note: 'Record the ACTUAL Vercel serving SHA separately via vercel inspect; runner SHA is local checkout only.',
      acceptance: {
        ok: acceptance.ok,
        flags: acceptance.flags,
        assertion_count: acceptance.assertions.length,
        failures: acceptance.failures,
      },
      localBaselineOk:
        (localBaseline as { acceptance?: { ok?: boolean } } | null)?.acceptance?.ok ?? null,
      flag_drift_vs_local: flagDrift,
      compare:
        'PASS only if acceptance.ok, flag_drift empty, AND serving deploy contains the merge SHA.',
    };

    if (flagDrift && flagDrift.length > 0) {
      throw new Error(
        `public MCP flags drifted from local baseline: ${flagDrift.join(', ')}`,
      );
    }

    writeFileSync(join(OUT_DIR, '01-profile.json'), JSON.stringify(profile, null, 2));
    writeFileSync(join(OUT_DIR, '02-sam.json'), JSON.stringify(sam, null, 2));
    writeFileSync(join(OUT_DIR, '03-history.json'), JSON.stringify(history, null, 2));
    writeFileSync(join(OUT_DIR, '04-mcp-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await revokeApiKey(ACTOR, row.id).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
