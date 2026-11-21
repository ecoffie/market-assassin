/**
 * Resolve-time stand-in for `@supabase/supabase-js` in the unit suite.
 *
 * Wired via vitest `resolve.alias`. Measured 2026-11-21: after KV was stubbed,
 * remaining pre-push hangs were undici → krpyelfrbicmvsmwovti.supabase.co from
 * createClient callers that unit files never mocked (agency-intelligence store,
 * mcp last-good setCached on find_capable warm path, opportunities/save past the
 * Pro gate). A chainable thenable returns empty success so those paths finish
 * without network.
 *
 * Tests that assert DB behavior still `vi.mock('@supabase/supabase-js', …)` and
 * override this.
 */

type Result = { data: unknown; error: null; count: number };

function chain(result: Result = { data: null, error: null, count: 0 }) {
  const api: Record<string, unknown> = {};
  const passthrough = () => api;
  for (const m of [
    'select', 'insert', 'upsert', 'update', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains',
    'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent',
    'overlaps', 'textSearch', 'match', 'not', 'or', 'filter',
    'order', 'limit', 'range', 'abortSignal', 'csv', 'geojson',
  ]) {
    api[m] = passthrough;
  }
  api.single = async () => result;
  api.maybeSingle = async () => result;
  api.then = (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return api;
}

export function createClient(_url?: string, _key?: string, _opts?: unknown) {
  return {
    from: (_table?: string) => chain(),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  };
}

export default { createClient };
