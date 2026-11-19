import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SCORECARD_OIDC_AUDIENCE,
  SCORECARD_OIDC_ISSUER,
  SCORECARD_REF,
  SCORECARD_REPOSITORY,
  SCORECARD_WORKFLOW,
  assessScorecardOidcClaims,
  verifyRs256,
} from './oidc-claims';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: SCORECARD_OIDC_ISSUER,
    aud: SCORECARD_OIDC_AUDIENCE,
    repository: SCORECARD_REPOSITORY,
    ref: SCORECARD_REF,
    event_name: 'schedule',
    workflow_ref: `ecoffie/market-assassin/${SCORECARD_WORKFLOW}`,
    jti: 'jti-scorecard-1',
    exp: Math.floor(NOW / 1000) + 300,
    iat: Math.floor(NOW / 1000),
    run_id: '444',
    actor: 'github-actions',
    ...overrides,
  };
}

function signed(payload: Record<string, unknown>, alg = 'RS256') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
  return { token: `${data}.${signature}`, publicKey };
}

describe('scorecard OIDC claims', () => {
  it('accepts a main schedule token for this repository and workflow', () => {
    const result = assessScorecardOidcClaims(claims(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventName).toBe('schedule');
  });

  it('accepts workflow_dispatch and rejects every other event, ref, repo, and audience', () => {
    expect(assessScorecardOidcClaims(claims({ event_name: 'workflow_dispatch' }), NOW).ok).toBe(true);
    expect(assessScorecardOidcClaims(claims({ event_name: 'pull_request' }), NOW).ok).toBe(false);
    expect(assessScorecardOidcClaims(claims({ ref: 'refs/heads/feature' }), NOW).ok).toBe(false);
    expect(assessScorecardOidcClaims(claims({ repository: 'other/market-assassin' }), NOW).ok).toBe(false);
    expect(assessScorecardOidcClaims(claims({ aud: 'https://github.com/ecoffie' }), NOW).ok).toBe(false);
    expect(assessScorecardOidcClaims(claims({ iss: 'https://example.invalid' }), NOW).ok).toBe(false);
    expect(assessScorecardOidcClaims(claims({
      workflow_ref: 'ecoffie/market-assassin/.github/workflows/other.yml@refs/heads/main',
    }), NOW).ok).toBe(false);
  });

  it('rejects an expired token and a replayed signature that is not RS256', () => {
    expect(assessScorecardOidcClaims(claims({ exp: Math.floor(NOW / 1000) - 1 }), NOW).reason).toBe('credential is expired');
    const { token, publicKey } = signed(claims());
    expect(verifyRs256(token, publicKey).ok).toBe(true);
    const bad = signed(claims(), 'none');
    expect(verifyRs256(bad.token, bad.publicKey).ok).toBe(false);
    expect(verifyRs256(`${token}x`, publicKey).ok).toBe(false);
  });
});
