/**
 * Mindy MCP API keys — issuance, verification, lifecycle.
 *
 * Phase 1 Slice 1 (Foundation). The hosted MCP server (mcp.getmindy.ai, Slice 2)
 * authenticates every agent call with one of these keys; the dashboard
 * (getmindy.ai/mcp, Slice 5) lets a user create/list/revoke them.
 *
 * SECURITY MODEL:
 *   - We store ONLY sha256(key) + a short display prefix. The full secret is
 *     returned to the caller exactly ONCE (at issuance) and is never recoverable.
 *   - Verification is a single indexed lookup on the hash, filtered to non-revoked.
 *   - All access is via the SERVICE_ROLE client (RLS-bypassing); the table denies
 *     anon/authenticated (see migration 20260712_mcp_api_keys.sql).
 */

import { createHash, randomBytes } from 'node:crypto';
import { getWriteClient } from '@/lib/supabase/server-clients';

const KEY_PREFIX = 'mcp_live_';
/** Bytes of entropy in the random part (32 bytes = 64 hex chars). */
const KEY_ENTROPY_BYTES = 32;
/** Hex chars of the random part surfaced in the stored/display prefix. */
const DISPLAY_SUFFIX_LEN = 6;

export interface McpApiKeyRow {
  id: string;
  user_email: string;
  key_prefix: string;
  scopes: string[];
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Result of verifying a presented key — the identity the MCP edge acts as. */
export interface VerifiedApiKey {
  keyId: string;
  userEmail: string;
  scopes: string[];
}

/** sha256 hex of a raw key string. The only form we ever persist/compare. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Mint a new key. Returns the PLAINTEXT key (show once, never stored) plus the
 * hash + prefix we persist. Callers must never log or return `key` after the
 * one-time reveal.
 */
export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const random = randomBytes(KEY_ENTROPY_BYTES).toString('hex');
  const key = `${KEY_PREFIX}${random}`;
  return {
    key,
    keyHash: hashApiKey(key),
    keyPrefix: `${KEY_PREFIX}${random.slice(0, DISPLAY_SUFFIX_LEN)}`,
  };
}

/**
 * Issue + persist a key for a user. Returns the one-time plaintext `key` and the
 * stored row metadata (no secret). Caller shows `key` to the user exactly once.
 */
export async function issueApiKey(
  userEmail: string,
  opts?: { scopes?: string[]; label?: string },
): Promise<{ key: string; row: McpApiKeyRow }> {
  const { key, keyHash, keyPrefix } = generateApiKey();
  const { data, error } = await getWriteClient()
    .from('mcp_api_keys')
    .insert({
      user_email: userEmail.toLowerCase(),
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: opts?.scopes ?? [],
      label: opts?.label ?? null,
    })
    .select('id, user_email, key_prefix, scopes, label, created_at, last_used_at, revoked_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to issue MCP API key: ${error?.message || 'no row returned'}`);
  }
  return { key, row: data as McpApiKeyRow };
}

/**
 * Verify a presented key (the raw Bearer/X-Mindy-API-Key value). Returns the
 * resolved identity, or null if the key is unknown or revoked. Best-effort stamps
 * last_used_at (never blocks/fails the call on the stamp).
 *
 * This is the primitive the Slice 2 HTTP transport calls on every request.
 */
export async function verifyApiKey(rawKey: string | null | undefined): Promise<VerifiedApiKey | null> {
  const key = (rawKey || '').trim();
  if (!key.startsWith(KEY_PREFIX)) return null; // fast reject malformed/foreign tokens

  const { data, error } = await getWriteClient()
    .from('mcp_api_keys')
    .select('id, user_email, scopes')
    .eq('key_hash', hashApiKey(key))
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) return null;

  // Fire-and-forget usage stamp — must not affect the verify result.
  getWriteClient()
    .from('mcp_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(undefined, () => {});

  return { keyId: data.id, userEmail: data.user_email, scopes: data.scopes || [] };
}

/** A user's keys (metadata only — never the hash). Newest first. */
export async function listApiKeys(userEmail: string): Promise<McpApiKeyRow[]> {
  const { data, error } = await getWriteClient()
    .from('mcp_api_keys')
    .select('id, user_email, key_prefix, scopes, label, created_at, last_used_at, revoked_at')
    .eq('user_email', userEmail.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list MCP API keys: ${error.message}`);
  return (data || []) as McpApiKeyRow[];
}

/**
 * Revoke a key. Scoped to the owner (a user can only revoke their own keys), so a
 * stolen keyId from another user is a no-op. Idempotent. Returns true if a row was
 * revoked.
 */
export async function revokeApiKey(userEmail: string, keyId: string): Promise<boolean> {
  const { data, error } = await getWriteClient()
    .from('mcp_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_email', userEmail.toLowerCase())
    .is('revoked_at', null)
    .select('id');

  if (error) throw new Error(`Failed to revoke MCP API key: ${error.message}`);
  return (data?.length || 0) > 0;
}
