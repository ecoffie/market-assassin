/**
 * The production reader's lifetimeMember(): a customer_classifications 'lifetime' row counts
 * only while a Pro grant is live right now, the same attribution rule R2 uses
 * (entitlements/sources.ts). A stale classification snapshot never makes an account paid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown> | null;
const state: { cls: Row; prof: Row; clsErr: boolean; kv: unknown; kvThrows: boolean } = {
  cls: null, prof: null, clsErr: false, kv: null, kvThrows: false,
};

function from(table: string) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () =>
    table === 'customer_classifications'
      ? { data: state.cls, error: state.clsErr ? { message: 'boom' } : null }
      : { data: state.prof, error: null };
  return q;
}

vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({ from }) }));
vi.mock('@vercel/kv', () => ({
  kv: { get: async () => { if (state.kvThrows) throw new Error('kv down'); return state.kv; } },
}));
vi.mock('@/lib/mcp/payer', () => ({ resolvePayer: async () => ({ kind: 'none' }) }));

const FUTURE = '2999-01-01T00:00:00Z';
const PAST = '2000-01-01T00:00:00Z';

async function read() {
  const { supabasePaidStatusReader } = await import('./paid-status');
  return supabasePaidStatusReader.lifetimeMember!('buyer@example.test');
}

beforeEach(() => {
  Object.assign(state, { cls: null, prof: null, clsErr: false, kv: null, kvThrows: false });
});

describe('supabasePaidStatusReader.lifetimeMember', () => {
  it('lifetime classification + live profile grant → yes', async () => {
    state.cls = { briefings_access: 'lifetime', briefings_expiry: null };
    state.prof = { access_briefings: true, briefings_expires_at: null };
    expect(await read()).toEqual({ ok: true, value: true });
  });

  it('lifetime classification + KV grant (no profile flag) → yes', async () => {
    state.cls = { briefings_access: 'lifetime', briefings_expiry: null };
    state.kv = true;
    expect(await read()).toEqual({ ok: true, value: true });
  });

  it('lifetime classification but NO live grant (churned snapshot) → no', async () => {
    state.cls = { briefings_access: 'lifetime', briefings_expiry: null };
    state.prof = { access_briefings: true, briefings_expires_at: PAST };
    expect(await read()).toEqual({ ok: true, value: false });
  });

  it('a live grant without a lifetime classification → no', async () => {
    state.cls = { briefings_access: '1_year', briefings_expiry: FUTURE };
    state.prof = { access_briefings: true, briefings_expires_at: null };
    expect(await read()).toEqual({ ok: true, value: false });
    state.cls = null;
    expect(await read()).toEqual({ ok: true, value: false });
  });

  it('an expired lifetime classification → no', async () => {
    state.cls = { briefings_access: 'lifetime', briefings_expiry: PAST };
    state.prof = { access_briefings: true, briefings_expires_at: null };
    expect(await read()).toEqual({ ok: true, value: false });
  });

  it('a failed read is reported as a failure, never a guess', async () => {
    state.clsErr = true;
    expect(await read()).toEqual({ ok: false });
    state.clsErr = false;
    state.cls = { briefings_access: 'lifetime', briefings_expiry: null };
    state.kvThrows = true;
    expect(await read()).toEqual({ ok: false });
  });
});
