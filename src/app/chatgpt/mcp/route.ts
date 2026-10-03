/**
 * Mindy MCP — ChatGPT profile endpoint: https://mcp.getmindy.ai/chatgpt/mcp
 *
 * Phase 1 of the ChatGPT plugin "Path A" (tasks/chatgpt-plugin-path-a.md). A SECOND
 * MCP handler beside the full one (src/app/mcp/[transport]/route.ts), which is left
 * untouched. Same origin, same authorization server, different resource + audience.
 *
 * What differs from the Claude/general endpoint — and nothing else does:
 *   · TOOLS: exactly the 15-tool allowlist in src/lib/mcp/chatgpt-profile.ts, with
 *     ChatGPT-specific titles/descriptions/annotations. Input schemas are the registry's,
 *     unchanged. Any other tool name is unknown here and is never dispatched or billed.
 *   · AUTH: OAuth access tokens minted for the ChatGPT resource ONLY. Full-endpoint tokens
 *     and mcp_live_ API keys are rejected (one audience per handler).
 *   · COMMERCE: none. No credit footer, no `_meta.credits`, no purchase links, no
 *     continue_url, no saved purchase retry (metered.ts skips recordPaywallAttempt for
 *     channel 'chatgpt'), neutral refusals (chatgpt-refusals.ts).
 *   · ACQUISITION: no signup-credit grant here (and none at token exchange for this
 *     audience — see src/app/oauth/token/route.ts).
 *   · AUTO-RECHARGE: never triggered in-request from this path. (The hourly
 *     /api/cron/mcp-autorecharge backstop is balance-based and channel-blind — see the
 *     open item in tasks/chatgpt-plugin-path-a.md.)
 *
 * What is the SAME, on purpose: billing. Every call goes through runMeteredTool — the
 * billing seam — so an existing balance is pre-checked and debited exactly as on Claude.
 *
 * Routing: this file IS /chatgpt/mcp on every host (no rewrite), so request.url's
 * pathname is '/chatgpt/mcp' on mcp.getmindy.ai, the apex and previews alike — which is
 * what mcp-handler's strict endpoint match needs. SSE is disabled (Streamable HTTP only).
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { runMeteredTool } from '@/lib/mcp/metered';
import { creditsFor } from '@/lib/mcp/tool-registry';
import { verifyAccessToken } from '@/lib/mcp/oauth/tokens';
import {
  OAUTH_RESOURCE_CHATGPT,
  CHATGPT_RESOURCE_METADATA_PATH,
} from '@/lib/mcp/oauth/resources';
import {
  chatgptRegistrationList,
  chatgptToolResultFromMeteredError,
  projectChatgptResult,
  CHATGPT_SERVER_INFO,
  CHATGPT_SERVER_INSTRUCTIONS,
} from '@/lib/mcp/chatgpt-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const baseHandler = createMcpHandler(
  (server) => {
    for (const tool of chatgptRegistrationList()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args: Record<string, unknown>, extra) => {
          const identity = extra?.authInfo?.extra as { userEmail?: string } | undefined;
          if (!identity?.userEmail) {
            return { isError: true, content: [{ type: 'text', text: 'unauthorized: no verified identity' }] };
          }

          // NO grantSignupCreditsIfFirst here (owner decision 3). A ChatGPT call may spend
          // an existing balance; it never creates one.
          const outcome = await runMeteredTool(
            tool.name,
            (args ?? {}) as Record<string, unknown>,
            { userEmail: identity.userEmail, apiKeyId: null, channel: 'chatgpt' },
          );
          if (!outcome.ok) {
            return chatgptToolResultFromMeteredError(tool.name, outcome.error, {
              requiredCredits: creditsFor(tool.name),
              availableCredits: outcome.balance ?? null,
            });
          }

          // One projection, applied identically to the text block and structuredContent.
          // No footer, no `_meta.credits`, and — deliberately — no maybeAutoRecharge():
          // outcome.needsRecharge is ignored on this path (owner decision 4).
          const projected = projectChatgptResult(tool.name, outcome.result);
          return {
            content: [{ type: 'text', text: JSON.stringify(projected, null, 2) }],
            structuredContent: projected,
          };
        },
      );
    }
  },
  {
    // See the full route for why serverInfo is cast (mcp-handler's stale type).
    serverInfo: CHATGPT_SERVER_INFO as Implementation as { name: string; version: string },
    instructions: CHATGPT_SERVER_INSTRUCTIONS,
    capabilities: { tools: {} },
  },
  {
    // Strict pathname match (see the full route's adapter-config note). This file is
    // served at exactly /chatgpt/mcp, so no rewrite and no path remapping is involved.
    streamableHttpEndpoint: '/chatgpt/mcp',
    sseEndpoint: '/chatgpt/sse',
    sseMessageEndpoint: '/chatgpt/message',
    disableSse: true,
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
);

/** The resource origin, for the 401's resource_metadata URL (always the MCP origin). */
function resourceOrigin(): string {
  try {
    return new URL(OAUTH_RESOURCE_CHATGPT).origin;
  } catch {
    return 'https://mcp.getmindy.ai';
  }
}

/**
 * Bearer gate — ChatGPT-audience OAuth access tokens ONLY. A token minted for the full
 * endpoint fails verifyAccessToken here (wrong aud), and API keys are not accepted on
 * this surface. Undefined → 401 with a WWW-Authenticate challenge whose
 * resource_metadata points at the ChatGPT resource's RFC 9728 document.
 */
const handler = withMcpAuth(
  baseHandler,
  async (_req, bearerToken) => {
    const claims = verifyAccessToken(bearerToken, OAUTH_RESOURCE_CHATGPT);
    if (!claims) return undefined;
    return {
      token: bearerToken as string,
      scopes: claims.scope ? claims.scope.split(' ') : ['mcp'],
      clientId: claims.client_id,
      extra: { userEmail: claims.sub },
    };
  },
  {
    required: true,
    // ALWAYS the ChatGPT document — never the full endpoint's — so a ChatGPT client can
    // only ever discover (and request a token for) the ChatGPT audience. When OAuth is
    // flagged off the document 404s, exactly like the full endpoint's.
    resourceUrl: resourceOrigin(),
    resourceMetadataPath: CHATGPT_RESOURCE_METADATA_PATH,
  },
);

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
