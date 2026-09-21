/**
 * MCP OAuth — persistence layer (Supabase, service-role). Clients, single-use
 * authorization codes, and rotating refresh tokens. Raw codes/tokens are never
 * stored; only their sha256.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { randomToken, sha256, REFRESH_TTL_SEC, CODE_TTL_SEC } from './tokens';

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  scope: string | null;
}

// ── Clients (Dynamic Client Registration) ────────────────────────────────────
/**
 * Find an already-registered client with an IDENTICAL signature
 * (client_name + redirect_uris + scope, public/`none` auth). Returns it or null.
 *
 * Storage-agnostic on purpose: compares redirect_uris in JS (sorted) rather than
 * relying on jsonb array equality through PostgREST, which is fiddly. The candidate
 * set is tiny — one row per distinct signature once dedup is in effect — so the
 * small fetch is cheap. Fails OPEN (returns null → mint a fresh client) so a lookup
 * error can never block a connection; the worst case is one extra row.
 */
async function findClientBySignature(input: {
  client_name: string | null;
  redirect_uris: string[]; // already sorted
  scope: string;
}): Promise<OAuthClient | null> {
  let q = getWriteClient()
    .from('mcp_oauth_clients')
    .select('client_id, client_name, redirect_uris, token_endpoint_auth_method, scope')
    .eq('scope', input.scope)
    .eq('token_endpoint_auth_method', 'none')
    .limit(50);
  q = input.client_name === null ? q.is('client_name', null) : q.eq('client_name', input.client_name);
  const { data, error } = await q;
  if (error) {
    console.error(`[oauth] client dedup lookup failed (minting fresh): ${error.message}`);
    return null;
  }
  const target = JSON.stringify(input.redirect_uris);
  const hit = (data ?? []).find(
    (r) => JSON.stringify([...((r.redirect_uris as string[]) ?? [])].sort()) === target,
  );
  return (hit as OAuthClient) ?? null;
}

export async function registerClient(input: {
  client_name?: string;
  redirect_uris: string[];
  scope?: string;
}): Promise<OAuthClient> {
  // Normalize so identical registrations collapse regardless of array order.
  const redirect_uris = [...input.redirect_uris].sort();
  const client_name = input.client_name ?? null;
  const scope = input.scope ?? 'mcp';

  // IDEMPOTENT DCR. Claude re-registers the IDENTICAL (client_name, redirect_uris,
  // scope) on every fresh connection, and minting a new client_id each time piled
  // up ~5 rows per user — the exact "very large numbers of registered clients"
  // that Anthropic's docs warn DCR causes at directory scale. Reuse the existing
  // client instead of proliferating.
  //
  // Safe because these are PUBLIC clients (token_endpoint_auth_method 'none'): the
  // client_id is not a secret, and every authorization still has its own PKCE
  // challenge, its own user-consent step, and per-user tokens (aud + sub bound). A
  // shared client_id identifies "this is Claude", nothing more. RFC 7591 does not
  // require a unique client_id per call; returning an existing one for identical
  // metadata is a legitimate registration response.
  //
  // This keeps us on DCR (the declared, submitted auth mode) and solves the actual
  // concern — table growth — without the cost/risk of the two alternatives:
  // CIMD (needs a client-metadata-document fetch path + SSRF hardening) or
  // oauth_anthropic_creds (needs a credential handshake with Anthropic).
  const existing = await findClientBySignature({ client_name, redirect_uris, scope });
  if (existing) return existing;

  const client_id = `mcpc_${randomToken(16)}`;
  const { data, error } = await getWriteClient()
    .from('mcp_oauth_clients')
    .insert({
      client_id,
      client_name,
      redirect_uris,
      token_endpoint_auth_method: 'none', // public clients (PKCE) only in v1
      scope,
    })
    .select('client_id, client_name, redirect_uris, token_endpoint_auth_method, scope')
    .single();
  if (error || !data) throw new Error(`register client failed: ${error?.message}`);
  return data as OAuthClient;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { data } = await getWriteClient()
    .from('mcp_oauth_clients')
    .select('client_id, client_name, redirect_uris, token_endpoint_auth_method, scope')
    .eq('client_id', clientId)
    .maybeSingle();
  return (data as OAuthClient) ?? null;
}

// ── Authorization codes (PKCE, single-use) ───────────────────────────────────
export async function saveAuthCode(input: {
  clientId: string;
  userEmail: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource?: string;
}): Promise<string> {
  const code = randomToken(32);
  const expires = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString();
  const { error } = await getWriteClient().from('mcp_oauth_codes').insert({
    code_hash: sha256(code),
    client_id: input.clientId,
    user_email: input.userEmail.toLowerCase(),
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    scope: input.scope,
    resource: input.resource ?? null,
    expires_at: expires,
  });
  if (error) throw new Error(`save auth code failed: ${error.message}`);
  return code;
}

export interface ConsumedCode {
  client_id: string;
  user_email: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
}

/**
 * Atomically claim + consume a code: the UPDATE ... WHERE consumed=false is the
 * single-use gate. A returned row means WE claimed it (a replay gets null).
 */
export async function consumeAuthCode(code: string): Promise<ConsumedCode | null> {
  const { data } = await getWriteClient()
    .from('mcp_oauth_codes')
    .update({ consumed: true })
    .eq('code_hash', sha256(code))
    .eq('consumed', false)
    .gt('expires_at', new Date().toISOString())
    .select('client_id, user_email, redirect_uri, code_challenge, scope, resource')
    .maybeSingle();
  return (data as ConsumedCode) ?? null;
}

// ── Refresh tokens (rotating, revocable) ─────────────────────────────────────
export async function saveRefreshToken(input: {
  clientId: string;
  userEmail: string;
  scope: string;
  resource?: string;
  rotatedFrom?: string;
}): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString();
  const { error } = await getWriteClient().from('mcp_oauth_tokens').insert({
    token_hash: sha256(token),
    client_id: input.clientId,
    user_email: input.userEmail.toLowerCase(),
    scope: input.scope,
    resource: input.resource ?? null,
    expires_at: expires,
    rotated_from: input.rotatedFrom ?? null,
  });
  if (error) throw new Error(`save refresh token failed: ${error.message}`);
  return token;
}

export interface RefreshRow {
  token_hash: string;
  client_id: string;
  user_email: string;
  scope: string | null;
  resource: string | null;
}

/** Claim a valid, unrevoked, unexpired refresh token AND revoke it (rotation). */
export async function consumeRefreshToken(token: string): Promise<RefreshRow | null> {
  const { data } = await getWriteClient()
    .from('mcp_oauth_tokens')
    .update({ revoked: true })
    .eq('token_hash', sha256(token))
    .eq('revoked', false)
    .gt('expires_at', new Date().toISOString())
    .select('token_hash, client_id, user_email, scope, resource')
    .maybeSingle();
  return (data as RefreshRow) ?? null;
}

/** Revoke a refresh token by raw value (RFC 7009). No-op if unknown. */
export async function revokeRefreshToken(token: string): Promise<void> {
  await getWriteClient()
    .from('mcp_oauth_tokens')
    .update({ revoked: true })
    .eq('token_hash', sha256(token));
}

/** Revoke every refresh token for a user (drives a "disconnect all"). */
export async function revokeAllForUser(userEmail: string): Promise<number> {
  const { data } = await getWriteClient()
    .from('mcp_oauth_tokens')
    .update({ revoked: true })
    .eq('user_email', userEmail.toLowerCase())
    .eq('revoked', false)
    .select('token_hash');
  return data?.length ?? 0;
}
