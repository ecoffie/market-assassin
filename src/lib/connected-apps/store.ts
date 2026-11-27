/**
 * Connected accounts store. Every read is scoped to the acting scope AND to the Mindy user who connected the
 * account (owner_email): in a client workspace shared by several coaches, a coach can never list, use or
 * disconnect a colleague's personal Google / Microsoft connection. There is no "get by id" without both.
 * Tokens are encrypted at rest and never returned to callers outside this module except as a live access token
 * for an immediate provider call.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretbox';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';
import { OAuthError, refreshTokens, revokeAtProvider, type TokenSet } from './oauth';
import { connectedAppsSecrets, type Provider } from './config';

export const TABLE = 'connected_accounts';

/** Tokens are encrypted ONLY with the dedicated connected-apps key; never the shared secretbox fallback chain. */
function tokenKey() {
  const s = connectedAppsSecrets();
  if (!s) throw new Error('connected-apps: dedicated secrets not configured');
  return s.tokenKey;
}
const enc = (v: string) => encryptSecret(v, tokenKey());
const dec = (v: string) => decryptSecret(v, tokenKey());

/** The acting scope a connection belongs to. null = workspace unconfirmed → refuse. */
export function scopeKeyFor(scope: ChatActingScope): string | null {
  if (scope.kind === 'own') return `own:${scope.email.toLowerCase()}`;
  if (scope.kind === 'client') return `ws:${scope.workspaceId}`;
  return null;
}

/** What callers may see. Never tokens. */
export interface ConnectionView {
  id: string;
  provider: Provider;
  connected_email: string;
  display_name: string | null;
  granted_scopes: string[];
  status: 'connected' | 'reauth_needed' | 'revoked';
  created_at: string;
}

interface Row extends ConnectionView {
  provider_account_id: string;
  owner_email: string;
  scope_key: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_expires_at: string | null;
}

const VIEW_COLS = 'id, provider, connected_email, display_name, granted_scopes, status, created_at';

function view(r: Row): ConnectionView {
  return { id: r.id, provider: r.provider, connected_email: r.connected_email, display_name: r.display_name, granted_scopes: r.granted_scopes || [], status: r.status, created_at: r.created_at };
}

export async function saveConnection(
  a: { scopeKey: string; ownerEmail: string; provider: Provider; accountId: string; email: string; name: string | null; tokens: TokenSet },
  db: SupabaseClient = getWriteClient(),
): Promise<ConnectionView> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    provider: a.provider,
    provider_account_id: a.accountId,
    connected_email: a.email.toLowerCase(),
    display_name: a.name,
    owner_email: a.ownerEmail.toLowerCase(),
    scope_key: a.scopeKey,
    granted_scopes: a.tokens.grantedScopes,
    access_token_enc: enc(a.tokens.accessToken),
    access_expires_at: new Date(a.tokens.expiresAt).toISOString(),
    status: 'connected',
    updated_at: now,
  };
  // A re-consent without a new refresh token (Google omits it when already granted) keeps the stored one.
  if (a.tokens.refreshToken) row.refresh_token_enc = enc(a.tokens.refreshToken);
  const { data, error } = await db
    .from(TABLE)
    // truncation-ok: one row upserted on a unique key; the payload is that row (the saved connection), never a write count.
    // Keyed per Mindy user too: a colleague connecting the same provider account gets their own row and never
    // takes over another person's connection.
    .upsert(row, { onConflict: 'scope_key,provider,provider_account_id,owner_email' })
    .select(VIEW_COLS)
    .single();
  if (error || !data) throw new Error(`connected-apps: save failed (${error?.code || 'no_row'})`);
  return view(data as Row);
}

const owner = (email: string) => String(email || '').trim().toLowerCase();

/** The caller's own connections in this acting scope (never a colleague's). */
export async function listConnections(scopeKey: string, ownerEmail: string, db: SupabaseClient = getWriteClient()): Promise<ConnectionView[]> {
  if (!owner(ownerEmail)) return [];
  const { data, error } = await db.from(TABLE).select(VIEW_COLS).eq('scope_key', scopeKey).eq('owner_email', owner(ownerEmail)).neq('status', 'revoked').order('created_at', { ascending: true });
  if (error) throw new Error(`connected-apps: list failed (${error.code})`);
  return ((data || []) as Row[]).map(view);
}

async function loadRow(scopeKey: string, ownerEmail: string, id: string, db: SupabaseClient): Promise<Row | null> {
  if (!owner(ownerEmail)) return null;
  const { data, error } = await db.from(TABLE).select('*').eq('id', id).eq('scope_key', scopeKey).eq('owner_email', owner(ownerEmail)).maybeSingle();
  if (error) throw new Error(`connected-apps: load failed (${error.code})`);
  return (data as Row) || null;
}

/**
 * A live access token for an immediate provider call, refreshing when needed. Fails closed: wrong scope, another
 * person's connection, revoked, or a dead grant (marked reauth_needed) all return a typed refusal.
 */
export async function accessTokenFor(
  scopeKey: string,
  ownerEmail: string,
  id: string,
  deps: { db?: SupabaseClient; refresh?: typeof refreshTokens; now?: number } = {},
): Promise<{ ok: true; token: string; provider: Provider; connection: ConnectionView } | { ok: false; reason: 'not_found' | 'revoked' | 'reauth_needed' | 'refresh_failed' }> {
  const db = deps.db ?? getWriteClient();
  const now = deps.now ?? Date.now();
  const row = await loadRow(scopeKey, ownerEmail, id, db);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status === 'revoked') return { ok: false, reason: 'revoked' };
  if (row.status === 'reauth_needed') return { ok: false, reason: 'reauth_needed' };
  const markReauth = () => db.from(TABLE).update({ status: 'reauth_needed', updated_at: new Date(now).toISOString() }).eq('id', row.id).eq('scope_key', scopeKey).eq('owner_email', row.owner_email);
  const exp = row.access_expires_at ? Date.parse(row.access_expires_at) : 0;
  // A stored token that no longer decrypts (key rotated or data damaged) is a dead grant: ask to reconnect.
  const tryDec = (v: string): string | null => { try { return dec(v); } catch { return null; } };
  if (row.access_token_enc && exp - now > 60_000) {
    const token = tryDec(row.access_token_enc);
    if (token) return { ok: true, token, provider: row.provider, connection: view(row) };
  }
  const refresh = row.refresh_token_enc ? tryDec(row.refresh_token_enc) : null;
  if (!refresh) {
    await markReauth();
    return { ok: false, reason: 'reauth_needed' };
  }
  try {
    const t = await (deps.refresh ?? refreshTokens)(row.provider, refresh);
    const patch: Record<string, unknown> = { access_token_enc: enc(t.accessToken), access_expires_at: new Date(t.expiresAt).toISOString(), updated_at: new Date(now).toISOString() };
    if (t.refreshToken) patch.refresh_token_enc = enc(t.refreshToken);
    await db.from(TABLE).update(patch).eq('id', row.id).eq('scope_key', scopeKey).eq('owner_email', row.owner_email);
    return { ok: true, token: t.accessToken, provider: row.provider, connection: view(row) };
  } catch (err) {
    if (err instanceof OAuthError && err.needsReauth) {
      await markReauth();
      return { ok: false, reason: 'reauth_needed' };
    }
    return { ok: false, reason: 'refresh_failed' };
  }
}

/**
 * Disconnect: revoke at the provider when it supports it, then DELETE the row (tokens and all). A reconnect creates
 * a new row with a new id, so file handles issued before the disconnect (bound to the old connection id) never work
 * again. No further provider calls.
 */
export async function disconnect(scopeKey: string, ownerEmail: string, id: string, deps: { db?: SupabaseClient; revoke?: typeof revokeAtProvider } = {}): Promise<'disconnected' | 'not_found'> {
  const db = deps.db ?? getWriteClient();
  const row = await loadRow(scopeKey, ownerEmail, id, db);
  if (!row) return 'not_found';
  let token: string | null = null;
  try { token = row.refresh_token_enc ? dec(row.refresh_token_enc) : row.access_token_enc ? dec(row.access_token_enc) : null; } catch { token = null; }
  if (token) await (deps.revoke ?? revokeAtProvider)(row.provider, token).catch(() => 'failed');
  const { error } = await db.from(TABLE).delete().eq('id', row.id).eq('scope_key', scopeKey).eq('owner_email', row.owner_email);
  if (error) throw new Error(`connected-apps: disconnect failed (${error.code})`);
  return 'disconnected';
}
