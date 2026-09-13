'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { MindyCookieSession } from '@/lib/mindy/mi-auth-cookie';

const Ctx = createContext<{ signedIn: boolean; email: string | null }>({
  signedIn: false,
  email: null,
});

export function McpIdentityProvider({
  initial,
  children,
}: {
  initial: MindyCookieSession;
  children: ReactNode;
}) {
  const value = initial.signedIn
    ? { signedIn: true, email: initial.email }
    : { signedIn: false, email: null };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMcpIdentity() {
  return useContext(Ctx);
}
