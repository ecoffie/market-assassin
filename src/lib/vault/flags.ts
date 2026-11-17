/**
 * Vault document feature flags. Every flag DEFAULTS OFF. Read per call, never at import, so a fresh
 * deploy picks the env up.
 *
 * Each server flag has three modes:
 *   'true'      → on for every signed-in caller (the original contract, unchanged);
 *   'allowlist' → on ONLY for verified-session emails listed in VAULT_DOC_ALLOWLIST (comma- or
 *                 space-separated). This is Eric's controlled test: preview deployments cannot hold a
 *                 session (OAuth returns to getmindy.ai), so the test runs on production for named
 *                 accounts only, never as an unrestricted rollout;
 *   anything else (unset, 'false', a typo) → off.
 *
 * Callers pass the VERIFIED session email (requireMIAuthSession), never an email from the request
 * body. The browser learns its on/off from a server capability check, not a NEXT_PUBLIC build flag,
 * so an allowlist change needs no rebuild and cannot be enabled from the client.
 */
export type FlagMode = 'off' | 'on' | 'allowlist';
export type VaultDocFeature = 'uploads' | 'generate';

const FEATURE_ENV: Record<VaultDocFeature, string> = {
  /** Ask Mindy upload route + attach UI + find_my_documents tool. */
  uploads: 'VAULT_ASK_MINDY_UPLOADS',
  /** Mindy-rendered files persisted as doc_class='generated' rows, and the generate tool. */
  generate: 'VAULT_GENERATED_FILES',
};

export function flagMode(envVar: string): FlagMode {
  const v = (process.env[envVar] || '').trim().toLowerCase();
  if (v === 'true') return 'on';
  if (v === 'allowlist') return 'allowlist';
  return 'off';
}

/** VAULT_DOC_ALLOWLIST as a set of lower-cased emails (entries without an "@" are ignored). */
export function vaultDocAllowlist(): Set<string> {
  return new Set(
    (process.env.VAULT_DOC_ALLOWLIST || '')
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  );
}

/** Is this feature enabled for this VERIFIED session email? */
export function vaultDocEnabledFor(feature: VaultDocFeature, verifiedEmail: string | null | undefined): boolean {
  const mode = flagMode(FEATURE_ENV[feature]);
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const email = (verifiedEmail || '').trim().toLowerCase();
  return !!email && vaultDocAllowlist().has(email);
}

/** Could the feature be on for anyone? (Lets a route 404 before doing any work when it is fully off.) */
export function vaultDocFeatureLive(feature: VaultDocFeature): boolean {
  return flagMode(FEATURE_ENV[feature]) !== 'off';
}

/** What the browser may show for this verified session — the UI's only source of on/off. */
export function vaultDocCapabilities(verifiedEmail: string | null | undefined): { uploads: boolean; generate: boolean } {
  return { uploads: vaultDocEnabledFor('uploads', verifiedEmail), generate: vaultDocEnabledFor('generate', verifiedEmail) };
}

export const vaultDocFlags = {
  /** Global 'true' only. Per-caller decisions must use vaultDocEnabledFor('uploads', email). */
  get askMindyUploads(): boolean {
    return flagMode(FEATURE_ENV.uploads) === 'on';
  },
  /** Global 'true' only. Per-caller decisions must use vaultDocEnabledFor('generate', email). */
  get generatedFiles(): boolean {
    return flagMode(FEATURE_ENV.generate) === 'on';
  },
  /**
   * Vault Documents view grouped Company / Reference / Generated. Read in the
   * browser, so it must be a LITERAL process.env access (Next inlines only those).
   */
  get groupedView(): boolean {
    return (process.env.NEXT_PUBLIC_VAULT_GROUPED_DOCUMENTS || '').trim().toLowerCase() === 'true';
  },
};
