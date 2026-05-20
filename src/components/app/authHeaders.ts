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
  }

  return headers;
}
