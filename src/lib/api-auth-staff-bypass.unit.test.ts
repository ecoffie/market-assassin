import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Staff privilege must require proof of identity.
 *
 * getStaffRole() decides from the email STRING alone — anything @govcongiants.com,
 * @govconedu.com or @getmindy.ai is 'staff' — and every Pro gate reads
 * `if (tier === 'free' && !isStaff)`. Routes that pass a client-supplied `?email=` were
 * therefore handing Pro data to anyone who typed a domain we own.
 *
 * VERIFIED LIVE against production on 2026-08-23, BEFORE the fix:
 *
 *   /api/app/pricing-intel?naics=541512&email=nonexistent-probe-9f3x@getmindy.ai
 *     -> HTTP 200 with real labor-rate intel: 136 records, medians, percentiles.
 *
 * That address does not exist in user_profiles (confirmed: 0 rows). /api/app/market-dossier
 * was reachable the same way. No session, no token, no account.
 *
 * This is a source-level guard because the bug is a missing precondition, not a behaviour a
 * unit test can reach without standing up sessions for 25 call sites.
 */
const SRC = readFileSync(join(__dirname, 'api-auth.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('staff-domain bypass', () => {
  it('never derives staffRole from an unverified email', () => {
    // The exact line that leaked. If it returns to an unconditional getStaffRole(), the
    // bypass is live again.
    expect(CODE).not.toMatch(/const\s+staffRole\s*=\s*getStaffRole\(normalizedEmail\)\s*;/);
    expect(CODE).toMatch(/identityVerified\s*\?\s*getStaffRole\(normalizedEmail\)\s*:\s*'none'/);
  });

  it('defaults identityVerified to false so every caller is safe without edits', () => {
    // 25 call sites. A default of true would have made this fix a no-op everywhere the flag
    // was not explicitly threaded — the failure mode is silent, so the default is the fix.
    expect(CODE).toMatch(/identityVerified\s*=\s*false/);
  });

  it('leaves paid access alone — entitlements still decide Pro/Team', () => {
    // The point is to remove a STAFF bypass, not to break paying customers. The sources
    // union and the Team check must still stand on real entitlements.
    expect(CODE).toContain('hasUnifiedProAccess');
    expect(CODE).toMatch(/Object\.values\(sources\)\.some\(Boolean\)/);
    expect(CODE).toContain("tier: 'team'");
  });

  it('still recognises staff domains — the list itself is not the bug', () => {
    // getStaffRole is correct in isolation; the defect was calling it on unproven input.
    // Deleting the domains would break real staff, which is the wrong fix.
    expect(CODE).toContain("domain === 'getmindy.ai'");
    expect(CODE).toContain("return 'staff'");
  });
});
