/**
 * Connected business apps (Google Workspace, Microsoft 365): provider endpoints, least-privilege scopes per
 * capability, and the feature flag. Spec: docs/connected-apps/CONNECTED-APPS-SPEC-2026-11-24.md.
 *
 * Sign-in (Supabase Google/Azure) authenticates the Mindy user; it does NOT authorize Drive, Gmail, Calendar or
 * Graph. Each connected account gets its own delegated OAuth grant, requested only for the capability in use.
 */
export type Provider = 'google' | 'microsoft';
/**
 * Only the capabilities the shipped tools use. `draft` (Slice B) saves an email DRAFT in the customer's own mailbox;
 * calendar scopes are added, and reviewed, in the slice that ships the tool that uses them. Each capability is
 * requested only when the customer first needs it (incremental consent), never ahead of time.
 */
export type Capability = 'identity' | 'file' | 'draft';

export const PROVIDERS: readonly Provider[] = ['google', 'microsoft'];

/** Least privilege, incremental. No domain-wide or restricted Drive scopes. */
export const SCOPES: Record<Provider, Record<Capability, string[]>> = {
  google: {
    identity: ['openid', 'email', 'profile'],
    // drive.file = the app can open only files the user picks in Google Picker (or that the app created).
    file: ['https://www.googleapis.com/auth/drive.file'],
    // gmail.compose = create drafts. Google's grant also allows sending; Mindy's mail client has no send method
    // (email-draft.ts) and never calls a send endpoint. Never gmail.send, gmail.modify or https://mail.google.com/.
    // gmail.compose is a Google RESTRICTED scope: test users work now; public use needs Google app verification.
    draft: ['https://www.googleapis.com/auth/gmail.compose'],
  },
  microsoft: {
    identity: ['openid', 'profile', 'email', 'offline_access', 'User.Read'],
    // Files.Read is NOT selection-limited: it lets the app read ALL of the signed-in user's OneDrive files.
    // Microsoft has no delegated per-picked-file scope for personal consent. Mindy reads only the file the
    // customer picks, but the GRANT is broader, and ACCESS_DISCLOSURE says so before consent.
    file: ['Files.Read'],
    // Mail.ReadWrite is the least Graph permission that can create a draft (POST /me/messages). It does NOT allow
    // sending (that is Mail.Send, never requested). It also allows reading mail; Mindy only creates drafts.
    draft: ['Mail.ReadWrite'],
  },
};

/** Scopes Mindy must never request: sending mail, full mailbox control, restricted Drive. Asserted by a test. */
export const FORBIDDEN_SCOPES: readonly string[] = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.readonly',
  'Mail.Send',
  'Mail.Send.Shared',
  'Mail.ReadWrite.Shared',
];

/**
 * What the provider grant actually allows, shown to the customer BEFORE they are sent to consent. Must describe
 * the grant, not Mindy's intended use, where the two differ.
 */
export const ACCESS_DISCLOSURE: Record<Provider, Record<Exclude<Capability, 'identity'>, string>> = {
  google: {
    file: 'Google will let Mindy open only the files you pick. Mindy cannot see the rest of your Drive.',
    draft: 'Google\'s permission to save email drafts in your Gmail also covers sending. Mindy never sends: it only saves a draft for you to review and send yourself, and you can disconnect at any time.',
  },
  microsoft: {
    file: 'Microsoft will let Mindy read all of the files in your OneDrive, not only the ones you pick. Mindy opens only a file you choose, and you can disconnect at any time.',
    draft: 'Microsoft\'s permission to save email drafts in Outlook also lets an app read your mail. Mindy only saves a draft for you to review and send yourself; it does not read your mail and cannot send, and you can disconnect at any time.',
  },
};

/** True when a connection's granted scopes include everything a capability needs (Graph may prefix its resource URL). */
export function hasCapability(provider: Provider, granted: readonly string[], cap: Exclude<Capability, 'identity'>): boolean {
  const norm = new Set(granted.map((g) => g.replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase()));
  return SCOPES[provider][cap].every((s) => norm.has(s.toLowerCase()));
}

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

/**
 * Dedicated secrets, required. There is deliberately no fallback to ADMIN_PASSWORD / MCP_OAUTH_SIGNING_SECRET:
 * rotating an unrelated secret must never invalidate every stored connection or let states signed under one
 * purpose verify under another. null = refuse to run (routes answer 503 not_configured).
 */
export interface ConnectedAppsSecrets { stateSecret: string; tokenKey: { secret: string; salt: string } }
const MIN_SECRET_LEN = 32;
export function connectedAppsSecrets(env: Env = process.env): ConnectedAppsSecrets | null {
  const state = env.CONNECTED_APPS_STATE_SECRET || '';
  const enc = env.CONNECTED_APPS_TOKEN_ENC_KEY || '';
  if (state.length < MIN_SECRET_LEN || enc.length < MIN_SECRET_LEN || state === enc) return null;
  return { stateSecret: state, tokenKey: { secret: enc, salt: 'mindy-connected-apps-v1' } };
}

/** Off unless CONNECTED_APPS=true and the user is on CONNECTED_APPS_ALLOWLIST (comma-separated, or `*`). */
export function connectedAppsEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  if (env.CONNECTED_APPS !== 'true' || !email) return false;
  const list = (env.CONNECTED_APPS_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}
