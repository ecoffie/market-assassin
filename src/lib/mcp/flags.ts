/**
 * Mindy MCP feature toggles — Higgsfield-style "toggle every option".
 *
 * PRINCIPLE (Eric, 2026-07-12): the raw grounded DATA is the moat and must be
 * trustworthy first. Every OPTIONAL layer on top of that data — narration
 * (`_ai_hint`), enrichment passes, anything that could introduce a wrong or invented
 * value — is a TOGGLE that DEFAULTS OFF. We prove the data, then flip options on one
 * at a time. Nothing narrated or LLM-derived ships until explicitly enabled.
 *
 * Each option is an env flag `MCP_ENABLE_<X>=true`. Read via a getter so the value is
 * evaluated per-call (serverless env can bind per-invocation), not frozen at import.
 *
 * To add an option: add a getter here + gate the code path on it. Default stays OFF.
 */

function on(envVar: string): boolean {
  return (process.env[envVar] || '').trim().toLowerCase() === 'true';
}

export const mcpFlags = {
  /**
   * `_ai_hint` — the pre-narrated summary/how-to-use/caveats on tool results.
   * OFF until the data layer is proven. When off, tools return clean data + the
   * machine-readable `_meta` signals (grounded/degraded) only — no prose narration.
   */
  get aiHint(): boolean {
    return on('MCP_ENABLE_AI_HINT');
  },

  /**
   * Keyless OAuth 2.1 connect. OFF by default so the OAuth endpoints
   * (register/authorize/token/revoke + discovery metadata) return 404 and the
   * transport doesn't advertise the OAuth flow on 401 — until we flip it on for
   * the live Claude Desktop test. API-key auth is unaffected either way.
   */
  get oauth(): boolean {
    return on('MCP_OAUTH_ENABLED');
  },

  // Future toggles plug in the same way, e.g.:
  //   get enrichedSam(): boolean { return on('MCP_ENABLE_ENRICHED_SAM'); }
} as const;
