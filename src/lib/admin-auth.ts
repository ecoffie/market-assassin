/**
 * Centralized admin authentication.
 * Replaces 15+ inline password checks across admin routes.
 */

const encoder = new TextEncoder();

/**
 * Timing-safe password comparison using constant-time XOR.
 * Prevents timing attacks that could leak password length/characters.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  // Always compare the same number of bytes to avoid length-based timing leaks
  const maxLen = Math.max(bufA.length, bufB.length);
  let mismatch = bufA.length !== bufB.length ? 1 : 0;

  for (let i = 0; i < maxLen; i++) {
    mismatch |= (bufA[i % bufA.length] || 0) ^ (bufB[i % bufB.length] || 0);
  }

  return mismatch === 0;
}

/**
 * Verify an admin password against the ADMIN_PASSWORD env var.
 * Returns false if env var is unset (no hardcoded fallbacks).
 */
export function verifyAdminPassword(password: string | null | undefined): boolean {
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected || !password) {
    return false;
  }

  return timingSafeEqual(password, expected);
}

/**
 * Verify the ADMIN_SECRET env var (used by create-token route).
 * Returns false if env var is unset.
 */
export function verifyAdminSecret(secret: string | null | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;

  if (!expected || !secret) {
    return false;
  }

  return timingSafeEqual(secret, expected);
}
