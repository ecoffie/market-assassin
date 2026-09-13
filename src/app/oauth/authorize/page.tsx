import { getMindySessionFromCookies } from '@/lib/mindy/mi-auth-cookie';
import AuthorizeClient from './AuthorizeClient';

export const dynamic = 'force-dynamic';

export default async function AuthorizePage() {
  const session = await getMindySessionFromCookies();
  return <AuthorizeClient initialEmail={session.signedIn ? session.email : null} />;
}
