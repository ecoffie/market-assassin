import PublicShell from '@/components/public-site/PublicShell';
import McpConsole from './mcp-console';

/**
 * getmindy.ai/mcp — the connect page, inside the public shell. The page itself is the client
 * component in mcp-console.tsx; it lives there so the shell wraps only this route and not its
 * sibling /mcp/account (the signed-in console keeps its own theme).
 */
export default function McpPage() {
  return (
    <PublicShell contentElement="div">
      <McpConsole />
    </PublicShell>
  );
}
