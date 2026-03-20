import { kv } from '@vercel/kv';

/**
 * Abuse detection thresholds
 */
export const ABUSE_THRESHOLDS = {
  WARNING: 100, // Log warning
  FLAG: 250, // Flag for review
  BLOCK: 500, // Auto-block consideration
};

/**
 * Abuse flag record stored in KV
 */
export interface AbuseFlag {
  email: string;
  totalGenerations: number;
  flaggedAt: string;
  level: 'warning' | 'flagged' | 'blocked';
  notes?: string;
}

/**
 * Lightweight lifetime generation tracking.
 * Increments a permanent counter per email for abuse monitoring.
 * Flags users who exceed thresholds.
 */
export async function trackGeneration(email: string): Promise<number> {
  const key = `abuse:${email.toLowerCase()}`;
  const count = await kv.incr(key);

  // Log warning at 100 generations
  if (count >= ABUSE_THRESHOLDS.WARNING && count % 100 === 0) {
    console.warn(`[Abuse Detection] ${email} has ${count} total generations`);
  }

  // Flag for review at 250 generations
  if (count === ABUSE_THRESHOLDS.FLAG) {
    await flagUserForReview(email, count, 'flagged');
  }

  // Log critical at 500+ generations
  if (count >= ABUSE_THRESHOLDS.BLOCK && count % 50 === 0) {
    console.error(`[Abuse Detection] CRITICAL: ${email} has ${count} generations - consider blocking`);
    await flagUserForReview(email, count, 'blocked');
  }

  return count;
}

/** Get lifetime generation count for an email */
export async function getAbuseRecord(email: string): Promise<number> {
  const count = await kv.get<number>(`abuse:${email.toLowerCase()}`);
  return count || 0;
}

/** Flag a user for manual review */
async function flagUserForReview(email: string, count: number, level: 'warning' | 'flagged' | 'blocked'): Promise<void> {
  const flag: AbuseFlag = {
    email: email.toLowerCase(),
    totalGenerations: count,
    flaggedAt: new Date().toISOString(),
    level,
  };

  // Store the flag
  await kv.set(`abuse:flag:${email.toLowerCase()}`, flag);

  // Add to flagged users list
  await kv.sadd('abuse:flagged', email.toLowerCase());
}

/** Get all flagged users */
export async function getFlaggedUsers(): Promise<AbuseFlag[]> {
  const emails = await kv.smembers('abuse:flagged');
  if (!emails || emails.length === 0) return [];

  const flags: AbuseFlag[] = [];
  for (const email of emails) {
    const flag = await kv.get<AbuseFlag>(`abuse:flag:${email}`);
    if (flag) {
      // Update with current count
      flag.totalGenerations = await getAbuseRecord(email as string);
      flags.push(flag);
    }
  }

  // Sort by total generations descending
  return flags.sort((a, b) => b.totalGenerations - a.totalGenerations);
}

/** Clear abuse flag for a user (after manual review) */
export async function clearAbuseFlag(email: string): Promise<void> {
  await kv.del(`abuse:flag:${email.toLowerCase()}`);
  await kv.srem('abuse:flagged', email.toLowerCase());
}

/** Check if a user is blocked */
export async function isUserBlocked(email: string): Promise<boolean> {
  const flag = await kv.get<AbuseFlag>(`abuse:flag:${email.toLowerCase()}`);
  return flag?.level === 'blocked';
}
