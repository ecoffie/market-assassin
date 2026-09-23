/**
 * Two local servers that let a dev build of Mindy run against production READS with ZERO
 * production WRITES:
 *
 *  1. fakeKv    — speaks the Upstash REST protocol that @vercel/kv uses. Seeded with the
 *                 fixture entitlements; every write lands in memory and is discarded. The real
 *                 KV is never contacted, so rate limits / usage counters cannot touch it.
 *  2. roSupabase — a proxy in front of the real Supabase project:
 *                   • any request that names a fixture identity (@acceptance.invalid) is served
 *                     from fixtures.mjs and NEVER forwarded;
 *                   • GET/HEAD for anything else is forwarded (a read);
 *                   • every other method (POST/PATCH/PUT/DELETE, RPC, auth, storage) is
 *                     ABSORBED locally and counted — none is forwarded.
 *                 `stats()` reports forwarded reads vs absorbed writes so the run can prove
 *                 "0 writes forwarded".
 */
import http from 'node:http';
import { supabaseRows, FIXTURES, FIXTURE_DOMAIN } from './fixtures.mjs';

// Match the KNOWN fixture emails exactly. A pattern like /[a-z0-9._+-]+@domain/ would swallow
// PostgREST's own operator prefix (`user_email=eq.paid-briefings@…` → "eq.paid-briefings@…").
const FIXTURE_EMAILS = Object.values(FIXTURES).map((f) => f.email.toLowerCase());
const findFixtureEmail = (decoded) => {
  const lower = decoded.toLowerCase();
  if (!lower.includes(`@${FIXTURE_DOMAIN}`)) return undefined;
  return FIXTURE_EMAILS.find((e) => lower.includes(e)) || `unknown@${FIXTURE_DOMAIN}`;
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export function startFakeKv(port, seed) {
  const store = new Map(Object.entries(seed));
  const log = { commands: 0, writes: 0 };
  const b64 = (v) => (typeof v === 'string' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(b64) : v);
  const WRITE = new Set(['set', 'del', 'incr', 'incrby', 'decr', 'expire', 'pexpire', 'hset', 'hincrby', 'sadd', 'srem', 'zadd', 'zincrby', 'zrem', 'lpush', 'rpush', 'ltrim', 'setex', 'getdel', 'hdel', 'persist']);

  function run(cmd) {
    const [name, ...args] = cmd.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    const op = String(name).toLowerCase();
    log.commands++;
    if (WRITE.has(op)) log.writes++;
    const k = args[0];
    switch (op) {
      case 'get': return store.has(k) ? store.get(k) : null;
      case 'mget': return args.map((x) => (store.has(x) ? store.get(x) : null));
      case 'set': case 'setex': store.set(k, op === 'setex' ? args[2] : args[1]); return 'OK';
      case 'del': { let n = 0; for (const x of args) n += store.delete(x) ? 1 : 0; return n; }
      case 'exists': return args.filter((x) => store.has(x)).length;
      case 'incr': case 'incrby': case 'decr': {
        const by = op === 'incr' ? 1 : op === 'decr' ? -1 : Number(args[1]);
        const v = Number(store.get(k) || 0) + by; store.set(k, String(v)); return v;
      }
      case 'expire': case 'pexpire': case 'persist': return 1;
      case 'ttl': case 'pttl': return store.has(k) ? -1 : -2;
      case 'keys': case 'smembers': case 'lrange': case 'zrange': case 'hkeys': return [];
      case 'hgetall': return [];
      case 'hget': case 'getdel': return null;
      case 'sismember': case 'scard': case 'llen': case 'hset': case 'hdel': case 'sadd': case 'srem':
      case 'zadd': case 'zrem': case 'lpush': case 'rpush': case 'hincrby': case 'zincrby': return 0;
      case 'ltrim': case 'ping': return 'OK';
      default: return null; // eval/evalsha etc: an unknown answer; KV callers fail open by design
    }
  }

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const encode = String(req.headers['upstash-encoding'] || '').toLowerCase() === 'base64';
    const wrap = (result) => ({ result: encode ? b64(result) : result });
    let payload;
    try {
      const parsed = body ? JSON.parse(body) : [];
      if (req.url.startsWith('/pipeline') || req.url.startsWith('/multi-exec')) {
        const out = parsed.map((c) => wrap(run(c)));
        payload = req.url.startsWith('/multi-exec') ? out : out;
      } else {
        payload = wrap(run(parsed));
      }
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: String(e) }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, log, store })));
}

export function startReadOnlySupabase(port, upstream) {
  const stats = { forwardedReads: 0, fixtureServed: 0, absorbedWrites: 0, forwardedWrites: 0, absorbed: [] };
  const target = new URL(upstream);

  const server = http.createServer(async (req, res) => {
    const decoded = decodeURIComponent(req.url || '');
    const fixtureEmail = findFixtureEmail(decoded);
    const isRest = decoded.startsWith('/rest/v1/') && !decoded.startsWith('/rest/v1/rpc/');
    const table = isRest ? decoded.slice('/rest/v1/'.length).split(/[?/]/)[0] : null;
    const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    const cors = {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    const body = await readBody(req);

    // 1) Fixture identities are served locally and never forwarded — reads or writes.
    if (fixtureEmail && isRest && (req.method === 'GET' || req.method === 'HEAD')) {
      stats.fixtureServed++;
      const rows = supabaseRows(table, fixtureEmail);
      const headers = { ...cors, 'content-type': 'application/json', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
      if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
      if (wantsObject) {
        if (!rows.length) { res.writeHead(406, headers); return res.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' })); }
        res.writeHead(200, headers); return res.end(JSON.stringify(rows[0]));
      }
      res.writeHead(200, headers); return res.end(JSON.stringify(rows));
    }

    // 2) Anything that is not a plain read is ABSORBED. Nothing is forwarded.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      stats.absorbedWrites++;
      stats.absorbed.push(`${req.method} ${decoded.slice(0, 120)}`);
      const echo = (() => { try { const j = JSON.parse(body || 'null'); return Array.isArray(j) ? j : j ? [j] : []; } catch { return []; } })();
      const isAuth = decoded.startsWith('/auth/');
      res.writeHead(isAuth ? 400 : 201, { ...cors, 'content-type': 'application/json', 'content-range': '*/0' });
      return res.end(JSON.stringify(isAuth ? { error: 'absorbed_by_acceptance_proxy' } : wantsObject ? (echo[0] || null) : echo));
    }

    // 3) A genuine read — forward it.
    stats.forwardedReads++;
    const headers = { ...req.headers, host: target.host };
    delete headers['content-length'];
    const upstreamRes = await fetch(new URL(req.url, target), { method: req.method, headers }).catch((e) => ({ error: e }));
    if (upstreamRes.error) { res.writeHead(502, cors); return res.end(); }
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    const out = { ...cors };
    for (const h of ['content-type', 'content-range']) { const v = upstreamRes.headers.get(h); if (v) out[h] = v; }
    res.writeHead(upstreamRes.status, out);
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, stats })));
}
