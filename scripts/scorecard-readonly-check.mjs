/**
 * Prove the scorecard JWT cannot write. Never prints the token.
 *
 * POST {} to data_source_instances. That table's required columns have no
 * defaults, so {} cannot insert a row even if INSERT were granted. A
 * permission-denied response is the pass. A not-null error, an RLS insert
 * error, or any 2xx means the credential can write, and this process exits 1
 * before the scorecard runs.
 */
const TABLE = 'data_source_instances';

export function classifyWriteAttempt(status, body) {
  const text = String(body ?? '');
  if (status === 200 || status === 201 || status === 204) {
    return { ok: false, reason: 'write was accepted' };
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
  const res = await fetch(`${url}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: '{}',
  });
  const body = await res.text();
  const verdict = classifyWriteAttempt(res.status, body);
  console.log(`scorecard read-only check: http ${res.status} — ${verdict.reason}`);
  if (!verdict.ok) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('scorecard-readonly-check.mjs')) main();
