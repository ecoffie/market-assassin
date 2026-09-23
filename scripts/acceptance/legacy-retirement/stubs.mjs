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
 *                 Fixture rows the app WRITES (e.g. a 2FA code) are kept in memory and served
 *                 back to the app, so multi-step flows work without touching production.
 *  3. fake GoTrue — ALL /auth/v1/* traffic is answered locally (never forwarded). Fixture users
 *                 can sign in with a password, a magic link (generate_link → verify), or the
 *                 Google OAuth PKCE round-trip. Google's own consent screen is the one step that
 *                 is simulated: /authorize immediately returns `?code=` for the chosen identity.
 *  4. fake Resend — captures outgoing mail (magic links, 2FA codes) so the test can read them.
 *                 Nothing is delivered.
 */
import http from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
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

function b64url(x) { return Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url'); }

/**
 * @param {number} port
 * @param {string} upstream  real Supabase URL (GET/HEAD reads only)
 * @param {{ jwtSecret: string, authUsers: Record<string, {password?: string, provider?: string}> }} auth
 */
export function startReadOnlySupabase(port, upstream, auth) {
  const stats = { forwardedReads: 0, fixtureServed: 0, absorbedWrites: 0, forwardedWrites: 0, absorbed: [], auth: [] };
  const target = new URL(upstream);
  const written = new Map();            // table -> rows written by the app for fixture identities
  const users = new Map();              // email -> auth user (created on first sign-in / admin create)
  const tokens = new Map();             // access/refresh token -> email
  const codes = new Map();              // pkce auth code / magic token -> email
  const control = { googleIdentity: null };

  const ensureUser = (email, provider = 'email') => {
    let u = users.get(email);
    if (!u) {
      u = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider, providers: [provider] }, user_metadata: {}, created_at: new Date().toISOString(), identities: [] };
      users.set(email, u);
    }
    return u;
  };
  for (const [email, a] of Object.entries(auth.authUsers || {})) if (a.password || a.provider) ensureUser(email, a.provider || 'email');

  const jwt = (u) => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64url({ alg: 'HS256', typ: 'JWT' });
    const body = b64url({ sub: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', exp: now + 3600, iat: now, app_metadata: u.app_metadata, user_metadata: {} });
    const sig = createHmac('sha256', auth.jwtSecret).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  };
  const session = (email, provider) => {
    const u = ensureUser(email, provider);
    const access_token = jwt(u); const refresh_token = randomBytes(16).toString('hex');
    tokens.set(access_token, email); tokens.set(refresh_token, email);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token, user: u };
  };

  const json = (res, status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...extra }); res.end(body === undefined ? '' : JSON.stringify(body)); };

  function handleAuth(req, res, url, body, cors) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    const q = url.searchParams;
    const parsed = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    stats.auth.push(`${req.method} ${path}${q.get('grant_type') ? `?grant_type=${q.get('grant_type')}` : ''}`);
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

    if (path === '/settings') return json(res, 200, { external: { google: true, azure: true, email: true }, disable_signup: false }, cors);
    if (path === '/authorize') {
      // Google/Microsoft consent is the one simulated step: consent granted as the chosen identity.
      const email = control.googleIdentity;
      const redirect = new URL(q.get('redirect_to') || 'http://localhost/');
      if (!email) { redirect.searchParams.set('error', 'access_denied'); return json(res, 302, undefined, { location: redirect.toString(), ...cors }); }
      const provider = q.get('provider') || 'google';
      if (q.get('code_challenge')) {
        // PKCE flow: GoTrue returns ?code= for the client to exchange.
        const code = randomUUID(); codes.set(code, { email, provider });
        redirect.searchParams.set('code', code);
        return json(res, 302, undefined, { location: redirect.toString(), ...cors });
      }
      // Implicit flow (supabase-js default): GoTrue returns the session in the URL fragment.
      const sess = session(email, provider);
      const frag = new URLSearchParams({ access_token: sess.access_token, expires_in: '3600', expires_at: String(sess.expires_at), refresh_token: sess.refresh_token, token_type: 'bearer', provider_token: 'acceptance' });
      return json(res, 302, undefined, { location: `${redirect.toString()}#${frag}`, ...cors });
    }
    if (path === '/token') {
      const grant = q.get('grant_type');
      if (grant === 'password') {
        const email = String(parsed.email || '').toLowerCase();
        const a = auth.authUsers?.[email];
        if (!a?.password || a.password !== parsed.password) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' }, cors);
        return json(res, 200, session(email, 'email'), cors);
      }
      if (grant === 'pkce') {
        const c = codes.get(parsed.auth_code); if (!c) return json(res, 400, { error: 'invalid_grant', error_description: 'invalid flow state' }, cors);
        codes.delete(parsed.auth_code); return json(res, 200, session(c.email, c.provider), cors);
      }
      if (grant === 'refresh_token') {
        const email = tokens.get(parsed.refresh_token); if (!email) return json(res, 400, { error: 'invalid_grant' }, cors);
        return json(res, 200, session(email, users.get(email)?.app_metadata?.provider), cors);
      }
      return json(res, 400, { error: 'unsupported_grant_type' }, cors);
    }
    if (path === '/user' && req.method === 'GET') {
      const email = tokens.get(bearer); if (!email) return json(res, 401, { code: 401, msg: 'invalid JWT' }, cors);
      return json(res, 200, users.get(email), cors);
    }
    if (path === '/verify' && req.method === 'GET') {
      const t = codes.get(q.get('token')); const redirect = q.get('redirect_to') || 'http://localhost/';
      if (!t) return json(res, 303, undefined, { location: `${redirect}#error=access_denied&error_description=expired`, ...cors });
      codes.delete(q.get('token'));
      const sess = session(t.email, t.provider);
      const frag = new URLSearchParams({ access_token: sess.access_token, expires_in: '3600', expires_at: String(sess.expires_at), refresh_token: sess.refresh_token, token_type: 'bearer', type: t.type || 'magiclink' });
      return json(res, 303, undefined, { location: `${redirect}#${frag}`, ...cors });
    }
    if (path === '/logout') return json(res, 204, undefined, cors);
    if (path === '/admin/users' && req.method === 'GET') {
      // Never list real users: only fixture identities exist here.
      return json(res, 200, { users: [...users.values()], aud: 'authenticated' }, { 'x-total-count': String(users.size), ...cors });
    }
    if (path === '/admin/users' && req.method === 'POST') {
      const email = String(parsed.email || '').toLowerCase();
      if (!email.endsWith(`@${FIXTURE_DOMAIN}`)) return json(res, 422, { msg: 'acceptance harness: only fixture identities' }, cors);
      return json(res, 200, ensureUser(email), cors);
    }
    if (path.startsWith('/admin/users/') && req.method === 'GET') {
      const u = [...users.values()].find((x) => x.id === path.split('/').pop());
      return u ? json(res, 200, u, cors) : json(res, 404, { msg: 'User not found' }, cors);
    }
    if (path === '/admin/generate_link' && req.method === 'POST') {
      const email = String(parsed.email || '').toLowerCase();
      if (!email.endsWith(`@${FIXTURE_DOMAIN}`)) return json(res, 422, { msg: 'acceptance harness: only fixture identities' }, cors);
      const u = ensureUser(email); const token = randomUUID();
      codes.set(token, { email, provider: 'email', type: parsed.type || 'magiclink' });
      // supabase-js sends redirect_to as a QUERY parameter on generate_link.
      const redirectTo = q.get('redirect_to') || parsed.redirect_to || parsed.options?.redirectTo;
      if (!redirectTo) return json(res, 400, { msg: 'acceptance harness: generate_link without redirect_to' }, cors);
      const action_link = `http://127.0.0.1:${port}/auth/v1/verify?token=${token}&type=${parsed.type || 'magiclink'}&redirect_to=${encodeURIComponent(redirectTo)}`;
      return json(res, 200, { ...u, action_link, email_otp: '000000', hashed_token: token, redirect_to: redirectTo, verification_type: parsed.type || 'magiclink' }, cors);
    }
    return json(res, 404, { msg: `acceptance harness: auth path not modelled: ${path}` }, cors);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const decoded = decodeURIComponent(req.url || '');
    const fixtureEmail = findFixtureEmail(decoded);
    const isRest = decoded.startsWith('/rest/v1/') && !decoded.startsWith('/rest/v1/rpc/');
    const table = isRest ? decoded.slice('/rest/v1/'.length).split(/[?/]/)[0] : null;
    const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    const cors = {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range, x-total-count',
      'access-control-allow-credentials': 'true',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    const body = await readBody(req);

    // 0) Harness control + auth: answered locally, never forwarded.
    if (url.pathname === '/__harness/google-identity') {
      control.googleIdentity = url.searchParams.get('email') || null; return json(res, 200, { ok: true }, cors);
    }
    if (url.pathname.startsWith('/auth/')) return handleAuth(req, res, url, body, cors);

    const bodyEmail = findFixtureEmail(body || '');

    // 1) Fixture identities are served locally and never forwarded — reads AND writes.
    if ((fixtureEmail || bodyEmail) && isRest) {
      stats.fixtureServed++;
      const email = fixtureEmail || bodyEmail;
      if (req.method === 'GET' || req.method === 'HEAD') {
        const extra = (written.get(table) || []).filter((r) => Object.values(r).some((v) => String(v).toLowerCase() === email)).reverse();
        const rows = [...extra, ...supabaseRows(table, email)];
        const headers = { ...cors, 'content-type': 'application/json', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
        if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
        if (wantsObject) {
          if (!rows.length) { res.writeHead(406, headers); return res.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' })); }
          res.writeHead(200, headers); return res.end(JSON.stringify(rows[0]));
        }
        res.writeHead(200, headers); return res.end(JSON.stringify(rows));
      }
      // A write for a fixture identity: kept in memory (so the app can read it back), never forwarded.
      stats.absorbedWrites++;
      stats.absorbed.push(`${req.method} ${decoded.slice(0, 120)}`);
      const list = written.get(table) || [];
      let parsed; try { parsed = JSON.parse(body || 'null'); } catch { parsed = null; }
      let echo = [];
      if (req.method === 'POST') {
        echo = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []).map((r) => ({ id: r.id || randomUUID(), created_at: new Date().toISOString(), ...r }));
        list.push(...echo);
      } else if (req.method === 'PATCH' && parsed && !Array.isArray(parsed)) {
        for (const r of list) if (Object.values(r).some((v) => String(v).toLowerCase() === email)) Object.assign(r, parsed);
        echo = list.filter((r) => Object.values(r).some((v) => String(v).toLowerCase() === email));
      }
      written.set(table, list);
      res.writeHead(201, { ...cors, 'content-type': 'application/json', 'content-range': '*/0' });
      return res.end(JSON.stringify(wantsObject ? (echo[0] || null) : echo));
    }

    // 2) Anything else that is not a plain read is ABSORBED. Nothing is forwarded.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      stats.absorbedWrites++;
      stats.absorbed.push(`${req.method} ${decoded.slice(0, 120)}`);
      const echo = (() => { try { const j = JSON.parse(body || 'null'); return Array.isArray(j) ? j : j ? [j] : []; } catch { return []; } })();
      res.writeHead(201, { ...cors, 'content-type': 'application/json', 'content-range': '*/0' });
      return res.end(JSON.stringify(wantsObject ? (echo[0] || null) : echo));
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
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, stats, control, users, written })));
}

/** Captures outgoing mail at the Resend API shape. Nothing is delivered anywhere. */
export function startFakeResend(port) {
  const outbox = [];
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch { /* ignore */ }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const m of list) outbox.push({ to: [].concat(m.to || []).join(','), subject: m.subject, html: m.html || '', text: m.text || '', at: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(Array.isArray(parsed) ? { data: list.map(() => ({ id: randomUUID() })) } : { id: randomUUID() }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, outbox })));
}
