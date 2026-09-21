/**
 * Idempotent DCR — registerClient() must NOT mint a fresh client_id for a
 * registration that matches an already-registered signature.
 *
 * The bug it guards: Claude re-registers the identical (client_name,
 * redirect_uris, scope) on every fresh connection. Minting a new client each time
 * piled ~5 rows/user — the DCR proliferation Anthropic's docs warn about. Dedup
 * collapses them to one. See src/lib/mcp/oauth/store.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A chainable fake of the supabase query builder that records inserts + serves rows. */
const rows: Array<Record<string, unknown>> = [];
const inserted: Array<Record<string, unknown>> = [];

function makeClient() {
  return {
    from() {
      // The real supabase builder is LAZY: you keep chaining .eq()/.is() after
      // .limit() and it only runs on await (.then). So the builder is a thenable
      // that resolves the accumulated scalar filters against `rows`.
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          const match = rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => (r[k] ?? null) === v),
          );
          resolve({ data: match, error: null });
        },
        insert(payload: Record<string, unknown>) {
          inserted.push(payload);
          rows.push(payload);
          return {
            select: () => ({ single: () => Promise.resolve({ data: payload, error: null }) }),
          };
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => makeClient(),
}));
vi.mock('./tokens', async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  let n = 0;
  return { ...actual, randomToken: () => `TOK${n++}` };
});

import { registerClient } from './store';

beforeEach(() => {
  rows.length = 0;
  inserted.length = 0;
});

const CLAUDE = {
  client_name: 'Claude',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  scope: 'mcp',
};

describe('idempotent DCR', () => {
  it('first registration mints exactly one client', async () => {
    const c = await registerClient(CLAUDE);
    expect(inserted).toHaveLength(1);
    expect(c.client_id).toMatch(/^mcpc_/);
  });

  it('a second IDENTICAL registration reuses the client — no new row', async () => {
    const a = await registerClient(CLAUDE);
    const b = await registerClient(CLAUDE);
    expect(b.client_id).toBe(a.client_id);
    expect(inserted).toHaveLength(1); // still one
  });

  it('10 identical registrations collapse to ONE client (the proliferation fix)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) ids.add((await registerClient(CLAUDE)).client_id);
    expect(ids.size).toBe(1);
    expect(inserted).toHaveLength(1);
  });

  it('redirect_uris order does not matter — normalized before compare', async () => {
    const a = await registerClient({ ...CLAUDE, redirect_uris: ['https://a/cb', 'https://b/cb'] });
    const b = await registerClient({ ...CLAUDE, redirect_uris: ['https://b/cb', 'https://a/cb'] });
    expect(b.client_id).toBe(a.client_id);
    expect(inserted).toHaveLength(1);
  });

  it('a DIFFERENT client (Cursor, other redirect) gets its own client_id', async () => {
    const claude = await registerClient(CLAUDE);
    const cursor = await registerClient({ client_name: 'Cursor', redirect_uris: ['cursor://cb'], scope: 'mcp' });
    expect(cursor.client_id).not.toBe(claude.client_id);
    expect(inserted).toHaveLength(2);
  });

  it('a different scope is a different client', async () => {
    const a = await registerClient(CLAUDE);
    const b = await registerClient({ ...CLAUDE, scope: 'mcp offline_access' });
    expect(b.client_id).not.toBe(a.client_id);
    expect(inserted).toHaveLength(2);
  });
});
