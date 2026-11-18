/**
 * Vault document flags: 'true' = everyone (unchanged), 'allowlist' = only VAULT_DOC_ALLOWLIST emails,
 * anything else = off. Eric's controlled test runs on production for named accounts only.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flagMode, vaultDocAllowlist, vaultDocEnabledFor, vaultDocFeatureLive, vaultDocCapabilities, vaultDocFlags } from './flags';

afterEach(() => vi.unstubAllEnvs());

describe('vault document flags', () => {
  it('modes: "true" = on, "allowlist" = allowlist, anything else = off (case/space tolerant)', () => {
    for (const [v, m] of [['true', 'on'], [' TRUE ', 'on'], ['allowlist', 'allowlist'], ['Allowlist', 'allowlist'], ['', 'off'], ['1', 'off'], ['yes', 'off'], ['false', 'off']] as const) {
      vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', v);
      expect(flagMode('VAULT_ASK_MINDY_UPLOADS'), v).toBe(m);
    }
  });

  it('global "true" keeps its behavior: on for every caller, even with no email', () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'true');
    expect(vaultDocEnabledFor('uploads', 'anyone@x.com')).toBe(true);
    expect(vaultDocEnabledFor('uploads', null)).toBe(true);
    expect(vaultDocFlags.askMindyUploads).toBe(true);
  });

  it('"allowlist": only listed verified emails (case-insensitive); others and no-email are off', () => {
    vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', ' Erika@Example.com, eric@govcongiants.com  staff@x.com ,notanemail ');
    expect([...vaultDocAllowlist()].sort()).toEqual(['eric@govcongiants.com', 'erika@example.com', 'staff@x.com']);
    expect(vaultDocEnabledFor('generate', 'erika@example.com')).toBe(true);
    expect(vaultDocEnabledFor('generate', 'ERIC@govcongiants.com')).toBe(true);
    expect(vaultDocEnabledFor('generate', 'stranger@x.com')).toBe(false);
    expect(vaultDocEnabledFor('generate', '')).toBe(false);
    expect(vaultDocEnabledFor('generate', undefined)).toBe(false);
    expect(vaultDocFlags.generatedFiles).toBe(false); // the global getter means "on for everyone" only
    expect(vaultDocFeatureLive('generate')).toBe(true);
  });

  it('"allowlist" with an empty list enables no one', () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', '');
    expect(vaultDocEnabledFor('uploads', 'erika@example.com')).toBe(false);
  });

  it('off by default; features are independent; capabilities mirror the per-email decision', () => {
    expect(vaultDocFeatureLive('uploads')).toBe(false);
    expect(vaultDocCapabilities('erika@example.com')).toEqual({ uploads: false, generate: false });
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'erika@example.com');
    expect(vaultDocCapabilities('erika@example.com')).toEqual({ uploads: true, generate: false });
    expect(vaultDocCapabilities('other@example.com')).toEqual({ uploads: false, generate: false });
  });
});
