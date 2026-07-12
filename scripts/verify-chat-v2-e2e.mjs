/**
 * PHASE 1 E2E VERIFY — Mindy Chat v2 Tier-0 tools against the LIVE local route.
 *
 * Drives POST /api/app/chat with a real signed session token (minted the same
 * way login does, via createTwoFactorSessionToken) and asserts the PRD §7
 * acceptance criteria:
 *   1. A pipeline question returns the caller's REAL rows (grounded, not hallucinated).
 *   2. ISOLATION: user A's chat never surfaces user B's pursuits.
 *   3. NO-REGRESSION: a teaching question still answers (RAG path intact).
 *   4. NO-FABRICATION: a user with an empty pipeline is told they have none.
 *
 * Requires: dev server running on $BASE (default http://localhost:3000) and
 * ADMIN_PASSWORD/TWO_FACTOR_SECRET in .env.local (for token signing).
 *
 * Usage:  node scripts/verify-chat-v2-e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:3000';

// --- load signing secret from .env.local ---
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const SECRET = env.TWO_FACTOR_SECRET || env.ADMIN_PASSWORD;
if (!SECRET) { console.error('❌ no TWO_FACTOR_SECRET / ADMIN_PASSWORD in .env.local'); process.exit(1); }

const b64url = (s) => Buffer.from(s).toString('base64url');
// Mirror createTwoFactorSessionToken() exactly.
function mintToken(email) {
  const payload = { email: email.toLowerCase().trim(), exp: Date.now() + 3600_000, verifiedAt: new Date(0).toISOString(), authLevel: '2fa' };
  const encoded = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

// Drive the SSE route, collect the streamed answer text.
async function ask(email, message) {
  const token = mintToken(email);
  const res = await fetch(`${BASE}/api/app/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': token },
    body: JSON.stringify({ email, message, history: [] }),
  });
  if (!res.ok) return { status: res.status, text: (await res.text().catch(() => '')).slice(0, 300), answer: '' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', answer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const l of lines) {
      const t = l.trim();
      if (!t.startsWith('data:')) continue;
      try { const e = JSON.parse(t.slice(5).trim()); if (e.type === 'token') answer += e.content; } catch {}
    }
  }
  return { status: 200, answer };
}

const USER_A = 'c.jacksonbey@yahoo.com'; // Pro + real pursuits (VA software, DoD engineering, Air Force testing, Navy)
const USER_B_EMPTY = 'tavinalford@gmail.com'; // Pro but ZERO pipeline rows — the isolation + empty-state subject

const checks = [];
const record = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name}\n   ${detail}\n`); };

console.log(`\n▶ Driving ${BASE}/api/app/chat …\n`);

// 1. Pipeline question → real rows
const a1 = await ask(USER_A, 'What pursuits are in my pipeline right now? List their titles.');
if (a1.status !== 200) { record('1. pipeline returns real data', false, `HTTP ${a1.status}: ${a1.text}`); }
else {
  const hit = /engineering|VA\b|veterans|defense|navy|air force|software|telecom|testing/i.test(a1.answer);
  record('1. pipeline returns real data', hit, hit ? `grounded in real rows → "${a1.answer.slice(0, 160)}…"` : `NO real-row terms found → "${a1.answer.slice(0, 200)}"`);
}

// 2. Isolation — user B (empty) must NOT see user A's pursuits
const b1 = await ask(USER_B_EMPTY, "What pursuits are in my pipeline? List their titles.");
if (b1.status !== 200) { record('2. isolation (B cannot see A)', false, `HTTP ${b1.status}`); }
else {
  const leaked = /OAA DMC|541330|FGEN|FY26 OTS|jacksonbey/i.test(b1.answer);
  record('2. isolation (B cannot see A)', !leaked, leaked ? `LEAK! B saw A's rows → "${b1.answer.slice(0, 200)}"` : `no leak → "${b1.answer.slice(0, 160)}…"`);
}

// 3. No-regression — teaching question still answers
const a2 = await ask(USER_A, 'What is a capability statement and why does it matter?');
if (a2.status !== 200) { record('3. teaching no-regression', false, `HTTP ${a2.status}`); }
else {
  const ok = a2.answer.length > 60 && /capability statement|capabilit/i.test(a2.answer);
  record('3. teaching no-regression', ok, ok ? `answered (${a2.answer.length} chars) → "${a2.answer.slice(0, 140)}…"` : `weak/empty → "${a2.answer.slice(0, 200)}"`);
}

// 4. No-fabrication — empty pipeline user told they have none
if (b1.status === 200) {
  const honest = /don'?t have|no pursuits|nothing|empty|haven'?t|no opportunities|not tracking/i.test(b1.answer);
  record('4. no-fabrication on empty', honest, honest ? `honest empty-state → "${b1.answer.slice(0, 160)}…"` : `did NOT clearly say empty → "${b1.answer.slice(0, 200)}"`);
}

console.log('================ E2E VERDICT ================');
const passed = checks.filter(c => c.pass).length;
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`);
console.log(`  ${passed}/${checks.length} passed`);
console.log('=============================================');
process.exit(passed === checks.length ? 0 : 1);
