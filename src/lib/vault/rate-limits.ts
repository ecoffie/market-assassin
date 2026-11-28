/**
 * Per-account limits for Vault document intake (review C15, 2026-11-17).
 *
 *   upload — every file is extracted (PDF/DOCX parsing in-process) and stored
 *   parse  — runs an LLM extraction (gpt-4o via callLLM) over a stored document
 *
 * Same contract as the document render route: the shared KV limiter, which ALLOWS when
 * KV is unavailable (CLAUDE.md bug-prevention rule #10), backed by a per-instance
 * in-memory window that applies the same limit and only bites when KV did not. Keyed
 * on the VERIFIED caller email (the person acting), so a coach's uploads into several
 * client Vaults share one budget.
 *
 * With VAULT_UPLOAD_LIMIT_FAIL_CLOSED='true', an UPLOAD is refused when KV is unavailable: the
 * per-instance window applies per serverless instance, so "unknown" is treated as "not allowed" for
 * writes. Parse keeps the fallback.
 */
import { checkRateLimit } from '@/lib/rate-limit';
import { vaultUploadLimitFailClosed } from './flags';

export type VaultLimitKind = 'upload' | 'parse';

export const VAULT_LIMITS: Record<VaultLimitKind, { limit: number; windowSeconds: number }> = {
  upload: { limit: 30, windowSeconds: 3600 },
  parse: { limit: 20, windowSeconds: 3600 },
};

const localHits = new Map<string, number[]>();
function localExceeded(key: string, limit: number, windowSeconds: number, now = Date.now()): boolean {
  const since = now - windowSeconds * 1000;
  const hits = (localHits.get(key) ?? []).filter((t) => t > since);
  hits.push(now);
  localHits.set(key, hits);
  if (localHits.size > 5000) localHits.delete(localHits.keys().next().value as string);
  return hits.length > limit;
}

/** Test hook. */
export function __resetVaultLocalLimits() {
  localHits.clear();
}

export async function checkVaultLimit(
  kind: VaultLimitKind,
  callerEmail: string,
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number; message: string }> {
  const { limit, windowSeconds } = VAULT_LIMITS[kind];
  const key = `vault${kind}:${callerEmail.trim().toLowerCase()}`;
  const rl = await checkRateLimit(key, limit, windowSeconds);
  if (kind === 'upload' && rl.unavailable && vaultUploadLimitFailClosed()) {
    console.warn('[vault/rate-limit] upload refused: shared rate limiter unavailable (fail-closed)');
    return {
      allowed: false,
      retryAfterSeconds: 60,
      message: "Uploads are paused for a moment because Mindy couldn't check your upload limit. Nothing was saved. Try again in a minute.",
    };
  }
  const local = localExceeded(key, limit, windowSeconds);
  if (rl.allowed && local) console.warn(`[vault/rate-limit] per-instance ${kind} limit hit (KV limiter allowed; KV may be unavailable)`);
  if (rl.allowed && !local) return { allowed: true };
  const retryAfterSeconds = Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000));
  return {
    allowed: false,
    retryAfterSeconds,
    message: kind === 'upload'
      ? 'You have uploaded a lot of files in the last hour. Nothing was saved. Try again a little later.'
      : 'You have run a lot of document reads in the last hour. Try again a little later.',
  };
}
