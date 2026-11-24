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

/**
 * "Which AI do you use?" chooser at the top of /mcp/setup. A rep demoed in Claude to a
 * Copilot user who could not follow along: the page showed every assistant's steps in one
 * long scroll. Each option jumps to its section and, through AI_CHOOSER_CSS, shows only that
 * section. Labels and hints reuse copy already on this page; no new claims.
 */
export const AI_CHOOSER = {
  id: 'which-ai',
  heading: 'Which AI do you use?',
  options: [
    { id: 'claude', tag: 'Easiest — start here', label: 'Claude', hint: 'Built in. Connect, sign in, allow, done.' },
    { id: 'chatgpt', tag: 'Also works', label: 'ChatGPT', hint: 'More steps: Developer mode, add Mindy, sign in, permissions.' },
    { id: 'other', tag: 'Same pattern', label: 'Copilot, Cursor or other', hint: 'Any assistant that can add a remote MCP connector by its URL.' },
  ],
  showAll: 'Show steps for every assistant',
} as const;

/** Wrapper class around the per-assistant sections (each carries data-ai). */
export const AI_SECTIONS_CLASS = 'setup-ai-sections';

/**
 * Pure CSS, no JavaScript: once the URL targets one assistant section (#claude, #chatgpt,
 * #other), the other assistant sections are hidden. With no target, or a target outside the
 * wrapper (#which-ai, #ask), every section stays visible, so a browser without JS or without
 * :has() support simply shows the whole guide.
 */
export const AI_CHOOSER_CSS =
  `.${AI_SECTIONS_CLASS}:has(> section[data-ai]:target) > section[data-ai]:not(:target){display:none}`;
