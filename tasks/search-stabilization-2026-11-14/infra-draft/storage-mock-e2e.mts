/**
 * Storage path, end to end, WITHOUT touching production storage (Agent 3, 2026-11-16).
 * Real client for sam_opportunities reads (read-only); `client.storage` replaced by an in-memory bucket.
 * Exercises the REAL writer (writeOpenSnapshot via supabaseSnapshotStore), the REAL loader (startLoad → loadOpenSnapshot),
 * the refusals (missing bucket, public bucket, corrupted object), and FIND parity storage-vs-SQL.
 * Run from the worktree root: npx tsx tasks/search-stabilization-2026-11-14/infra-draft/storage-mock-e2e.mts <phrasings.json>
 */
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/ericcoffie/Projects/market-assassin/.env.local', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '').replace(/\\n$/, '')]; }));
const { createClient } = await import('@supabase/supabase-js');
const oc = await import('@/lib/opportunities/open-cache');
const st = await import('@/lib/opportunities/open-snapshot-store');
const { findOpportunities } = await import('@/lib/opportunities/find-opportunities');

const objects = new Map<string, Buffer>();
const bucket = { exists: true, public: false };
const memStorage = {
  getBucket: async (name: string) => (name === st.OPEN_SNAPSHOT_BUCKET && bucket.exists ? { data: { name, public: bucket.public }, error: null } : { data: null, error: { message: 'not found' } }),
  from: (name: string) => ({
    upload: async (p: string, b: Buffer) => { if (!bucket.exists || name !== st.OPEN_SNAPSHOT_BUCKET) return { error: { message: 'no bucket' } }; objects.set(p, Buffer.from(b)); return { error: null }; },
    download: async (p: string) => { const b = objects.get(p); return b ? { data: new Blob([new Uint8Array(b)]), error: null } : { data: null, error: { message: 'not found' } }; },
  }),
};
const real = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const client = new Proxy(real as any, { get: (t, k) => (k === 'storage' ? memStorage : t[k]) });
const store = st.supabaseSnapshotStore(client);
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) process.exitCode = 1; };

// Writer
let t = Date.now(); const snap = await oc.buildOpenSnapshot(client); const buildMs = Date.now() - t;
const w = await st.writeOpenSnapshot(store, snap);
check('writer: build + upload to private bucket', objects.has(st.OPEN_SNAPSHOT_OBJECT), `rows ${snap.count}, build ${buildMs} ms, gzip ${(w.gzipBytes / 1048576).toFixed(1)} MB`);
// Loader
t = Date.now(); const loaded = await st.loadOpenSnapshot(store);
check('loader: download + verify checksum', !!loaded && loaded.count === snap.count && loaded.builtAt === snap.builtAt, `${Date.now() - t} ms`);
// Refusals
bucket.public = true; check('refuses PUBLIC bucket (read)', (await st.loadOpenSnapshot(store)) === null);
let threw = false; try { await st.writeOpenSnapshot(store, snap); } catch { threw = true; } check('refuses PUBLIC bucket (write)', threw); bucket.public = false;
bucket.exists = false; check('refuses MISSING bucket', (await st.loadOpenSnapshot(store)) === null); bucket.exists = true;
const good = objects.get(st.OPEN_SNAPSHOT_OBJECT)!; const bad = Buffer.from(good); bad[bad.length - 20] ^= 0xff; objects.set(st.OPEN_SNAPSHOT_OBJECT, bad);
check('refuses CORRUPTED object', (await st.loadOpenSnapshot(store)) === null); objects.set(st.OPEN_SNAPSHOT_OBJECT, good);

// FIND through the real holder with source=storage
process.env.OPEN_SNAPSHOT_SOURCE = 'storage'; oc.__allowUnhardenedSeamForTests(true); oc.__setOpenSnapshotForTests(null);
oc.currentOpenSnapshot(client); await oc.pendingOpenSnapshotLoad();
check('holder loads from storage', !!oc.currentOpenSnapshot(client));
const qs: string[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const run = async (q: string, cached: boolean) => { process.env.OPEN_SNAPSHOT_RETRIEVAL = cached ? 'true' : 'false';
  const r = await findOpportunities({ query: q, limit_per_horizon: 25, horizons: { open_now: true, coming_back: false, coming_soon: false } }, { client });
  const h = r.horizons.open_now as any; return { count: h.matched_count, path: h.retrieval?.path, err: h.error?.class ?? null, ids: (h.items || []).map((i: any) => i.notice_id) }; };
for (const q of qs) { const c = await run(q, true); const s = await run(q, false);
  const same = !s.err && c.count === s.count && c.ids.length === s.ids.length && c.ids.every((x: string, i: number) => x === s.ids[i]);
  check(`FIND storage-vs-SQL: ${q.slice(0, 40)}`, c.path === 'snapshot' && (same || !!s.err), s.err ? `SQL ${s.err}; cache answered ${c.count}` : `count ${c.count}`); }
