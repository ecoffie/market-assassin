/**
 * GitHub Actions OIDC claims for one scorecard run.
 * Signature verification is separate. This function never sees a secret.
 */
import { createPublicKey, createVerify, type JsonWebKeyInput, type KeyObject } from 'node:crypto';

export const SCORECARD_OIDC_AUDIENCE = 'scorecard-reader';
export const SCORECARD_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const SCORECARD_REPOSITORY = 'ecoffie/market-assassin';
export const SCORECARD_WORKFLOW = '.github/workflows/daily-acquisition-scorecard.yml@refs/heads/main';
export const SCORECARD_REF = 'refs/heads/main';

const EVENTS = new Set(['schedule', 'workflow_dispatch']);

export interface ScorecardOidcClaims {
  iss?: unknown;
  aud?: unknown;
  repository?: unknown;
  ref?: unknown;
  event_name?: unknown;
  workflow_ref?: unknown;
  job_workflow_ref?: unknown;
  jti?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  run_id?: unknown;
  actor?: unknown;
}

export function assessScorecardOidcClaims(
  payload: ScorecardOidcClaims | null | undefined,
  nowMs = Date.now(),
): { ok: true; jti: string; runId: string; actor: string; eventName: string; repository: string; workflowRef: string } | { ok: false; reason: string } {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'oidc token rejected' };
  if (payload.iss !== SCORECARD_OIDC_ISSUER) return { ok: false, reason: 'oidc issuer rejected' };
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(SCORECARD_OIDC_AUDIENCE)) return { ok: false, reason: 'oidc audience rejected' };
  if (payload.repository !== SCORECARD_REPOSITORY) return { ok: false, reason: 'oidc repository rejected' };
  if (payload.ref !== SCORECARD_REF) return { ok: false, reason: 'oidc ref rejected' };
  if (typeof payload.event_name !== 'string' || !EVENTS.has(payload.event_name)) {
    return { ok: false, reason: 'oidc event rejected' };
  }
  const workflowRef = [payload.workflow_ref, payload.job_workflow_ref].find((value) => (
    typeof value === 'string' && value.endsWith(SCORECARD_WORKFLOW)
  ));
  if (typeof workflowRef !== 'string') return { ok: false, reason: 'oidc workflow rejected' };
  if (typeof payload.jti !== 'string' || payload.jti.length < 8) return { ok: false, reason: 'oidc token rejected' };
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return { ok: false, reason: 'oidc token expired' };
  if (typeof payload.iat !== 'number') return { ok: false, reason: 'oidc token rejected' };
  if (payload.iat * 1000 > nowMs + 60_000) return { ok: false, reason: 'oidc token rejected' };
  if (nowMs - payload.iat * 1000 > 10 * 60_000) return { ok: false, reason: 'oidc token expired' };
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > nowMs + 60_000) {
    return { ok: false, reason: 'oidc token rejected' };
  }
  if (typeof payload.run_id !== 'string' && typeof payload.run_id !== 'number') {
    return { ok: false, reason: 'oidc token rejected' };
  }
  const actor = typeof payload.actor === 'string' && payload.actor.trim() ? payload.actor.trim() : 'github-actions';
  return {
    ok: true,
    jti: payload.jti,
    runId: String(payload.run_id),
    actor,
    eventName: payload.event_name,
    repository: payload.repository,
    workflowRef,
  };
}

function b64urlJson(segment: string): unknown {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  return JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8'));
}

export function verifyRs256(token: string, publicKey: KeyObject): { ok: true; payload: ScorecardOidcClaims } | { ok: false; reason: string } {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'oidc signature rejected' };
  let header: { alg?: string };
  try {
    header = b64urlJson(parts[0]) as { alg?: string };
  } catch {
    return { ok: false, reason: 'oidc signature rejected' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'oidc signature rejected' };
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signed);
  if (!verifier.verify(publicKey, signature)) return { ok: false, reason: 'oidc signature rejected' };
  try {
    return { ok: true, payload: b64urlJson(parts[1]) as ScorecardOidcClaims };
  } catch {
    return { ok: false, reason: 'oidc signature rejected' };
  }
}

export function publicKeyFromJwk(jwk: JsonWebKeyInput['key']): KeyObject {
  return createPublicKey({ key: jwk, format: 'jwk' });
}
