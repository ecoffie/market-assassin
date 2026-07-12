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
 * NOT YET WIRED (Slices 3–4): the prepaid credit debit. See the TODO in the
 * tool handler — for now the edge is auth-gated but does not charge credits.
 *
 * Route path: this file lives at src/app/mcp/[transport]/route.ts with
 * basePath '/mcp', so the raw endpoints are /mcp/mcp (Streamable HTTP) and
 * /mcp/sse + /mcp/message (SSE). A host rewrite in next.config.ts maps the
 * mcp.getmindy.ai subdomain so clients use the clean https://mcp.getmindy.ai/mcp.
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { getWinningPlaybook } from '@/mcp/tools/winning-playbook';
import { verifyApiKey } from '@/lib/mcp/api-keys';

// Node.js runtime: verifyApiKey uses node:crypto + the Supabase service-role
// client (neither runs on Edge). force-dynamic: never cache an MCP response.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Raise toward 800 once Vercel Fluid Compute is enabled, for long SSE sessions.
export const maxDuration = 60;

const baseHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'get_winning_playbook',
      {
        title: 'Get Winning Playbook',
        description:
          "Retrieve GovCon Giants' proprietary coaching on HOW TO WIN a specific federal " +
          'contracting scenario — pulled from 8 years of course, proposal-template, and ' +
          'podcast-guest content. This is teaching intelligence, NOT a public data lookup: ' +
          'it answers "how do I actually win this," which no free API (SAM, USASpending) ' +
          'contains. Optionally pass NAICS codes to also get a real contractor win story ' +
          'matched to that industry. Returns grounded=false when the corpus has no match — ' +
          'in that case tell the user there is no coaching content, do not invent advice.',
        inputSchema: {
          topic: z
            .string()
            .min(3)
            .describe(
              'The scenario in plain language, e.g. "win an 8(a) construction recompete at the VA" ' +
                'or "break into cybersecurity contracting as a first-time SDVOSB".',
            ),
          naics_codes: z
            .array(z.string())
            .optional()
            .describe('Optional NAICS codes (4-6 digits) to fetch a matching real win story.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(12)
            .optional()
            .describe('Max guidance passages to return (default 6).'),
        },
      },
      async ({ topic, naics_codes, limit }, extra) => {
        // Identity resolved by withMcpAuth (below). Present because required:true.
        const identity = extra?.authInfo?.extra as
          | { userEmail?: string; keyId?: string }
          | undefined;

        // ── MERGE POINT (Slice 3 metering, in flight on feat/mcp-phase1-slice3-credits) ──
        // This branch is based on main and calls the tool directly (auth-only,
        // unmetered). Once src/lib/mcp/metered.ts lands on main, swap the direct
        // call below for the metered dispatch — it debits credits on success,
        // logs the call, and rejects with insufficient_credits. Exact form:
        //
        //   import { runMeteredTool } from '@/lib/mcp/metered';
        //   const outcome = await runMeteredTool(
        //     'get_winning_playbook',
        //     { topic, naics_codes, limit },
        //     { userEmail: identity!.userEmail!, apiKeyId: identity!.keyId! },
        //   );
        //   if (!outcome.ok) {
        //     return { isError: true, content: [{ type: 'text',
        //       text: `${outcome.error.code}: ${outcome.error.message}` }] };
        //   }
        //   return { content: [{ type: 'text',
        //     text: JSON.stringify(outcome.result, null, 2) }],
        //     structuredContent: outcome.result };
        // ─────────────────────────────────────────────────────────────────────
        void identity;
        const result = await getWinningPlaybook({ topic, naics_codes, limit });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
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
