#!/usr/bin/env node
/**
 * WEBINAR ACCEPTANCE — run this against PRODUCTION before going on stage.
 *
 * The rule under test: an attendee typing their own UEI must NEVER be told their
 * company does not exist because OUR upstream failed.
 *
 *   node scripts/verify-uei-webinar.mjs
 *   node scripts/verify-uei-webinar.mjs --host https://getmindy.ai
 */
const HOST = (process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host')+1] : 'https://getmindy.ai').replace(/\/$/,'');
let fail = 0;
const ok = (c,m)=>{ if(!c) fail++; console.log(`  ${c?'✓':'✗'} ${m}`); };

const get = async (path) => {
  const r = await fetch(HOST+path, { signal: AbortSignal.timeout(60000) });
  let body = {}; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

console.log(`\n  ══ UEI WEBINAR ACCEPTANCE — ${HOST} ══\n`);

// 1. A real, registered company resolves.
const real = await get('/api/entity-lookup?uei=C126Y284ZBC6');
ok(real.status === 200, `real UEI → HTTP ${real.status} (expect 200)`);
ok(real.body?.entity?.name, `returns a company name: ${real.body?.entity?.name || '(none)'}`);
if (real.body?.degraded) console.log(`      ⚠️ served DEGRADED from local, as of ${real.body.asOf} — live SAM is down right now`);
else console.log(`      source=${real.body?.source ?? 'n/a'} (live SAM healthy)`);

// 2. A malformed UEI is a 400 with client-side wording — never 404 "not found",
//    and never a SAM call.
const bad = await get('/api/entity-lookup?uei=TOOSHORT');
ok(bad.status === 400, `malformed UEI → HTTP ${bad.status} (expect 400, NOT 404)`);
ok(/12 letters and numbers/i.test(bad.body?.error || ''), `explains the format: "${bad.body?.error || ''}"`);

// 3. A genuinely absent UEI is an honest 404.
const absent = await get('/api/entity-lookup?uei=ZZZZZZZZZZZZ');
ok([404,503].includes(absent.status), `absent UEI → HTTP ${absent.status} (404 real absence, or 503 if SAM is down)`);
if (absent.status === 404) ok(absent.body?.resolution === 'not_found', `labelled not_found`);
if (absent.status === 503) console.log(`      (SAM unavailable — correctly refusing to assert absence)`);

// 4. THE CORE GUARANTEE: no response may ever call a well-formed UEI invalid,
//    or tell the user to go re-register, on the strength of an upstream failure.
console.log('\n  the sentences that must never appear for a well-formed UEI:');
const FORBIDDEN = [/invalid uei/i, /not registered in sam/i, /does not exist/i, /register at sam\.gov first/i];
for (const [label, res] of [['real', real], ['absent-during-outage', absent]]) {
  const text = JSON.stringify(res.body);
  const hit = FORBIDDEN.find((re) => re.test(text));
  // "register at sam.gov first" IS legitimate on a true 404 — but never on a 503.
  const legit = res.status === 404 && /register at sam\.gov first/i.test(text);
  ok(!hit || legit, `${label}: ${hit && !legit ? `LEAKED ${hit}` : 'clean'}`);
}

// 5. The onboarding path must behave the same way (auth-gated, so we assert it
//    does NOT 404 with re-register advice when the gate is what stopped us).
const vault = await get('/api/app/vault/prefill?uei=C126Y284ZBC6&email=probe@example.com');
ok(vault.status !== 404 || vault.body?.resolution === 'not_found',
   `vault/prefill → HTTP ${vault.status} (a 404 must be a REAL not_found, not an outage)`);

console.log(fail ? `\n  ✗ ${fail} CHECK(S) FAILED — do not demo this\n` : `\n  ✓ SAFE TO DEMO\n`);
process.exit(fail ? 1 : 0);
