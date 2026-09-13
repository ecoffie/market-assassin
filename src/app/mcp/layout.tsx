import { getMindySessionFromCookies } from '@/lib/mindy/mi-auth-cookie';
import { McpIdentityProvider } from './McpIdentity';

export const dynamic = 'force-dynamic';

export default async function McpLayout({ children }: { children: React.ReactNode }) {
  const session = await getMindySessionFromCookies();
  return <McpIdentityProvider initial={session}>{children}</McpIdentityProvider>;
}
