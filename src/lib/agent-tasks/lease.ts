import { DEFAULT_LEASE_MS, type TaskLease } from './types';

export function isLeaseExpired(lease: TaskLease, nowMs: number): boolean {
  return Date.parse(lease.expiresAt) <= nowMs;
}

export function createLease(owner: string, role: TaskLease['role'], nowMs: number): TaskLease {
  const acquiredAt = new Date(nowMs).toISOString();
  return {
    owner: owner.trim(),
    role,
    acquiredAt,
    expiresAt: new Date(nowMs + DEFAULT_LEASE_MS).toISOString(),
    lastHeartbeatAt: acquiredAt,
  };
}

export function renewLease(lease: TaskLease, nowMs: number): TaskLease {
  const heartbeat = new Date(nowMs).toISOString();
  return {
    ...lease,
    lastHeartbeatAt: heartbeat,
    expiresAt: new Date(nowMs + DEFAULT_LEASE_MS).toISOString(),
  };
}

export function assertLeaseOwner(lease: TaskLease, owner: string): boolean {
  return lease.owner === owner.trim();
}

/**
 * No destructive takeover: another owner may act only after expiry (recovery path).
 */
export function canClaimLease(
  existing: TaskLease | null,
  owner: string,
  nowMs: number,
): { allowed: true } | { allowed: false; reason: 'lease_conflict' | 'lease_not_owner' } {
  if (!existing) return { allowed: true };
  if (isLeaseExpired(existing, nowMs)) return { allowed: true };
  if (existing.owner === owner.trim()) return { allowed: true };
  return { allowed: false, reason: 'lease_conflict' };
}
