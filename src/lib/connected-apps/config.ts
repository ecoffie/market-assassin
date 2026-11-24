/**
 * Connected business apps (Google Workspace, Microsoft 365): provider endpoints, least-privilege scopes per
 * capability, and the feature flag. Spec: docs/connected-apps/CONNECTED-APPS-SPEC-2026-11-24.md.
 *
 * Sign-in (Supabase Google/Azure) authenticates the Mindy user; it does NOT authorize Drive, Gmail, Calendar or
 * Graph. Each connected account gets its own delegated OAuth grant, requested only for the capability in use.
 */
export type Provider = 'google' | 'microsoft';
export type Capability = 'identity' | 'file' | 'draft' | 'calendar';

export const PROVIDERS: readonly Provider[] = ['google', 'microsoft'];

/** Least privilege, incremental. No send scope beyond what drafting requires; no domain-wide or restricted Drive scopes. */
export const SCOPES: Record<Provider, Record<Capability, string[]>> = {
  google: {
    identity: ['openid', 'email', 'profile'],
    // drive.file = only files the user picks (Google Picker). Never drive.readonly (restricted) in v1.
    file: ['https://www.googleapis.com/auth/drive.file'],
    // gmail.compose allows sending at the OAuth level; the v1 executor exposes draft creation only.
    draft: ['https://www.googleapis.com/auth/gmail.compose'],
    calendar: ['https://www.googleapis.com/auth/calendar.events.owned'],
  },
  microsoft: {
    identity: ['openid', 'profile', 'email', 'offline_access', 'User.Read'],
    file: ['Files.Read'],
    // Mail.ReadWrite (never Mail.Send); the v1 executor exposes draft creation only.
    draft: ['Mail.ReadWrite'],
    calendar: ['Calendars.ReadWrite'],
  },
};

export function scopesFor(provider: Provider, caps: Capability[]): string[] {
  const set = new Set<string>(SCOPES[provider].identity);
  for (const c of caps) for (const s of SCOPES[provider][c]) set.add(s);
  return [...set];
}

type Env = Record<string, string | undefined>;

export function endpoints(provider: Provider, env: Env = process.env) {
  if (provider === 'google') {
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
      identity: 'https://openidconnect.googleapis.com/v1/userinfo',
    };
  }
  const tenant = env.CONNECTED_APPS_MICROSOFT_TENANT || 'common';
  return {
    authorize: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    // Microsoft has no per-grant refresh-token revocation for a delegated app short of revoking ALL the user's
    // sessions (revokeSignInSessions), which is too broad. Disconnect = discard our token.
    revoke: null as string | null,
    identity: 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName',
  };
}

export interface ClientCreds { clientId: string; clientSecret: string }

/** OAuth client credentials (created in Google Cloud / Azure by an admin). null = provider not configured. */
export function clientCreds(provider: Provider, env: Env = process.env): ClientCreds | null {
  const id = provider === 'google' ? env.CONNECTED_APPS_GOOGLE_CLIENT_ID : env.CONNECTED_APPS_MICROSOFT_CLIENT_ID;
  const secret = provider === 'google' ? env.CONNECTED_APPS_GOOGLE_CLIENT_SECRET : env.CONNECTED_APPS_MICROSOFT_CLIENT_SECRET;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

/** The callback registered with both providers. */
export function redirectUri(env: Env = process.env): string {
  const base = (env.CONNECTED_APPS_REDIRECT_BASE || env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai').replace(/\/$/, '');
  return `${base}/api/app/connected-apps/callback`;
}

/** Off unless CONNECTED_APPS=true and the user is on CONNECTED_APPS_ALLOWLIST (comma-separated, or `*`). */
export function connectedAppsEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  if (env.CONNECTED_APPS !== 'true' || !email) return false;
  const list = (env.CONNECTED_APPS_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}
