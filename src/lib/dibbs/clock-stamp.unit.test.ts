/**
 * supabase-js reports a failed update as `{ error }` and does not throw.
 * A nonempty run must not claim last_verified_ingest advanced when that write failed.
 */
import { describe, expect, it } from 'vitest';
import { freshnessBody, stampDibbsClocks } from './clock-stamp';

function clockDb(opts: { readError?: string; writeError?: string; writeCount?: number; prior?: string | null }) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: opts.readError ? null : { last_verified_ingest: opts.prior ?? '2026-11-01T00:00:00Z' },
                    error: opts.readError ? { message: opts.readError } : null,
                  };
                },
              };
            },
          };
        },
        update() {
          return {
            async eq() {
              if (opts.writeError) return { error: { message: opts.writeError }, count: null };
              return { error: null, count: opts.writeCount ?? 1 };
            },
          };
        },
      };
    },
  };
}

const landed = { upstreamReadable: true, recordsReceived: 12, recordsLanded: 12 };

describe('stampDibbsClocks', () => {
  it('a failed clock write does not report the nonempty ingest as advanced', async () => {
    const stamped = await stampDibbsClocks(clockDb({ writeError: 'permission denied' }), landed);
    expect(stamped).toBeNull();
    const body = freshnessBody(stamped, landed.recordsReceived);
    expect(body.nonemptyIngestAdvanced).toBe(false);
    expect(body.lastNonemptyIngest).toBeNull();
  });

  it('a failed clock read does not invent a prior and a successful stamp', async () => {
    const stamped = await stampDibbsClocks(clockDb({ readError: 'statement timeout' }), landed);
    expect(stamped).toBeNull();
    expect(freshnessBody(stamped, landed.recordsReceived).nonemptyIngestAdvanced).toBe(false);
  });

  it('an update that matches zero rows does not report the nonempty ingest as advanced', async () => {
    const stamped = await stampDibbsClocks(clockDb({ writeCount: 0 }), landed);
    expect(stamped).toBeNull();
    expect(freshnessBody(stamped, landed.recordsReceived).nonemptyIngestAdvanced).toBe(false);
  });

  it('a successful write of landed rows reports the nonempty clock advanced', async () => {
    const stamped = await stampDibbsClocks(clockDb({ prior: '2026-11-01T00:00:00Z' }), landed);
    expect(stamped?.patch.advancedNonemptyIngest).toBe(true);
    const body = freshnessBody(stamped, landed.recordsReceived);
    expect(body.nonemptyIngestAdvanced).toBe(true);
    expect(body.lastNonemptyIngest).toBe(stamped?.patch.clocks.last_verified_ingest);
  });
});
