/**
 * MCP edge authentication — resolve an incoming HTTP request to a Mindy identity.
 *
 * Phase 1 Slice 2. The hosted MCP transport calls this on every request: pull the
 * key from `Authorization: Bearer <key>` (or `X-Mindy-API-Key`), verify it against
 * mcp_api_keys, and hand back the identity the tools run as. No key / bad key /
 * revoked key → null (the caller returns 401). Transport-agnostic: takes only the
 * raw header values so it works under any HTTP framework.
 */
import { verifyApiKey, type VerifiedApiKey } from './api-keys';

/** Extract the raw key from the standard header shapes. */
export function extractApiKey(headers: {
  authorization?: string | null;
  xMindyApiKey?: string | null;
}): string | null {
  const bearer = (headers.authorization || '').trim();
  if (bearer.toLowerCase().startsWith('bearer ')) {
    const token = bearer.slice(7).trim();
    if (token) return token;
  }
  const direct = (headers.xMindyApiKey || '').trim();
  return direct || null;
}

/**
 * Authenticate an MCP request from its headers. Returns the verified identity, or
 * null if there's no usable key or it fails verification (unknown/revoked).
 */
export async function authenticateMcpRequest(headers: {
  authorization?: string | null;
  xMindyApiKey?: string | null;
}): Promise<VerifiedApiKey | null> {
  const key = extractApiKey(headers);
  if (!key) return null;
  return verifyApiKey(key);
}

/** Convenience for a Next.js Request/Headers-style object. */
export async function authenticateFromHeaders(h: Headers): Promise<VerifiedApiKey | null> {
  return authenticateMcpRequest({
    authorization: h.get('authorization'),
    xMindyApiKey: h.get('x-mindy-api-key'),
  });
}
