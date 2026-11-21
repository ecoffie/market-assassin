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
    job_workflow_ref: `ecoffie/market-assassin/${SCORECARD_WORKFLOW}`,
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

  it('names each OIDC gate without echoing the claim', () => {
    expect(assessScorecardOidcClaims(claims({ event_name: 'workflow_dispatch' }), NOW).ok).toBe(true);
    expect(assessScorecardOidcClaims(claims({ event_name: 'pull_request' }), NOW).reason).toBe('oidc event rejected');
    expect(assessScorecardOidcClaims(claims({ ref: 'refs/heads/feature' }), NOW).reason).toBe('oidc ref rejected');
    expect(assessScorecardOidcClaims(claims({ repository: 'other/market-assassin' }), NOW).reason).toBe('oidc repository rejected');
    expect(assessScorecardOidcClaims(claims({ aud: 'https://github.com/ecoffie' }), NOW).reason).toBe('oidc audience rejected');
    expect(assessScorecardOidcClaims(claims({ iss: 'https://example.invalid' }), NOW).reason).toBe('oidc issuer rejected');
    expect(assessScorecardOidcClaims(claims({
      workflow_ref: 'ecoffie/market-assassin/.github/workflows/other.yml@refs/heads/main',
    }), NOW).reason).toBe('oidc workflow rejected');
    expect(assessScorecardOidcClaims(claims({
      workflow_ref: 'ecoffie/market-assassin/.github/workflows/other.yml@refs/heads/main',
      job_workflow_ref: `ecoffie/market-assassin/${SCORECARD_WORKFLOW}`,
    }), NOW).reason).toBe('oidc workflow rejected');
    expect(assessScorecardOidcClaims(claims({
      job_workflow_ref: 'ecoffie/market-assassin/.github/workflows/other.yml@refs/heads/main',
    }), NOW).reason).toBe('oidc workflow rejected');
    expect(assessScorecardOidcClaims(claims({ exp: Math.floor(NOW / 1000) - 1 }), NOW).reason).toBe('oidc token expired');
    expect(assessScorecardOidcClaims(claims({ iat: Math.floor(NOW / 1000) - 11 * 60 }), NOW).reason).toBe('oidc token expired');
    expect(assessScorecardOidcClaims(claims({ iat: Math.floor(NOW / 1000) + 120 }), NOW).reason).toBe('oidc token rejected');
    expect(assessScorecardOidcClaims(claims({ nbf: Math.floor(NOW / 1000) + 120 }), NOW).reason).toBe('oidc token rejected');
    expect(assessScorecardOidcClaims(claims({ run_id: null }), NOW).reason).toBe('oidc token rejected');
    expect(assessScorecardOidcClaims(claims({ jti: 'short' }), NOW).reason).toBe('oidc token rejected');
  });

  it('verifies a locally signed RS256 token and rejects a bad signature', () => {
    const { token, publicKey } = signed(claims());
    const verified = verifyRs256(token, publicKey);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(assessScorecardOidcClaims(verified.payload, NOW).ok).toBe(true);
    const bad = signed(claims(), 'none');
    expect(verifyRs256(bad.token, bad.publicKey).reason).toBe('oidc signature rejected');
    expect(verifyRs256(`${token}x`, publicKey).reason).toBe('oidc signature rejected');
  });
});
