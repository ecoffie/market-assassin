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
import { runMeteredTool } from '@/lib/mcp/metered';
import { mcpRegistrationList } from '@/lib/mcp/tool-schemas';
import { verifyApiKey } from '@/lib/mcp/api-keys';

// Node.js runtime: verifyApiKey uses node:crypto + the Supabase service-role
// client (neither runs on Edge). force-dynamic: never cache an MCP response.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Raise toward 800 once Vercel Fluid Compute is enabled, for long SSE sessions.
export const maxDuration = 60;

const baseHandler = createMcpHandler(
  (server) => {
    // Register EVERY registry tool (not just the playbook) from the single source
    // of truth — mcpRegistrationList() derives name + description + input schema
    // from listMcpTools(), so the endpoint's tools always match runMcpTool + the
    // /mcp pricing table. Each dispatches through runMeteredTool (debit on success).
    for (const tool of mcpRegistrationList()) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
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
          return {
            content: [{ type: 'text', text: JSON.stringify(outcome.result, null, 2) }],
            structuredContent: outcome.result,
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
 * Bearer-token gate. Resolves the presented key to a Mindy identity; returning
 * undefined makes withMcpAuth answer 401 with the WWW-Authenticate challenge.
 */
const handler = withMcpAuth(
  baseHandler,
  async (_req, bearerToken) => {
    const verified = await verifyApiKey(bearerToken);
    if (!verified) return undefined;
    return {
      token: bearerToken as string,
      // MCP scopes gate which tools a key may call (future: per-tier scopes).
      scopes: verified.scopes,
      clientId: verified.userEmail,
      // Carried through to the tool handler via extra.authInfo.extra.
      extra: { userEmail: verified.userEmail, keyId: verified.keyId },
    };
  },
  { required: true },
);

export { handler as GET, handler as POST, handler as DELETE };
