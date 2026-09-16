import { describe, expect, it } from 'vitest';
import { MAPS_HOME_URL } from '@/lib/mindy/maps-home';
import { postSignInPath, shouldChallengePaidMfa } from '@/lib/mindy/post-signin-destination';

const AJ = 'aj@cypherintel.com';
const PAYER = 'payer@example.com';

describe('shouldChallengePaidMfa', () => {
  it('skips advocates even when paid MFA is on', () => {
    expect(shouldChallengePaidMfa(AJ, true)).toBe(false);
    expect(shouldChallengePaidMfa('AJ@CypherIntel.com', true)).toBe(false);
  });

  it('still challenges a paying account when enforcement is on', () => {
    expect(shouldChallengePaidMfa(PAYER, true)).toBe(true);
  });

  it('challenges nobody when enforcement is off', () => {
    expect(shouldChallengePaidMfa(PAYER, false)).toBe(false);
    expect(shouldChallengePaidMfa(AJ, false)).toBe(false);
  });
});

describe('postSignInPath', () => {
  it('sends an advocate with no destination to the new app, not /app', () => {
    expect(postSignInPath({ email: AJ })).toBe(MAPS_HOME_URL);
    expect(MAPS_HOME_URL).not.toContain('/app');
  });

  it('keeps an explicit legacy panel on /app', () => {
    expect(postSignInPath({ email: AJ, panel: 'pipeline' })).toBeNull();
  });

  it('follows a safe next for anyone, and ignores an /app next', () => {
    expect(postSignInPath({ email: PAYER, next: '/today' })).toBe('/today');
    expect(postSignInPath({ email: AJ, next: '/app' })).toBe(MAPS_HOME_URL);
    expect(postSignInPath({ email: PAYER, next: 'https://evil.example' })).toBeNull();
  });

  it('leaves a non-advocate who opened /app on purpose in the legacy shell', () => {
    expect(postSignInPath({ email: PAYER })).toBeNull();
  });
});
