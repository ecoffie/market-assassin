/**
 * MCP OAuth — the protected RESOURCES this authorization server mints tokens for
 * (RFC 8707 resource indicators / RFC 9728 protected-resource metadata).
 *
 * Two resources, one authorization server (getmindy.ai):
 *
 *   · DEFAULT  https://mcp.getmindy.ai/mcp          — the full Claude/general endpoint (64 tools).
 *   · CHATGPT  https://mcp.getmindy.ai/chatgpt/mcp  — the ChatGPT plugin profile (15 read-only
 *              tools, no commerce). See src/lib/mcp/chatgpt-profile.ts + tasks/chatgpt-plugin-path-a.md.
 *
 * A token's `aud` is exactly one of these, and each MCP handler accepts ONLY its own
 * audience — a ChatGPT-audience token is rejected on the full endpoint and vice versa.
 *
 * Deliberately free of node: imports so the consent page (a client component) can use
 * `isChatgptResource` to drop the Claude-only free-credit promise for ChatGPT connects.
 *
 * CLAUDE IS UNCHANGED BY CONSTRUCTION: an absent or unrecognised `resource` resolves to
 * the DEFAULT audience — the exact value every token was minted with before this file.
 */

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** The canonical full MCP resource (byte-identical to the pre-existing OAUTH_RESOURCE). */
export const OAUTH_RESOURCE = trimSlash(process.env.MCP_OAUTH_RESOURCE || 'https://mcp.getmindy.ai/mcp');

/** Path of the ChatGPT profile endpoint on the MCP origin. */
export const CHATGPT_MCP_PATH = '/chatgpt/mcp';

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'https://mcp.getmindy.ai';
  }
}

/**
 * The ChatGPT profile resource. Same ORIGIN as the full resource (the plugin's origin can
 * never change after submission), different path. Overridable for preview/local only.
 */
export const OAUTH_RESOURCE_CHATGPT = trimSlash(
  process.env.MCP_OAUTH_CHATGPT_RESOURCE || `${originOf(OAUTH_RESOURCE)}${CHATGPT_MCP_PATH}`,
);

/** Where the ChatGPT resource's RFC 9728 metadata lives (path-suffixed well-known URI). */
export const CHATGPT_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${CHATGPT_MCP_PATH}`;

/** Every resource the token endpoint will mint an audience for. */
export const ALLOWED_RESOURCES: readonly string[] = [OAUTH_RESOURCE, OAUTH_RESOURCE_CHATGPT];

/**
 * Map a requested `resource` value to an allowlisted audience, or null when it is absent
 * or not one of ours. Exact match after trailing-slash normalisation — never a prefix.
 */
export function allowlistedResource(requested: unknown): string | null {
  if (typeof requested !== 'string' || !requested.trim()) return null;
  const r = trimSlash(requested.trim());
  return ALLOWED_RESOURCES.includes(r) ? r : null;
}

/** Is this the ChatGPT profile audience? (Exact, server-side.) */
export function isChatgptAudience(aud: string | null | undefined): boolean {
  return !!aud && trimSlash(aud) === OAUTH_RESOURCE_CHATGPT;
}

/**
 * Client-safe check used by the consent page, where server env is not available:
 * true when the requested resource's PATH is the ChatGPT profile path.
 */
export function isChatgptResource(resource: string | null | undefined): boolean {
  if (!resource) return false;
  try {
    return trimSlash(new URL(resource).pathname) === CHATGPT_MCP_PATH;
  } catch {
    return false;
  }
}

export type AudienceResolution =
  | { ok: true; audience: string }
  | { ok: false; error: 'invalid_target'; description: string };

/**
 * Decide the access-token audience for a token request.
 *
 *   bound     — the resource recorded when the grant was made (auth code / refresh row)
 *   requested — the `resource` sent on THIS token request (RFC 8707 §2.2), if any
 *
 * Rules:
 *   1. Neither allowlisted → DEFAULT (exactly today's behaviour for every Claude token).
 *   2. Exactly one allowlisted → that one.
 *   3. Both allowlisted and DIFFERENT → invalid_target. A grant made for one resource can
 *      never be exchanged for a token to the other (no ChatGPT→full escalation, and no
 *      full→ChatGPT re-scoping either: re-authorise instead).
 *
 * Refresh rotation passes the stored row's resource as `bound`, so a rotated token keeps
 * its audience.
 */
export function resolveTokenAudience(bound: unknown, requested: unknown): AudienceResolution {
  const b = allowlistedResource(bound);
  const r = allowlistedResource(requested);
  if (b && r && b !== r) {
    return {
      ok: false,
      error: 'invalid_target',
      description: 'The requested resource does not match the resource this grant was issued for',
    };
  }
  return { ok: true, audience: r ?? b ?? OAUTH_RESOURCE };
}
