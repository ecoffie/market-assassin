/**
 * Mindy MCP server — Phase 0 spike (stdio transport).
 *
 * Exposes the GovCon Giants proprietary teaching corpus as an MCP tool so ANY
 * MCP-capable agent (Claude Desktop, Cursor, a customer's own tool) can call
 * `get_winning_playbook(topic)` and get grounded "how to win" guidance — the
 * un-copyable part of the moat (PRD: tasks/PRD-mindy-mcp-server.md §8, Phase 0).
 *
 * Transport: local stdio. Claude Desktop / Cursor spawn this process and speak
 * MCP over stdin/stdout. NO network port, NO auth in Phase 0 — it runs on the
 * operator's own machine against the operator's own env. Auth + credit ledger +
 * hosted HTTP transport are Phase 1+.
 *
 * Run: `npm run mcp:dev` (see scripts/mcp-dev.mjs) — that loads env then launches
 * this file via tsx. Do NOT `console.log` anything here: stdout is the MCP wire.
 * All diagnostics go to stderr (console.error).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getWinningPlaybook } from './tools/winning-playbook';

const server = new McpServer({
  name: 'mindy-govcon',
  version: '0.1.0',
});

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
  async ({ topic, naics_codes, limit }) => {
    const result = await getWinningPlaybook({ topic, naics_codes, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mindy-mcp] stdio server ready — get_winning_playbook registered');
}

main().catch((err) => {
  console.error('[mindy-mcp] fatal:', err);
  process.exit(1);
});
