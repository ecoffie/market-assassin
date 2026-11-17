/**
 * Vault document feature flags. Every flag DEFAULTS OFF and needs the literal
 * string `true` (same contract as src/lib/mcp/flags.ts). Read per call, never at
 * import, so a fresh deploy picks the env up.
 */
function on(envVar: string): boolean {
  return (process.env[envVar] || '').trim().toLowerCase() === 'true';
}

export const vaultDocFlags = {
  /** Ask Mindy upload route + attach button + find_my_documents tool. */
  get askMindyUploads(): boolean {
    return on('VAULT_ASK_MINDY_UPLOADS');
  },
  /** Persist Mindy-rendered files as doc_class='generated' rows. */
  get generatedFiles(): boolean {
    return on('VAULT_GENERATED_FILES');
  },
  /**
   * Vault Documents view grouped Company / Reference / Generated. Read in the
   * browser, so it must be a LITERAL process.env access (Next inlines only those).
   */
  get groupedView(): boolean {
    return (process.env.NEXT_PUBLIC_VAULT_GROUPED_DOCUMENTS || '').trim().toLowerCase() === 'true';
  },
};
