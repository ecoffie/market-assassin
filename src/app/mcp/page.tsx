import { getMindySessionFromCookies } from '@/lib/mindy/mi-auth-cookie';
import McpConnectClient from './McpConnectClient';

export const dynamic = 'force-dynamic';

/**
 * Server entry for /mcp. Identity is read from the first-party `mi_auth`
 * cookie so a signed-in Maps/Mindy session paints signed-in chrome on the
 * first HTML response — no localStorage, no "Checking your session…".
 */
export default async function McpPage() {
  const session = await getMindySessionFromCookies();
  return <McpConnectClient initialSession={session} />;
}
