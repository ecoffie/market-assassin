'use client';

import { useEffect } from 'react';

const MINDY_ORIGIN = 'https://getmindy.ai';

function getRecoveryDestination(hash: string): string | null {
  if (!hash.startsWith('#')) return null;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const type = params.get('type');

  if (!accessToken) return null;

  if (type === 'recovery') {
    return `${MINDY_ORIGIN}/app/reset-password${hash}`;
  }

  if (type === 'invite' || type === 'signup') {
    return `${MINDY_ORIGIN}/app/setup-password${hash}`;
  }

  if (type === 'magiclink') {
    return `${MINDY_ORIGIN}/app${hash}`;
  }

  return null;
}

export function AuthRecoveryRedirect() {
  useEffect(() => {
    const destination = getRecoveryDestination(window.location.hash);
    if (destination && window.location.href !== destination) {
      window.location.replace(destination);
    }
  }, []);

  return null;
}
