import { beforeAll, describe, expect, it } from 'vitest';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import { clearStoredAppAuth, MI_AUTH_TOKEN_KEY, peekStoredMiToken } from './stored-app-auth';

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'stored-app-auth-unit-test-secret';
});

function memoryStore(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    data,
  };
}

describe('clearStoredAppAuth cannot destroy a valid 30-day MI token', () => {
  it('keeps an unexpired Maps token when mi_beta_email / authenticated_at are missing', () => {
    const token = createMIAuthSessionToken('maps-only@example.com');
    const store = memoryStore({ [MI_AUTH_TOKEN_KEY]: token });
    const result = clearStoredAppAuth(store);
    expect(result.keptValidToken).toBe(true);
    expect(store.getItem(MI_AUTH_TOKEN_KEY)).toBe(token);
    expect(store.getItem('mi_beta_email')).toBeNull();
  });

  it('force:true is the only way an unexpired token is removed (explicit sign-out)', () => {
    const token = createMIAuthSessionToken('maps-only@example.com');
    const store = memoryStore({ [MI_AUTH_TOKEN_KEY]: token, mi_beta_email: 'maps-only@example.com' });
    const result = clearStoredAppAuth(store, { force: true });
    expect(result.keptValidToken).toBe(false);
    expect(store.getItem(MI_AUTH_TOKEN_KEY)).toBeNull();
  });

  it('peekStoredMiToken reads email from the HMAC payload without mi_beta_email', () => {
    const token = createMIAuthSessionToken('payload@example.com');
    const peeked = peekStoredMiToken(memoryStore({ [MI_AUTH_TOKEN_KEY]: token }));
    expect(peeked.unexpired).toBe(true);
    expect(peeked.email).toBe('payload@example.com');
  });
});
