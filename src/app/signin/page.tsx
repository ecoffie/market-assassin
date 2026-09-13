import { redirect } from 'next/navigation';
import { getMindySessionFromCookies } from '@/lib/mindy/mi-auth-cookie';
import { safeNext } from '@/lib/mindy/safe-next';
import SignInClient from './SignInClient';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const raw = typeof q.next === 'string' ? q.next : '';
  const next = safeNext(raw, '/mcp');
  const session = await getMindySessionFromCookies();
  const forceSwitch = q.switch === '1' || q.signup === '1' || q.mfa === '1' || q.oauth;
  if (session.signedIn && !forceSwitch) {
    redirect(next);
  }
  return (
    <SignInClient
      next={next}
      initialEmail={typeof q.email === 'string' ? q.email : ''}
      startSignup={q.signup === '1'}
      startMfa={q.mfa === '1'}
      startOauth={q.oauth === 'google' || q.oauth === 'microsoft' ? q.oauth : null}
      startForgot={q.forgot === '1'}
      startSetup={q.setup === '1'}
    />
  );
}
