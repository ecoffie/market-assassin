/**
 * Recompete compute-once rollout control (Gate 2 · shadow → canary → authority, 2026-09-24).
 *
 *   RECOMPETE_COMPUTE_ONCE_MODE        off | shadow | canary | authority      (default off)
 *   RECOMPETE_COMPUTE_ONCE_SHADOW      0..1 — share of OLD-served requests that also run compute-once
 *                                      in the background and are compared            (default 0.1)
 *   RECOMPETE_COMPUTE_ONCE_CANARY_PCT  0..100 — share of requests SERVED by compute-once (canary)  (default 5)
 *   RECOMPETE_COMPUTE_ONCE_VERIFY      0..1 — share of NEW-served requests re-checked against the old
 *                                      path in the background                         (default 1 in canary, 0.1 in authority)
 *
 * `off` is absolute: nothing new runs, whatever a request asks for — that is the rollback.
 * A request may FORCE a path only with the operator token (x-recompete-verify = CRON_SECRET), so the
 * rollout can drive a controlled production sample without raising the organic sampling rate.
 */
export type ComputeOnceMode = 'off' | 'shadow' | 'canary' | 'authority';
export type Forced = 'old' | 'new' | 'shadow' | null;

export interface ComputeOnceConfig {
  mode: ComputeOnceMode;
  shadowSample: number;
  canaryPct: number;
  verifySample: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function num(v: string | undefined, dflt: number): number {
  if (v == null || v.trim() === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function computeOnceConfig(env: Record<string, string | undefined> = process.env): ComputeOnceConfig {
  const raw = String(env.RECOMPETE_COMPUTE_ONCE_MODE || '').trim().toLowerCase();
  const mode: ComputeOnceMode = raw === 'shadow' || raw === 'canary' || raw === 'authority' ? raw : 'off';
  return {
    mode,
    shadowSample: clamp(num(env.RECOMPETE_COMPUTE_ONCE_SHADOW, 0.1), 0, 1),
    canaryPct: clamp(num(env.RECOMPETE_COMPUTE_ONCE_CANARY_PCT, 5), 0, 100),
    verifySample: clamp(num(env.RECOMPETE_COMPUTE_ONCE_VERIFY, mode === 'authority' ? 0.1 : 1), 0, 1),
  };
}

export interface Decision {
  /** Which path produces the response the user receives. */
  serve: 'old' | 'new';
  /** Also run the OTHER path in the background and record the comparison. */
  compare: boolean;
}

/** One decision per request. `rnd` values in [0,1) — injected so tests are deterministic. */
export function decide(cfg: ComputeOnceConfig, rnd: { serve: number; compare: number }, forced: Forced = null): Decision {
  if (cfg.mode === 'off') return { serve: 'old', compare: false };
  if (forced === 'old') return { serve: 'old', compare: false };
  if (forced === 'shadow') return { serve: 'old', compare: true };
  if (forced === 'new') return cfg.mode === 'shadow' ? { serve: 'old', compare: true } : { serve: 'new', compare: true };
  if (cfg.mode === 'shadow') return { serve: 'old', compare: rnd.compare < cfg.shadowSample };
  if (cfg.mode === 'canary') {
    const serveNew = rnd.serve < cfg.canaryPct / 100;
    return { serve: serveNew ? 'new' : 'old', compare: rnd.compare < (serveNew ? cfg.verifySample : cfg.shadowSample) };
  }
  return { serve: 'new', compare: rnd.compare < cfg.verifySample };                 // authority
}

/** x-recompete-force is honored only with the operator token (constant-time compare). */
export function forcedFromHeaders(get: (h: string) => string | null, secret: string | undefined): Forced {
  const want = String(get('x-recompete-force') || '').toLowerCase();
  if (want !== 'old' && want !== 'new' && want !== 'shadow') return null;
  const token = String(get('x-recompete-verify') || '');
  if (!secret || token.length !== secret.length) return null;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0 ? (want as Forced) : null;
}
