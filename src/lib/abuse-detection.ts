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
 * Gracefully handles KV unavailability (quota exceeded, network errors).
 */
export async function trackGeneration(email: string): Promise<number> {
  try {
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
  } catch (error) {
    // KV unavailable (quota exceeded, etc.) - allow the request to proceed
    console.warn(`[Abuse Detection] KV unavailable for tracking ${email}; skipping abuse check`, error);
    return 0;
  }
}

/** Get lifetime generation count for an email */
export async function getAbuseRecord(email: string): Promise<number> {
  try {
    const count = await kv.get<number>(`abuse:${email.toLowerCase()}`);
    return count || 0;
  } catch (error) {
    console.warn(`[Abuse Detection] KV unavailable for getAbuseRecord ${email}`, error);
    return 0;
  }
}

/** Flag a user for manual review */
async function flagUserForReview(email: string, count: number, level: 'warning' | 'flagged' | 'blocked'): Promise<void> {
  try {
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
  } catch (error) {
    // KV unavailable - log and continue (flagging is non-critical)
    console.warn(`[Abuse Detection] KV unavailable for flagUserForReview ${email}`, error);
  }
}

/** Get all flagged users */
export async function getFlaggedUsers(): Promise<AbuseFlag[]> {
  try {
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
  } catch (error) {
    console.warn('[Abuse Detection] KV unavailable for getFlaggedUsers', error);
    return [];
  }
}

/** Clear abuse flag for a user (after manual review) */
export async function clearAbuseFlag(email: string): Promise<void> {
  try {
    await kv.del(`abuse:flag:${email.toLowerCase()}`);
    await kv.srem('abuse:flagged', email.toLowerCase());
  } catch (error) {
    console.warn(`[Abuse Detection] KV unavailable for clearAbuseFlag ${email}`, error);
  }
}

/** Check if a user is blocked */
export async function isUserBlocked(email: string): Promise<boolean> {
  try {
    const flag = await kv.get<AbuseFlag>(`abuse:flag:${email.toLowerCase()}`);
    return flag?.level === 'blocked';
  } catch (error) {
    // KV unavailable - assume user is not blocked to allow the request to proceed
    console.warn(`[Abuse Detection] KV unavailable for isUserBlocked ${email}; allowing request`, error);
    return false;
  }
}
