/**
 * Prove a route is ACTUALLY live — the ritual, scripted.
 *
 * Replaces the hand-rolled `curl -s -o /dev/null -w "%{http_code}"` + eyeball that
 * ran 337 times across the last month of sessions. Encodes CLAUDE.md rule #2:
 * **"It compiles" ≠ "it works." A 200 with 0 rows is a FAIL, not a pass.**
 *
 * Run:
 *   npm run verify:live -- /api/app/target-market-research
 *   npm run verify:live -- /reports/abc123 --expect-text "Powered by"
 *   npm run verify:live -- /api/x --post '{"a":1}' --min-rows 5
 *   npm run verify:live -- /api/x /api/y /healthz          (several at once)
 *
 * Flags:
 *   --host <h>          default getmindy.ai
 *   --post <json>       POST with this body (default GET)
 *   --expect <code>     expected status (default 200)
 *   --min-rows <n>      fail unless the payload has >= n rows (default: 1 for /api/*)
 *   --expect-text <s>   fail unless the body contains this string
 *   --no-rows           it's a page/HTML — don't require rows
 *   --json              machine-readable output
 *   --timeout <ms>      default 30000
 *
 * Exit code 0 = every target passed. 1 = at least one failed (so it can gate a deploy).
 */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const HOST = (flag('host', 'getmindy.ai')).replace(/^https?:\/\//, '').replace(/\/$/, '');
const EXPECT = Number(flag('expect', '200'));
const TIMEOUT = Number(flag('timeout', '30000'));
const POST = flag('post');
const EXPECT_TEXT = flag('expect-text');
const JSON_OUT = has('json');
const NO_ROWS = has('no-rows');
const MIN_ROWS_FLAG = flag('min-rows');

// Bare (non-flag) args are the paths. Skip any token consumed as a flag value.
const consumed = new Set();
for (const n of ['host', 'expect', 'timeout', 'post', 'expect-text', 'min-rows']) {
  const i = args.indexOf(`--${n}`);
  if (i !== -1) { consumed.add(i); consumed.add(i + 1); }
}
const paths = args.filter((a, i) => !consumed.has(i) && !a.startsWith('--'));

if (!paths.length) {
  console.error('usage: npm run verify:live -- <path> [more paths] [--host h] [--post json] [--min-rows n] [--expect-text s] [--no-rows]');
  process.exit(2);
}

/** Find the row-ish array in a payload, whatever it's called. */
function countRows(body) {
  let data;
  try { data = JSON.parse(body); } catch { return null; } // not JSON → not a row check
  if (Array.isArray(data)) return data.length;
  for (const k of ['results', 'data', 'rows', 'items', 'events', 'contractors', 'opportunities', 'agencies', 'forecasts', 'contracts', 'series']) {
    if (Array.isArray(data?.[k])) return data[k].length;
  }
  // Single grounded object (e.g. an MCP tool result) counts as 1 when it says so.
  if (data && typeof data === 'object') {
    if (data._meta?.grounded === true) return 1;
    if (data._meta?.grounded === false) return 0;
    const firstArray = Object.values(data).find((v) => Array.isArray(v));
    if (firstArray) return firstArray.length;
  }
  return null;
}

async function check(path) {
  const url = `https://${HOST}${path.startsWith('/') ? path : `/${path}`}`;
  const isApi = /\/api\//.test(path);
  // A page just needs to render; an API returning 0 rows is the classic false pass.
  const minRows = NO_ROWS ? 0 : Number(MIN_ROWS_FLAG ?? (isApi ? 1 : 0));

  const started = Date.now();
  let res, body = '';
  try {
    res = await fetch(url, {
      method: POST ? 'POST' : 'GET',
      headers: POST ? { 'Content-Type': 'application/json' } : undefined,
      body: POST || undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    body = await res.text();
  } catch (err) {
    return { url, ok: false, status: 0, ms: Date.now() - started, rows: null, reason: `request failed: ${err.message}` };
  }

  const ms = Date.now() - started;
  const rows = countRows(body);
  const fails = [];

  if (res.status !== EXPECT) fails.push(`status ${res.status} (expected ${EXPECT})`);
  if (minRows > 0 && rows !== null && rows < minRows) {
    fails.push(`${rows} rows (expected >= ${minRows}) — a 200 with no rows is a FAIL`);
  }
  if (EXPECT_TEXT && !body.includes(EXPECT_TEXT)) fails.push(`body missing ${JSON.stringify(EXPECT_TEXT)}`);

  return { url, ok: fails.length === 0, status: res.status, ms, rows, bytes: body.length, reason: fails.join(' · ') };
}

const results = [];
for (const p of paths) results.push(await check(p));

if (JSON_OUT) {
  console.log(JSON.stringify({ host: HOST, pass: results.every((r) => r.ok), results }, null, 2));
} else {
  for (const r of results) {
    const mark = r.ok ? '\x1b[32m✓ PASS\x1b[0m' : '\x1b[31m✗ FAIL\x1b[0m';
    const rows = r.rows === null ? '' : ` · ${r.rows} rows`;
    console.log(`${mark}  ${r.status || '---'}  ${String(r.ms).padStart(5)}ms${rows}  ${r.url}`);
    if (!r.ok) console.log(`        ↳ ${r.reason}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n\x1b[31m${failed}/${results.length} FAILED\x1b[0m` : `\n\x1b[32mall ${results.length} passed\x1b[0m`);
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
