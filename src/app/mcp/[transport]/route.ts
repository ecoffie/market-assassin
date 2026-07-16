/**
 * Mindy MCP server — hosted HTTP edge (mcp.getmindy.ai).
 *
 * Slice 2 of the PRD (tasks/PRD-mindy-mcp-server.md §Slices): the same
 * `get_winning_playbook` tool the Phase-0 stdio server exposes, now reachable
 * over HTTP by ANY remote MCP client (Claude Desktop remote, Cursor, a
 * customer's own agent) at https://mcp.getmindy.ai/mcp.
 *
 * Transport: Streamable HTTP + legacy SSE, via Vercel's `mcp-handler` (wraps
 * @modelcontextprotocol/sdk for the Next.js App Router). The tool LOGIC is
 * imported unchanged from src/mcp/tools/* — this file is only transport + auth.
 *
 * Auth: every call must present `Authorization: Bearer mcp_live_...`. The key is
 * verified against the mcp_api_keys table (Slice 1, src/lib/mcp/api-keys.ts).
 * The resolved identity (userEmail, scopes, keyId) is attached to the request
 * and read inside the tool via `extra.authInfo.extra`.
 *
 * Metering (Slice 3): tool execution is delegated to runMeteredTool, which
 * pre-checks the credit balance, debits on success, and logs every call. Stripe
 * credit top-ups are Slice 4.
 *
 * Route path: this file lives at src/app/mcp/[transport]/route.ts with
 * basePath '/mcp', so the raw endpoints are /mcp/mcp (Streamable HTTP) and
 * /mcp/sse + /mcp/message (SSE). A host rewrite in next.config.ts maps the
 * mcp.getmindy.ai subdomain so clients use the clean https://mcp.getmindy.ai/mcp.
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { after } from 'next/server';
import { runMeteredTool } from '@/lib/mcp/metered';
import { maybeAutoRecharge } from '@/lib/mcp/autorecharge';
import { mcpRegistrationList } from '@/lib/mcp/tool-schemas';
import { verifyApiKey } from '@/lib/mcp/api-keys';
import { verifyAccessToken } from '@/lib/mcp/oauth/tokens';
import { mcpFlags } from '@/lib/mcp/flags';

// Node.js runtime: verifyApiKey uses node:crypto + the Supabase service-role
// client (neither runs on Edge). force-dynamic: never cache an MCP response.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Raise toward 800 once Vercel Fluid Compute is enabled, for long SSE sessions.
export const maxDuration = 60;

// Below this balance, the in-chat footer escalates from an FYI to a top-up nudge.
const LOW_BALANCE_THRESHOLD = 20;

/** snake_case tool name → "Title Case" for Claude Desktop's permission list. */
function prettifyToolName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * The "credits remaining" line shown IN THE CHAT after a tool call (Higgsfield-style).
 * Returns null for free tools (charged 0, no balance) so we don't add noise to
 * get_balance et al. Escalates to a top-up nudge when the balance runs low.
 */
function creditFooter(charged: number, balance: number | null): string | null {
  if (balance === null) return null; // free tool — nothing to meter
  const used = charged > 0 ? ` · this call used ${charged} credit${charged === 1 ? '' : 's'}` : '';
  if (balance <= 0) {
    return `⚠️ Mindy credits: 0 left${used}. Top up to keep going → getmindy.ai/mcp`;
  }
  if (balance <= LOW_BALANCE_THRESHOLD) {
    return `⚠️ Mindy credits: ${balance} left${used} — running low. Top up → getmindy.ai/mcp`;
  }
  return `Mindy credits: ${balance} remaining${used}.`;
}

const baseHandler = createMcpHandler(
  (server) => {
    // Register EVERY registry tool (not just the playbook) from the single source
    // of truth — mcpRegistrationList() derives name + description + input schema
    // from listMcpTools(), so the endpoint's tools always match runMcpTool + the
    // /mcp pricing table. Each dispatches through runMeteredTool (debit on success).
    for (const tool of mcpRegistrationList()) {
      server.registerTool(
        tool.name,
        {
          title: prettifyToolName(tool.name),
          description: tool.description,
          inputSchema: tool.inputSchema,
          // annotations → Claude Desktop groups these under "Read-only tools —
          // Always allow" instead of one flat "Other tools" pile (see tool-schemas.ts).
          annotations: tool.annotations,
        },
        async (args: Record<string, unknown>, extra) => {
          // Identity resolved by withMcpAuth (below). Present because required:true.
          const identity = extra?.authInfo?.extra as
            | { userEmail?: string; keyId?: string }
            | undefined;
          if (!identity?.userEmail) {
            // Should be unreachable (required:true), but never run a tool unattributed.
            return {
              isError: true,
              content: [{ type: 'text', text: 'unauthorized: no verified identity' }],
            };
          }

          // Metered dispatch: pre-checks the credit balance, runs the tool via the
          // registry, debits its price on success, logs the call. Rejects with
          // insufficient_credits before doing any work.
          const outcome = await runMeteredTool(
            tool.name,
            (args ?? {}) as Record<string, unknown>,
            { userEmail: identity.userEmail, apiKeyId: identity.keyId ?? null },
          );
          if (!outcome.ok) {
            return {
              isError: true,
              content: [{ type: 'text', text: `${outcome.error.code}: ${outcome.error.message}` }],
            };
          }
          // Balance-in-chat (like Higgsfield): surface the remaining balance right
          // in the conversation. `outcome.balance` is the post-debit balance
          // (null for free tools like get_balance). Kept as a SEPARATE text block
          // so the first block stays pure JSON for agents that parse it, and
          // mirrored into structuredContent._meta.credits for machine reads.
          const content: { type: 'text'; text: string }[] = [
            { type: 'text', text: JSON.stringify(outcome.result, null, 2) },
          ];
          const footer = creditFooter(outcome.creditsCharged, outcome.balance);
          if (footer) content.push({ type: 'text', text: footer });

          // Auto-recharge: the balance dipped low → try to refill AFTER the response is
          // sent (zero added latency to this call). maybeAutoRecharge no-ops unless the
          // user enabled it with a saved card; a cron backstop retries any misses.
          if (outcome.needsRecharge) {
            after(() => maybeAutoRecharge(identity.userEmail!).catch((e) => console.error('[mcp:autorecharge] after() error', e)));
          }
          return {
            content,
            structuredContent: {
              ...outcome.result,
              _meta: {
                ...((outcome.result as { _meta?: Record<string, unknown> })._meta ?? {}),
                credits: { charged: outcome.creditsCharged, remaining: outcome.balance },
              },
            },
          };
        },
      );
    }
  },
  // serverOptions — registerTool() manages the tools capability automatically.
  {
    capabilities: {
      tools: {},
    },
  },
  // adapter config. basePath must match this route's parent dir.
  {
    basePath: '/mcp',
    maxDuration: 60,
    // Production: enable Vercel Fluid Compute, bump maxDuration toward 800, and set
    // redisUrl (Upstash) so SSE sessions coordinate across instances:
    // redisUrl: process.env.REDIS_URL,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
);

/**
 * Bearer-token gate — accepts TWO credentials, tried in order:
 *   1. an OAuth 2.1 access token (the keyless "Add connector → Sign in" flow) —
 *      a stateless JWT validated by signature + exp + audience, no DB read.
 *   2. an `mcp_live_` API key (the headless/CI fallback), verified against
 *      mcp_api_keys.
 * Returning undefined makes withMcpAuth answer 401 with a WWW-Authenticate
 * challenge whose resource_metadata points clients at the OAuth flow.
 */
const handler = withMcpAuth(
  baseHandler,
  async (_req, bearerToken) => {
    // 1) OAuth access token (keyless).
    const claims = verifyAccessToken(bearerToken);
    if (claims) {
      return {
        token: bearerToken as string,
        scopes: claims.scope ? claims.scope.split(' ') : ['mcp'],
        clientId: claims.client_id,
        extra: { userEmail: claims.sub, keyId: null },
      };
    }
    // 2) API key fallback (headless).
    const verified = await verifyApiKey(bearerToken);
    if (!verified) return undefined;
    return {
      token: bearerToken as string,
      scopes: verified.scopes,
      clientId: verified.userEmail,
      extra: { userEmail: verified.userEmail, keyId: verified.keyId },
    };
  },
  {
    required: true,
    // Advertise the OAuth flow on 401 only when the flag is on — otherwise the
    // 401 stays key-only, so existing key clients are unaffected until we go live.
    ...(mcpFlags.oauth ? { resourceMetadataPath: '/.well-known/oauth-protected-resource' } : {}),
  },
);

export { handler as GET, handler as POST, handler as DELETE };
