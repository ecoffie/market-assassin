/**
 * Copy for /mcp/setup that answers "does it work with my AI?" (asked repeatedly at Mindy Day).
 *
 * Clients named here are only ones Mindy's own pages already list (src/app/mcp/about/page.tsx,
 * src/app/mcp/mcp-console.tsx). No vendor menu paths: we cannot source them, and they change.
 */
export const SETUP_MCP_URL = 'https://mcp.getmindy.ai/mcp';

export const ANY_ASSISTANT_LINE =
  'Mindy works with any AI assistant that can add a remote MCP connector by its URL. This guide shows Claude and ChatGPT step by step; Copilot, Cursor and others follow the same pattern.';

export const OTHER_ASSISTANTS = {
  heading: 'Other assistants (Copilot, Cursor and others)',
  intro: 'If your assistant lets you add a custom or remote MCP connector (sometimes called an MCP server), Mindy works there too.',
  steps: [
    'Find the place in your assistant’s settings to add a custom or remote MCP connector.',
    `Paste the address ${SETUP_MCP_URL}. If it asks for an authentication type, choose OAuth.`,
    'Connect, then sign in to Mindy in the window that opens and allow the connection.',
  ],
  adminNote:
    'Using Copilot or another assistant through a company Microsoft 365 account? Your IT admin may control which connectors you can add. If you cannot find the option, ask your IT admin to add Mindy with the address above.',
} as const;

export const CLAUDE_COMPUTER_NOTE =
  'Add the connector on a computer, at claude.ai in a browser or in the Claude desktop app. You cannot add it from the phone app.';
