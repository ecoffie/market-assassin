/**
 * Prove the scorecard JWT cannot write. Never prints the token or the body.
 *
 * PATCH one column on data_source_instances, filtered to a key that does not
 * exist, with Prefer: tx=rollback. Zero rows match, and the transaction is
 * rolled back even if the filter were wrong. A 2xx (including zero rows)
 * means UPDATE is granted, and this process exits 1. The only pass is
 * HTTP 401 or 403 with permission denied (42501).
 */
const TABLE = 'data_source_instances';
export const PROBE_KEY = '__scorecard_probe_never_exists__';

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

async function main() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SCORECARD_READONLY_JWT || '';
  if (!url || !key) {
    console.error('scorecard read-only check: credential is not configured');
    process.exit(2);
  }
  const probe = writeProbeRequest(url);
  const res = await fetch(probe.url, {
    method: probe.method,
    headers: {
      ...probe.headers,
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: probe.body,
  });
  const body = await res.text();
  const verdict = classifyWriteAttempt(res.status, body);
  console.log(`scorecard read-only check: http ${res.status} — ${verdict.reason}`);
  if (!verdict.ok) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('scorecard-readonly-check.mjs')) main();
