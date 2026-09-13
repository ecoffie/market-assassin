/**
 * MCP *connection* state is not Mindy *identity*.
 *
 * A signed-in Mindy user may still need to connect Claude or ChatGPT.
 * An API key or credit balance is never "signed in" and never "connected".
 *
 * Classification is conservative: only label Claude / ChatGPT when the
 * registered client_name (or id) clearly says so. Anything else stays
 * `unknown` — we show Connect CTAs and do not pretend they are connected.
 */

export type ConnectorKind = 'claude' | 'chatgpt' | 'unknown';

export function classifyConnector(clientName: string | null | undefined, clientId?: string | null): ConnectorKind {
  const s = `${clientName || ''} ${clientId || ''}`.toLowerCase();
  if (/claude|anthropic/.test(s)) return 'claude';
  if (/chatgpt|openai/.test(s)) return 'chatgpt';
  return 'unknown';
}

export interface ConnectionFlags {
  claude: 'connected' | 'unknown';
  chatgpt: 'connected' | 'unknown';
  hasNamedClient: boolean;
}

export function connectionFlagsFromClients(
  rows: Array<{ clientName?: string | null; clientId?: string | null }>,
): ConnectionFlags {
  let claude: ConnectionFlags['claude'] = 'unknown';
  let chatgpt: ConnectionFlags['chatgpt'] = 'unknown';
  let hasNamedClient = false;
  for (const row of rows) {
    const kind = classifyConnector(row.clientName, row.clientId);
    if (kind === 'claude') {
      claude = 'connected';
      hasNamedClient = true;
    } else if (kind === 'chatgpt') {
      chatgpt = 'connected';
      hasNamedClient = true;
    }
  }
  return { claude, chatgpt, hasNamedClient };
}
