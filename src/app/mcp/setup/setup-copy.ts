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

/** One piece of a setup step's copy: plain text, a *bold* UI target, or a [label](href) link. */
export type StepBodyPart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

/**
 * Split step copy into parts. `*Settings*` → bold; `[getmindy.ai/pricing](/pricing)` → link.
 * A link exists so an address the copy tells people to visit is clickable, not just text.
 */
export function stepBodyParts(body: string): StepBodyPart[] {
  const parts: StepBodyPart[] = [];
  for (const piece of body.split(/(\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g)) {
    if (!piece) continue;
    const link = piece.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) parts.push({ kind: 'link', text: link[1], href: link[2] });
    else if (piece.length > 2 && piece.startsWith('*') && piece.endsWith('*')) parts.push({ kind: 'bold', text: piece.slice(1, -1) });
    else parts.push({ kind: 'text', text: piece });
  }
  return parts;
}
