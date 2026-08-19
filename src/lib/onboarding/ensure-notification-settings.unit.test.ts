import { describe, it, expect } from 'vitest';
import { ensureNotificationSettings } from './ensure-notification-settings';

/** Minimal PostgREST-shaped stub: records writes, returns scripted reads. */
function makeSb(opts: {
  existing?: Array<Record<string, unknown>> | null;
  readError?: string;
  insertError?: string;
  updateError?: string;
  /** rows returned by the SECOND read (the race re-check) */
  racedRows?: Array<Record<string, unknown>> | null;
}) {
  const calls = { inserts: 0, updates: 0, reads: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit: async () => {
                  calls.reads++;
                  if (opts.readError) return { data: null, error: { message: opts.readError } };
                  if (calls.reads >= 2 && opts.racedRows !== undefined) {
                    return { data: opts.racedRows, error: null };
                  }
                  return { data: opts.existing ?? [], error: null };
                },
              };
            },
          };
        },
        insert: async () => {
          calls.inserts++;
          return opts.insertError ? { error: { message: opts.insertError } } : { error: null };
        },
        update() {
          return {
            eq: async () => {
              calls.updates++;
              return opts.updateError ? { error: { message: opts.updateError } } : { error: null };
            },
          };
        },
      };
    },
  };
  return { sb, calls };
}

describe('ensureNotificationSettings', () => {
  it('creates the row when none exists, and flags it as needing targeting', async () => {
    const { sb, calls } = makeSb({ existing: [] });
    const r = await ensureNotificationSettings(sb, 'New@Example.com', 'cus_1');
    expect(r.outcome).toBe('created');
    expect(r.needsTargeting).toBe(true);
    expect(calls.inserts).toBe(1);
  });

  it('SURFACES an insert failure instead of reporting success (the bug that stranded 15 payers)', async () => {
    const { sb } = makeSb({ existing: [], insertError: 'permission denied', racedRows: [] });
    const r = await ensureNotificationSettings(sb, 'fail@example.com');
    expect(r.outcome).toBe('failed');
    expect(r.error).toContain('permission denied');
  });

  it('SURFACES a read failure rather than guessing', async () => {
    const { sb, calls } = makeSb({ readError: 'timeout' });
    const r = await ensureNotificationSettings(sb, 'x@example.com');
    expect(r.outcome).toBe('failed');
    expect(r.error).toContain('timeout');
    expect(calls.inserts).toBe(0); // never blind-insert on an unknown state
  });

  it('is idempotent: an existing row is UPDATED, never duplicated', async () => {
    const { sb, calls } = makeSb({ existing: [{ user_email: 'a@b.com', naics_codes: ['541512'] }] });
    const r = await ensureNotificationSettings(sb, 'a@b.com', 'cus_2');
    expect(r.outcome).toBe('updated');
    expect(calls.inserts).toBe(0);
    expect(calls.updates).toBe(1);
  });

  it('reports needsTargeting=false when the customer already has targeting', async () => {
    const { sb } = makeSb({ existing: [{ user_email: 'a@b.com', naics_codes: ['541512'], keywords: [], agencies: [] }] });
    const r = await ensureNotificationSettings(sb, 'a@b.com');
    expect(r.needsTargeting).toBe(false);
  });

  it('reports needsTargeting=true for a reachable row with EMPTY targeting (the other 18)', async () => {
    const { sb } = makeSb({ existing: [{ user_email: 'a@b.com', naics_codes: [], keywords: null, agencies: [] }] });
    const r = await ensureNotificationSettings(sb, 'a@b.com');
    expect(r.outcome).toBe('updated');
    expect(r.needsTargeting).toBe(true);
  });

  it('treats a concurrent insert (race) as success, not failure', async () => {
    const { sb } = makeSb({
      existing: [],
      insertError: 'duplicate key value violates unique constraint',
      racedRows: [{ user_email: 'race@example.com', naics_codes: [] }],
    });
    const r = await ensureNotificationSettings(sb, 'race@example.com');
    expect(r.outcome).toBe('updated');
    expect(r.error).toBeUndefined();
  });

  it('normalises the email (table keys on lowercase)', async () => {
    const { sb } = makeSb({ existing: [] });
    const r = await ensureNotificationSettings(sb, '  MiXeD@Case.COM  ');
    expect(r.outcome).toBe('created');
  });

  it('rejects an empty email instead of writing a junk row', async () => {
    const { sb, calls } = makeSb({ existing: [] });
    const r = await ensureNotificationSettings(sb, '   ');
    expect(r.outcome).toBe('failed');
    expect(calls.inserts).toBe(0);
  });
});
