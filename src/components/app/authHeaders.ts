import { activeWorkspaceFor } from './activeWorkspace';

/** Decode the email embedded in an MI auth token (base64url `payload.signature`)
 *  WITHOUT verifying the signature — client-side this is only used to detect a
 *  token left over from a DIFFERENT account, never to grant access. */
function tokenEmail(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[0];
    if (!payload) return null;
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
          .join('')
      )
    );
    return typeof json?.email === 'string' ? json.email.toLowerCase().trim() : null;
  } catch {
    return null;
  }
}

export function getMIApiHeaders(email?: string | null, init?: HeadersInit) {
  const headers = new Headers(init);
  const wantEmail = email ? email.toLowerCase().trim() : '';

  if (email && !headers.has('x-user-email')) {
    headers.set('x-user-email', email);
  }

  if (typeof window !== 'undefined') {
    let authToken = localStorage.getItem('mi_beta_auth_token');

    // STALE-TOKEN GUARD. A token minted for a different account (left over from a
    // prior login / account switch) fails EVERY gated route with "two-factor
    // session does not match this account" — the exact error that kept breaking
    // onboarding. If the stored token's email doesn't match the account we're
    // acting as, purge it so it can never shadow the current login; the page's
    // mint path replaces it with the right one. Only purges when BOTH emails are
    // known and differ (Coach Mode passes the OWNER email + x-active-workspace, so
    // the owner's token still matches → never wrongly purged).
    if (authToken && wantEmail) {
      const te = tokenEmail(authToken);
      if (te && te !== wantEmail) {
        localStorage.removeItem('mi_beta_auth_token');
        localStorage.removeItem('mi_beta_2fa_token');
        authToken = null;
      }
    }

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
