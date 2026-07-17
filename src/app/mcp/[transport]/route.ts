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
 * Route path: this file lives at src/app/mcp/[transport]/route.ts, and a host
 * rewrite in next.config.ts maps mcp.getmindy.ai/{mcp,sse,message} onto it. The
 * canonical endpoint is https://mcp.getmindy.ai/mcp.
 *
 * The adapter is configured with EXPLICIT endpoints ('/mcp', '/sse', '/message')
 * rather than basePath — see the config block below. Short version: mcp-handler
 * compares url.pathname by strict equality, a Next rewrite does NOT rewrite
 * request.url, so basePath '/mcp' expected '/mcp/mcp' and 404'd every
 * authenticated call to the canonical subdomain. There is no /mcp/mcp any more.
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

// (prettifyToolName removed 2026-07-17 — titles now come curated from TOOL_META in
// tool-schemas.ts. A mechanical underscore split can't produce "Get Pricing Intel
// (GSA CALC)", and leaving it here would imply titles are still generated.)

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
          // Curated title from TOOL_META, not prettifyToolName's mechanical
          // underscore split — "Get Pricing Intel (GSA CALC)" beats "Get Pricing Intel".
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          // Per-tool annotations (see tool-schemas.ts). NOT a blanket read-only:
          // add_contacts_to_crm writes to the user's CRM and must declare
          // destructiveHint so Claude prompts before running it.
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
  // Adapter config.
  //
  // EXPLICIT ENDPOINTS, NOT basePath — and this is load-bearing. mcp-handler
  // matches the request path by STRICT EQUALITY against these:
  //
  //     if (url.pathname === streamableHttpEndpoint) { … }
  //     else { res.statusCode = 404; res.end("Not found"); }
  //
  // and `basePath: '/mcp'` derived them as '/mcp/mcp' | '/mcp/sse' | '/mcp/message'
  // (deriveEndpointsFromBasePath). That matched the APEX (getmindy.ai/mcp/mcp) —
  // and silently 404'd the canonical subdomain.
  //
  // Why: next.config.ts rewrites mcp.getmindy.ai/mcp → /mcp/mcp, but a Next rewrite
  // does NOT rewrite `request.url`. The handler still saw pathname '/mcp', compared
  // it to '/mcp/mcp', and fell through to the 404. So mcp.getmindy.ai/mcp NEVER
  // worked for authenticated traffic — every token in the DB was minted against the
  // apex, which is why nobody hit it until the canonical URL moved (2026-07-17).
  //
  // It was invisible to probing: withMcpAuth returns 401 BEFORE this handler runs,
  // so an unauthenticated curl gets a healthy-looking 401 and never reaches the
  // path match. Unauth 401 / auth 404 was the tell:
  //     07:36:57  POST 200  /oauth/token   ← auth worked
  //     07:36:58  POST 404  /mcp           ← then this
  //
  // These values match the pathname AS THE CLIENT SENDS IT on mcp.getmindy.ai.
  // Changing them means changing the rewrites in next.config.ts too.
  {
    streamableHttpEndpoint: '/mcp',
    sseEndpoint: '/sse',
    sseMessageEndpoint: '/message',
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
