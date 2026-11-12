/**
 * Public social-proof numbers, DERIVED from the member contract-wins report — never typed by
 * hand (CLAUDE.md: "a number is a product feature"). /api/admin/member-contract-wins writes the
 * snapshot every time it runs; /api/public/member-proof reads it. A missing or stale snapshot
 * renders NOTHING, never a zero or an old number.
 */
import { kv } from '@vercel/kv';

const KEY = 'mindy:member-proof:v1';
export const MEMBER_PROOF_MAX_AGE_DAYS = 45;

import type { MemberProof } from './member-proof-format';
export { proofCount, proofDollars, type MemberProof } from './member-proof-format';

export async function saveMemberProof(p: MemberProof): Promise<void> {
  try {
    await kv.set(KEY, p, { ex: (MEMBER_PROOF_MAX_AGE_DAYS + 5) * 86400 });
  } catch (err) {
    console.warn('[member-proof] snapshot write failed', err);
  }
}

export function isFreshProof(p: MemberProof | null | undefined, now = Date.now()): p is MemberProof {
  if (!p || !(p.lifetimeDollars > 0) || !(p.members > 0)) return false;
  const t = Date.parse(p.computedAt);
  return Number.isFinite(t) && now - t <= MEMBER_PROOF_MAX_AGE_DAYS * 86400_000;
}

export async function readMemberProof(): Promise<MemberProof | null> {
  try {
    const p = await kv.get<MemberProof>(KEY);
    return isFreshProof(p) ? p : null;
  } catch {
    return null;
  }
}
