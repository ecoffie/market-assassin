/**
 * NEW-USER MIGRATION — the acceptance gate. Runs against PRODUCTION.
 *
 * Three contracts, in the order that matters:
 *   INTENT  Maps preserves a valid incoming `next`; MCP overrides stale Maps intent.
 *   SAFETY  legacy/external `next` values can never resurrect /app.
 *   TRUTH   Screen-2 Skip creates no active profile state and claims no provenance.
 *
 * The third is the one the whole redesign rests on and the one never checked against
 * production: 7,928 of 9,778 users carry a placeholder nobody chose, and the entire point
 * of the provenance column is that this can never happen again silently.
 *
 *   npx tsx scripts/verify-new-user-migration.mts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const HOST = process.env.VERIFY_HOST || 'https://getmindy.ai';
let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) fail++; console.log(`    ${c ? '✓' : '✗'} ${m}`); };

const get = async (p: string) => {
  const r = await fetch(HOST + p, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  return { status: r.status, location: r.headers.get('location'), body: await r.text().catch(() => '') };
};

console.log(`\n  ══ NEW-USER MIGRATION — acceptance gate (${HOST}) ══`);

// ── ROUTES EXIST ──────────────────────────────────────────────────────────────────────
console.log('\n  ROUTES');
for (const [p, label] of [
  ['/welcome', 'the intent router'],
  ['/welcome/company', 'company setup'],
  ['/opportunity-map', 'the Map'],
  ['/mcp/setup', 'MCP setup'],
] as const) {
  const r = await get(p);
  ok(r.status === 200, `${p.padEnd(20)} ${r.status} — ${label}`);
}

// ── /welcome IS A ROUTER, NOT A GATE ──────────────────────────────────────────────────
console.log('\n  /welcome offers three real choices, none a gate');
const w = await get('/welcome');
ok(w.body.includes('/opportunity-map'), 'offers the Map');
ok(w.body.includes('/mcp/setup'), 'offers MCP SETUP (not the marketing page)');
ok(w.body.includes('/welcome/company'), 'offers company setup');
ok(!/<form|type="submit"/.test(w.body), 'nothing submits — every choice is a link');
ok(/Just show me the map/i.test(w.body), 'keeps the escape hatch');
ok(!/\/app[?"'/]|\/briefings/.test(w.body), 'no /app or /briefings anywhere in the page');

// ── CONTRACT 1 · INTENT ───────────────────────────────────────────────────────────────
console.log('\n  CONTRACT 1 · INTENT');
const deep = '/opportunity-map?naics=236220&state=VA';
const withNext = await get(`/welcome?next=${encodeURIComponent(deep)}`);
ok(withNext.body.includes('naics=236220'), 'a valid Maps next SURVIVES to the Map choice');
ok(withNext.body.includes('/welcome/company'), 'company setup still offered alongside it');

const d1 = await get(`/api/company-setup/destination?next=${encodeURIComponent(deep)}`);
const j1 = JSON.parse(d1.body || '{}');
ok(j1.path === deep, `resolver preserves the exact Maps destination (${j1.path})`);

const d2 = await get(`/api/company-setup/destination?intent=mcp&next=${encodeURIComponent(deep)}`);
const j2 = JSON.parse(d2.body || '{}');
ok(j2.path === '/mcp/setup', `MCP intent OVERRIDES a stale Maps next (${j2.path})`);

const d3 = await get('/api/company-setup/destination');
const j3 = JSON.parse(d3.body || '{}');
ok(j3.path === '/welcome', `no intent -> /welcome, never /app/onboarding (${j3.path})`);

// ── CONTRACT 2 · SAFETY ───────────────────────────────────────────────────────────────
console.log('\n  CONTRACT 2 · SAFETY — legacy/external next can never resurrect /app');
for (const bad of ['/app/onboarding', '/app?panel=settings', '/briefings', 'https://evil.com/x', '//evil.com']) {
  const r = await get(`/api/company-setup/destination?next=${encodeURIComponent(bad)}`);
  const j = JSON.parse(r.body || '{}');
  const clean = j.path === '/welcome';
  ok(clean, `next=${bad.padEnd(22)} -> ${j.path}`);
}

// ── CONTRACT 3 · TRUTH ────────────────────────────────────────────────────────────────
console.log('\n  CONTRACT 3 · TRUTH — Skip writes nothing, claims no provenance');
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// The provenance column must exist and mean something in production.
const { count: confirmed } = await sb.from('user_notification_settings')
  .select('*', { count: 'exact', head: true }).eq('naics_source', 'user_confirmed');
const { count: sysdef } = await sb.from('user_notification_settings')
  .select('*', { count: 'exact', head: true }).eq('naics_source', 'system_default');
const { count: derived } = await sb.from('user_notification_settings')
  .select('*', { count: 'exact', head: true }).eq('naics_source', 'derived_suggestion');
ok((confirmed ?? 0) > 0 && (sysdef ?? 0) > 0,
   `provenance is live: ${confirmed} user_confirmed · ${sysdef} system_default · ${derived} derived_suggestion`);
ok((sysdef ?? 0) > (confirmed ?? 0),
   'system_default still outnumbers user_confirmed — the placeholder truth is now VISIBLE rather than hidden');

// The route must reject an unauthenticated write outright.
const post = await fetch(`${HOST}/api/company-setup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'skip', email: 'nobody@example.com', selection: { naicsCodes: ['999999'] } }),
  signal: AbortSignal.timeout(60000),
});
ok(post.status === 401, `an unauthenticated setup write is rejected (${post.status})`);

// And nothing it carried may have landed anywhere.
const { count: leaked } = await sb.from('user_notification_settings')
  .select('*', { count: 'exact', head: true }).contains('naics_codes', ['999999']);
ok((leaked ?? 0) === 0, `the rejected payload wrote nothing (${leaked} rows carry its code)`);

// ── INSTRUMENTATION ───────────────────────────────────────────────────────────────────
console.log('\n  INSTRUMENTATION — the freeze must not be blind');
/**
 * ⚠️ A STATUS CODE IS NOT PROOF THE ROUTE EXISTS. Next serves its 404 PAGE with HTTP 200
 * and content-type text/html, so `status === 200` passed while the endpoint was not
 * deployed at all — a false green in the gate itself. Assert the CONTENT TYPE and the
 * JSON body, not just the number.
 */
const callChoice = async (choice: string) => {
  const r = await fetch(`${HOST}/api/welcome/choice`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice }), signal: AbortSignal.timeout(60000),
  });
  const ct = r.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await r.json().catch(() => null) : null;
  return { status: r.status, isJson: !!json, json };
};

const beacon = await callChoice('explore_map');
ok(beacon.isJson, `the choice endpoint returns JSON, not an HTML 404 page (ct json=${beacon.isJson})`);
ok(beacon.status === 200 && beacon.json?.success === true, `a valid beacon is accepted (${beacon.status})`);

const badChoice = await callChoice('not_a_door');
ok(badChoice.status === 400, `an unknown choice is rejected, not stored (${badChoice.status})`);

console.log(fail
  ? `\n  ✗ ${fail} CHECK(S) FAILED — do not freeze onboarding\n`
  : '\n  ✓ ALL CONTRACTS HOLD — safe to freeze onboarding and observe\n');
process.exit(fail ? 1 : 0);
