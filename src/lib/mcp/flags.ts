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

  /**
   * Tier gating enforcement. OFF by default so Phase A ships with ZERO behavior
   * change — every tool stays metered exactly as today. Flip on
   * (`MCP_ENFORCE_TIERS=true`) to enforce Pro-only tools (`TOOL_TIER === 'pro'`,
   * e.g. the winning playbook): a non-Pro caller gets `requires_pro` (no debit).
   */
  get enforceTiers(): boolean {
    return on('MCP_ENFORCE_TIERS');
  },

  /**
   * Corpus extraction guard (Layers A+B). Master switch. OFF by default → the guard
   * code never runs (zero added latency, zero behavior change). When ON, proprietary-
   * tool calls are evaluated against Layer A (free credits can't unlock crown jewels)
   * and Layer B (per-account rolling volume caps) — see src/lib/mcp/extraction-guard.ts.
   * With `extractionEnforce` OFF this is LOG-ONLY: violations write a `shadow_*` call-log
   * row but the call still runs, so we can measure real impact before enforcing.
   */
  get extractionGuard(): boolean {
    return on('MCP_EXTRACTION_GUARD');
  },

  /**
   * Extraction guard ENFORCEMENT. OFF by default → the guard runs in log-only/shadow
   * mode (measure first). Flip ON (`MCP_EXTRACTION_ENFORCE=true`, requires
   * `MCP_EXTRACTION_GUARD=true`) to actually block violating calls with a clean,
   * non-charged error (`requires_paid_credits` / `rate_limited`), never a crash.
   */
  get extractionEnforce(): boolean {
    return on('MCP_EXTRACTION_ENFORCE');
  },

  // Future toggles plug in the same way, e.g.:
  //   get enrichedSam(): boolean { return on('MCP_ENABLE_ENRICHED_SAM'); }
} as const;
