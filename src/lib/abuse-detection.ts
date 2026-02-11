import { kv } from '@vercel/kv';

/**
 * Lightweight lifetime generation tracking.
 * Increments a permanent counter per email for abuse monitoring.
 */
export async function trackGeneration(email: string): Promise<number> {
  const key = `abuse:${email.toLowerCase()}`;
  const count = await kv.incr(key);

  if (count >= 100 && count % 100 === 0) {
    console.warn(`[Abuse Detection] ${email} has ${count} total generations`);
  }

  return count;
}

/** Get lifetime generation count for an email */
export async function getAbuseRecord(email: string): Promise<number> {
  const count = await kv.get<number>(`abuse:${email.toLowerCase()}`);
  return count || 0;
}
