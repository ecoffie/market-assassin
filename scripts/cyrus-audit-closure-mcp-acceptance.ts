/**
 * Public MCP acceptance for Cyrus audit closure — run ONLY after an approved
 * production release that contains this branch's merge SHA.
 *
 * Mints a one-shot key, calls the three tools, saves responses, revokes the key.
 * Compare acceptance booleans to tasks/evidence/cyrus-audit-closure-2026-09-20/04-baseline-summary.json.
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

const MCP_URL = process.env.MCP_URL || 'https://mcp.getmindy.ai/mcp';
const ACTOR = 'cyrus-audit-closure-mcp@getmindy.ai';
const UEI = 'N1N9JPDYHVC7';
const COMPANY = 'Cyrus Management Solutions';
const OUT_DIR = join(process.cwd(), 'tasks/evidence/cyrus-audit-closure-mcp-acceptance');
const LOCAL_BASELINE = join(
  process.cwd(),
  'tasks/evidence/cyrus-audit-closure-2026-09-20/04-baseline-summary.json',
);

function parseToolJson(result: unknown): unknown {
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
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
    return { raw_text: text };
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  return parseToolJson(result);
}

function checks(profile: Record<string, unknown>, history: Record<string, unknown>) {
  const cov = (profile.coverage || {}) as Record<string, unknown>;
  const ingest = (cov.ingest || {}) as Record<string, unknown>;
  const h = (history.history || history) as Record<string, unknown>;
  const hCov = (h.coverage_timestamp || {}) as Record<string, unknown>;
  const hIngest = (hCov.ingest || {}) as Record<string, unknown>;
  const sa = (profile.historical_set_asides || {}) as Record<string, unknown>;
  const hSa = (h.historical_set_asides || {}) as Record<string, unknown>;
  return {
    F1_freshness_three_clocks:
      Boolean(cov.warehouse_max_action_date || hCov.warehouse_max_action_date) &&
      (ingest.freshness_status || hIngest.freshness_status) != null &&
      (ingest.freshness_status || hIngest.freshness_status) !== 'unknown',
    F2_set_aside_provenance:
      Boolean(sa.scope) && Boolean(hSa.scope) && Boolean(sa.contributing_ueis_by_label),
    F3_null_first_positive_note: Boolean(sa.null_first_positive_note),
    F4_last_fy_deprecated:
      (sa.deprecated as { last_fy_by_label?: { status?: string } } | undefined)
        ?.last_fy_by_label?.status === 'deprecated',
    no_award_origin_field: !Object.prototype.hasOwnProperty.call(sa, 'award_origin_fy_by_label'),
  };
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

    const profile = (await callTool(client, 'get_contractor_profile', {
      company_name: COMPANY,
    })) as Record<string, unknown>;
    const sam = await callTool(client, 'lookup_sam_entity', { uei: UEI });
    const history = (await callTool(client, 'get_contractor_award_history', {
      uei: UEI,
      award_limit: 20,
    })) as Record<string, unknown>;

    await client.close().catch(() => {});

    const acceptance = checks(profile, history);
    const runnerSha = (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      } catch {
        return 'unknown-local';
      }
    })();

    const summary = {
      environment: 'authenticated_public_mcp',
      mcpUrl: MCP_URL,
      startedAt,
      finishedAt: new Date().toISOString(),
      runnerSha,
      note: 'Record the ACTUAL Vercel serving SHA separately via vercel inspect; runner SHA is local checkout only.',
      acceptance,
      localBaselineAcceptance:
        (localBaseline as { acceptance?: unknown } | null)?.acceptance ?? null,
      compare:
        'PASS only if acceptance matches local baseline booleans AND serving deploy contains the merge SHA.',
    };

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
  console.error(e);
  process.exit(1);
});
