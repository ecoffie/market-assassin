import { describe, it, expect } from 'vitest';
import { shouldSendAlert, fingerprint, REMIND_AFTER_HOURS } from './ops-alert-dedup';

function sb(row: { fingerprint: string | null; last_sent_at: string | null } | null, readFails = false) {
  const writes: unknown[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () =>
          readFails ? { data: null, error: { message: 'boom' } } : { data: row, error: null } }) }),
        upsert: async (v: unknown) => { writes.push(v); return { error: null }; },
      };
    },
  };
  return { client, writes };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

describe('ops alert dedup', () => {
  it('fingerprint is order-independent (same people = same print)', () => {
    expect(fingerprint(['a@x.com', 'b@x.com'])).toBe(fingerprint(['b@x.com', 'a@x.com']));
  });

  it('fingerprint changes when a NEW person is affected', () => {
    expect(fingerprint(['a@x.com'])).not.toBe(fingerprint(['a@x.com', 'b@x.com']));
  });

  it('SENDS the first time a condition is seen', async () => {
    const { client, writes } = sb(null);
    const r = await shouldSendAlert(client, 'k', 'print1');
    expect(r).toEqual({ send: true, reason: 'new' });
    expect(writes).toHaveLength(1);
  });

  it('SUPPRESSES an unchanged condition (the daily-repeat noise)', async () => {
    const { client } = sb({ fingerprint: 'print1', last_sent_at: hoursAgo(2) });
    const r = await shouldSendAlert(client, 'k', 'print1');
    expect(r).toEqual({ send: false, reason: 'suppressed' });
  });

  it('SENDS when the affected set changes — genuinely new information', async () => {
    const { client } = sb({ fingerprint: 'print1', last_sent_at: hoursAgo(2) });
    const r = await shouldSendAlert(client, 'k', 'print2-someone-new');
    expect(r.send).toBe(true);
    expect(r.reason).toBe('changed');
  });

  it('RE-SENDS after the reminder window so a problem is never forgotten', async () => {
    const { client } = sb({ fingerprint: 'print1', last_sent_at: hoursAgo(REMIND_AFTER_HOURS + 1) });
    const r = await shouldSendAlert(client, 'k', 'print1');
    expect(r).toEqual({ send: true, reason: 'reminder' });
  });

  it('FAILS OPEN when the state store cannot be read — never silences a real alert', async () => {
    const { client } = sb(null, true);
    const r = await shouldSendAlert(client, 'k', 'print1');
    expect(r).toEqual({ send: true, reason: 'no-store' });
  });
});
