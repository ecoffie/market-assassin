/**
 * Public MCP acceptance for Cyrus profile/set-aside release (#1589 / 56b254df).
 * Mints a one-shot key, calls profile + history, saves responses, revokes the key.
 *
 *   npx tsx -r dotenv/config scripts/cyrus-1589-mcp-acceptance.ts
 *   (DOTENV_CONFIG_PATH=.env.local)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { issueApiKey, revokeApiKey } from '../src/lib/mcp/api-keys';
import { grantSignupCreditsIfFirst, getBalance, grantCredits } from '../src/lib/mcp/credits';

const MCP_URL = process.env.MCP_URL || 'https://mcp.getmindy.ai/mcp';
const ACTOR = 'cyrus-1589-acceptance@getmindy.ai';
const OUT_DIR = join(
  process.cwd(),
  'tasks',
  'evidence',
  'cyrus-1589-mcp-acceptance-2026-09-20',
);
const FEATURE_SHA = '56b254df8f2f8a40f257181a5c38ea8ecb69df96';

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

function setAsideHonesty(sa: Record<string, unknown> | null | undefined) {
  if (!sa || typeof sa !== 'object') {
    return { ok: false, reason: 'missing historical_set_asides' };
  }
  const hasOriginField = Object.prototype.hasOwnProperty.call(sa, 'award_origin_fy_by_label');
  const hasFirstPos = Object.prototype.hasOwnProperty.call(
    sa,
    'first_observed_positive_action_fy_by_label',
  );
  const hasLastAct = Object.prototype.hasOwnProperty.call(
    sa,
    'last_observed_action_fy_by_label',
  );
  const note = String(sa.note || '');
  const deniesOrigin =
    /Award origin is not established|Award origin is unknown|not award origin/i.test(note);
  const deniesCert =
    /not.*certification|does not establish graduation|Neither field is current SAM/i.test(note) ||
    /None of these fields is current SAM certification/i.test(note);
  const ok =
    !hasOriginField &&
    hasFirstPos &&
    hasLastAct &&
    deniesOrigin &&
    deniesCert;
  return {
    ok,
    has_award_origin_fy_by_label: hasOriginField,
    has_first_observed_positive_action_fy_by_label: hasFirstPos,
    has_last_observed_action_fy_by_label: hasLastAct,
    denies_award_origin: deniesOrigin,
    denies_certification_claim: deniesCert,
    coverage: sa.coverage ?? null,
    labels: sa.labels ?? null,
    last_observed_action_fy_by_label: sa.last_observed_action_fy_by_label ?? null,
    first_observed_positive_action_fy_by_label:
      sa.first_observed_positive_action_fy_by_label ?? null,
    note_excerpt: note.slice(0, 280),
  };
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.SUPABASE_URL) {
    throw new Error('Supabase env missing — run with dotenv .env.local');
  }

  mkdirSync(OUT_DIR, { recursive: true });

  let mergedSha = '';
  try {
    mergedSha = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
  } catch {
    mergedSha = 'unknown';
  }

  const { key, row } = await issueApiKey(ACTOR, {
    label: 'cyrus-#1589-acceptance-one-shot',
    scopes: [],
  });
  console.error(`issued key id=${row.id} prefix=${row.key_prefix}`);

  try {
    await grantSignupCreditsIfFirst(ACTOR);
    const bal = await getBalance(ACTOR);
    if ((bal ?? 0) < 50) {
      await grantCredits(ACTOR, 100, 'admin_grant');
    }

    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    });
    const client = new Client({ name: 'cyrus-1589-mcp-acceptance', version: '1.0.0' });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = (tools.tools || []).map((t) => t.name).sort();
    writeFileSync(
      join(OUT_DIR, '00-tool-list.json'),
      JSON.stringify({ mcp_url: MCP_URL, names, tool_count: names.length }, null, 2),
    );

    const profile = await callTool(client, 'get_contractor_profile', {
      company_name: 'Cyrus Management Solutions',
    });
    writeFileSync(join(OUT_DIR, '01-get_contractor_profile.json'), JSON.stringify(profile, null, 2));

    const history = await callTool(client, 'get_contractor_award_history', {
      uei: 'N1N9JPDYHVC7',
      award_limit: 20,
    });
    writeFileSync(
      join(OUT_DIR, '02-get_contractor_award_history.json'),
      JSON.stringify(history, null, 2),
    );

    await client.close().catch(() => {});

    const p = profile as {
      found?: boolean;
      enrichment_status?: string;
      recent_awards?: unknown[];
      company?: { award_count?: number; uei?: string };
      counting_bases?: Record<string, unknown>;
      historical_set_asides?: Record<string, unknown>;
    };
    const h = history as {
      history?: {
        recentAwards?: unknown[];
        enrichment_status?: string;
        counting_bases?: Record<string, unknown>;
        historical_set_asides?: Record<string, unknown>;
        summary?: { awardCount?: number };
      };
    };

    const profileRecentLen = Array.isArray(p.recent_awards) ? p.recent_awards.length : 0;
    const historyRecentLen = Array.isArray(h.history?.recentAwards)
      ? h.history!.recentAwards!.length
      : 0;
    const profileSa = setAsideHonesty(p.historical_set_asides);
    const historySa = setAsideHonesty(h.history?.historical_set_asides);

    const checks = {
      profile_found: p.found === true,
      profile_recent_awards_nonempty: profileRecentLen > 0,
      profile_enrichment_complete_or_honest:
        p.enrichment_status === 'complete' || p.enrichment_status === 'budget_limited',
      profile_set_aside_action_labels: profileSa.ok,
      history_recent_awards_nonempty: historyRecentLen > 0,
      history_set_aside_action_labels: historySa.ok,
      counting_present: Boolean(p.counting_bases && h.history?.counting_bases),
      no_award_origin_field:
        profileSa.has_award_origin_fy_by_label === false &&
        historySa.has_award_origin_fy_by_label === false,
    };
    const allPass = Object.values(checks).every(Boolean);

    const summary = {
      at: new Date().toISOString(),
      mcp_url: MCP_URL,
      feature_sha: FEATURE_SHA,
      merged_sha: mergedSha,
      feature_is_ancestor_of_main: (() => {
        try {
          execSync(`git merge-base --is-ancestor ${FEATURE_SHA} origin/main`, {
            stdio: 'ignore',
          });
          return true;
        } catch {
          return false;
        }
      })(),
      checks,
      all_pass: allPass,
      profile: {
        uei: p.company?.uei ?? null,
        award_count: p.company?.award_count ?? null,
        enrichment_status: p.enrichment_status ?? null,
        recent_len: profileRecentLen,
        counting_bases: p.counting_bases ?? null,
        set_aside: profileSa,
      },
      history: {
        enrichment_status: h.history?.enrichment_status ?? null,
        recent_len: historyRecentLen,
        award_count: h.history?.summary?.awardCount ?? null,
        counting_bases: h.history?.counting_bases ?? null,
        set_aside: historySa,
      },
    };
    writeFileSync(join(OUT_DIR, '03-acceptance-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!allPass) process.exit(2);
  } finally {
    await revokeApiKey(ACTOR, row.id).catch((e) =>
      console.error('revoke failed', e instanceof Error ? e.message : e),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
