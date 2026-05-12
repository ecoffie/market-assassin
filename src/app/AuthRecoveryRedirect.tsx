'use client';

import { useEffect } from 'react';

const MI_ORIGIN = 'https://mi.govcongiants.com';

function getRecoveryDestination(hash: string): string | null {
  if (!hash.startsWith('#')) return null;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get('access_token');
  const type = params.get('type');

  if (!accessToken) return null;

  if (type === 'recovery') {
    return `${MI_ORIGIN}/mi-beta/reset-password${hash}`;
  }

  if (type === 'invite' || type === 'signup') {
    return `${MI_ORIGIN}/mi-beta/setup-password${hash}`;
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
