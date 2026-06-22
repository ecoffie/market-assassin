import { activeWorkspaceFor } from './activeWorkspace';

export function getMIApiHeaders(email?: string | null, init?: HeadersInit) {
  const headers = new Headers(init);

  if (email && !headers.has('x-user-email')) {
    headers.set('x-user-email', email);
  }

  if (typeof window !== 'undefined') {
    const authToken = localStorage.getItem('mi_beta_auth_token');
    const twoFactorToken = localStorage.getItem('mi_beta_2fa_token');

    if (authToken && !headers.has('x-mi-auth-token')) {
      headers.set('x-mi-auth-token', authToken);
    }
    if (twoFactorToken && !headers.has('x-mi-2fa-token')) {
      headers.set('x-mi-2fa-token', twoFactorToken);
    }
    // Coach Mode: when a coach/consultant has switched to a client, every
    // workspace-scoped route can operate as that client via this header. Routes
    // that opt in read x-active-workspace; others fall back to the user's own.
    //
    // SAFETY: only attach it when the active workspace was set by THIS logged-in
    // user (owner stamp matches). A stale key from a prior login is ignored, so
    // it can never silently make you operate as someone else's client.
    const activeWs = activeWorkspaceFor(email);
    if (activeWs && !headers.has('x-active-workspace')) {
      headers.set('x-active-workspace', activeWs);
    }
  }

  return headers;
}
