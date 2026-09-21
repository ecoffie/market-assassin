import { describe, it, expect } from 'vitest';
import { isGatedMindyApi, skipAuthRecovery } from './auth-recovery';

describe('isGatedMindyApi — which 401s attempt silent refresh + retry', () => {
  it('recovers the routes that previously bounced users to sign-in', () => {
    // The regression set: these fire early/often and were NOT covered by the old
    // `/api/app/` -only check, so a recoverable token bounced the user out.
    for (const url of [
      '/api/access/check?email=a@b.com',
      '/api/pipeline',
      '/api/pipeline/stats',
      '/api/teaming',
      '/api/pain-points',
      '/api/mindy/engagement',
      '/api/alerts/preferences',
      '/api/app/coach',
      '/api/app/vault',
    ]) {
      expect(isGatedMindyApi(url), url).toBe(true);
    }
  });

  it('NEVER recovers auth endpoints (would recurse the refresh call)', () => {
    for (const url of [
      '/api/auth/refresh-mi-session',
      '/api/auth/mindy-session',
      '/api/auth/mi-login',
      '/api/auth/two-factor/verify',
    ]) {
      expect(isGatedMindyApi(url), url).toBe(false);
    }
  });

  it('ignores non-gated / public routes', () => {
    for (const url of [
      '/api/contractors/search-bq',
      '/api/forecasts',
      '/api/sam-attachment/metadata',
      '/api/health',
    ]) {
      expect(isGatedMindyApi(url), url).toBe(false);
    }
  });

  it('handles absolute URLs the same as relative paths', () => {
    expect(isGatedMindyApi('https://getmindy.ai/api/access/check?email=a@b.com')).toBe(true);
    expect(isGatedMindyApi('https://getmindy.ai/api/auth/refresh-mi-session')).toBe(false);
    expect(isGatedMindyApi('https://getmindy.ai/api/forecasts')).toBe(false);
  });

  it('is defensive on malformed input', () => {
    expect(isGatedMindyApi('')).toBe(false);
    expect(isGatedMindyApi('not a url')).toBe(false);
  });
});

describe('skipAuthRecovery — do not recover an already-retried request', () => {
  it('is true only when the retry marker is set', () => {
    expect(skipAuthRecovery({ __miAuthRetry: true } as RequestInit)).toBe(true);
  });
  it('is false for a normal / undefined init', () => {
    expect(skipAuthRecovery(undefined)).toBe(false);
    expect(skipAuthRecovery({})).toBe(false);
    expect(skipAuthRecovery({ method: 'POST' })).toBe(false);
  });
});
