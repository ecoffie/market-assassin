/**
 * Fail-closed guards for the scorecard JWT. Never prints the token or bodies
 * that may carry credentials or recommendation text.
 *
 * 1. JWT payload must decode, role must be scorecard_reader, exp must be in
 *    the future (expired → exit 1).
 * 2. PATCH one column on data_source_instances, filtered to a key that does
 *    not exist, with Prefer: tx=rollback. A 2xx means UPDATE is granted →
 *    exit 1. Pass only on HTTP 401/403 with permission denied (42501).
 * 3. SELECT smoke on a granted column must return HTTP 2xx.
 */
const TABLE = 'data_source_instances';
export const PROBE_KEY = '__scorecard_probe_never_exists__';
export const EXPECTED_ROLE = 'scorecard_reader';

/**
 * Local check before any request. Does not verify the signature.
 * A missing token, a token that is not a scorecard_reader JWT, or a token
 * whose exp is absent or in the past never reaches the database.
 */
export function assessCredential(key, now = Date.now()) {
  if (!key || !String(key).trim()) return { ok: false, reason: 'credential is missing' };
  const parts = String(key).split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'credential is rejected' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'credential is rejected' };
  }
  if (!payload || payload.role !== 'scorecard_reader') {
    return { ok: false, reason: 'credential is rejected' };
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now) {
    return { ok: false, reason: 'credential is expired' };
  }
  return { ok: true, reason: null };
}

export function writeProbeRequest(baseUrl) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  return {
    method: 'PATCH',
    url: `${root}/rest/v1/${TABLE}?source_key=eq.${PROBE_KEY}`,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'tx=rollback,return=minimal',
    },
    body: JSON.stringify({ name: PROBE_KEY }),
  };
}

export function selectSmokeRequest(baseUrl) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  return {
    method: 'GET',
    url: `${root}/rest/v1/${TABLE}?select=source_key&limit=1`,
    headers: {
      Accept: 'application/json',
    },
  };
}

/** Decode JWT payload without verifying the signature. */
export function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts[1]) {
    return { ok: false, reason: 'JWT is malformed' };
  }
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, reason: 'JWT payload is not an object' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'JWT payload could not be decoded' };
  }
}

/**
 * Fail closed on missing/expired exp and wrong role claim.
 * @param {string} token
 * @param {{ nowSec?: number }} [opts]
 */
export function classifyJwtClaims(token, opts = {}) {
  const decoded = decodeJwtPayload(token);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  const payload = decoded.payload;
  const role = payload.role;
  if (role !== EXPECTED_ROLE) {
    return { ok: false, reason: 'JWT role claim is not scorecard_reader' };
  }
  const exp = payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return { ok: false, reason: 'JWT exp claim is missing' };
  }
  const nowSec = typeof opts.nowSec === 'number' ? opts.nowSec : Math.floor(Date.now() / 1000);
  if (exp <= nowSec) {
    return { ok: false, reason: 'JWT expired' };
  }
  return { ok: true, reason: 'role and exp ok' };
}

export function classifyWriteAttempt(status, body) {
  const text = String(body ?? '');
  if (typeof status === 'number' && status >= 200 && status < 300) {
    return { ok: false, reason: 'write privilege exists' };
  }
  if (/23502|23514|not-null|null value in column|row-level security/i.test(text)) {
    return { ok: false, reason: 'write privilege reached the table' };
  }
  if ((status === 401 || status === 403) && /42501|permission denied for table/i.test(text)) {
    return { ok: true, reason: 'permission denied' };
  }
  return { ok: false, reason: 'write denial was not proven' };
}

export function classifySelectSmoke(status) {
  if (typeof status === 'number' && status >= 200 && status < 300) {
    return { ok: true, reason: 'select ok' };
  }
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'select was denied' };
  }
  return { ok: false, reason: 'select smoke failed' };
}

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SCORECARD_READONLY_JWT || '';
  const gate = assessCredential(key);
  if (!url || !gate.ok) {
    const reason = !url || gate.reason === 'credential is missing' ? 'credential is missing' : gate.reason;
    console.error(`scorecard numbers are unknown: ${reason}`);
    process.exit(reason === 'credential is missing' ? 2 : 1);
  }

  const claims = classifyJwtClaims(key);
  console.log(`scorecard read-only check: jwt — ${claims.reason}`);
  if (!claims.ok) process.exit(1);

  const authHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };

  const probe = writeProbeRequest(url);
  const writeRes = await fetch(probe.url, {
    method: probe.method,
    headers: {
      ...probe.headers,
      ...authHeaders,
    },
    body: probe.body,
  });
  const writeBody = await writeRes.text();
  const writeVerdict = classifyWriteAttempt(writeRes.status, writeBody);
  if (!writeVerdict.ok) {
    console.error(`scorecard numbers are unknown: ${writeVerdict.reason}`);
    process.exit(1);
  }
  console.log(`scorecard read-only check: write probe http ${writeRes.status} — ${writeVerdict.reason}`);

  const smoke = selectSmokeRequest(url);
  const selectRes = await fetch(smoke.url, {
    method: smoke.method,
    headers: {
      ...smoke.headers,
      ...authHeaders,
    },
  });
  // Discard body — never print row content (could include non-public fields later).
  await selectRes.text();
  const selectVerdict = classifySelectSmoke(selectRes.status);
  if (!selectVerdict.ok) {
    console.error(`scorecard numbers are unknown: ${selectVerdict.reason}`);
    process.exit(1);
  }
  console.log(`scorecard read-only check: select smoke http ${selectRes.status} — ${selectVerdict.reason}`);
}

if (process.argv[1] && process.argv[1].endsWith('scorecard-readonly-check.mjs')) main();
