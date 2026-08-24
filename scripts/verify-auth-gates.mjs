#!/usr/bin/env node
/**
 * PRODUCTION verification for the /api/recompete + /api/forecasts authentication fix.
 *
 * Four cases per endpoint. The FREE case is as important as the denials: this change must
 * close "anonymous/fabricated → data" WITHOUT becoming "Free → forbidden".
 */
import dotenv from 'dotenv';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '..', '.env.local') });

const BASE = process.env.VERIFY_BASE || 'https://getmindy.ai';
const EMAIL = (process.env.VERIFY_EMAIL || 'evankoffdev@gmail.com').toLowerCase();
const b64u = (s) => Buffer.from(s).toString('base64url');
const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD;

function mint(email) {
  const p = b64u(JSON.stringify({ email, exp: Date.now() + 900000, verifiedAt: new Date().toISOString(), authLevel: '2fa' }));
  return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`;
}

const ENDPOINTS = [
  { name: '/api/recompete', path: '/api/recompete?naics=541512&months=12', rowsAt: (d) => (d.results || d.data || d.contracts || []).length },
  { name: '/api/forecasts', path: '/api/forecasts?naics=541512&limit=5', rowsAt: (d) => (d.forecasts || d.results || d.data || []).length },
];

async function probe(ep, label, headers, qs = '') {
  const r = await fetch(`${BASE}${ep.path}${qs}`, { headers });
  let rows = 0, err = '';
  try { const j = await r.json(); rows = ep.rowsAt(j) || 0; err = j.error || ''; } catch { /* non-json */ }
  return { label, status: r.status, rows, err };
}

let failures = 0;
for (const ep of ENDPOINTS) {
  console.log(`\n  ── ${ep.name} ──`);
  const cases = [
    { ...(await probe(ep, 'anonymous (no headers)', {})), expect: 'deny' },
    { ...(await probe(ep, 'fabricated x-user-email', { 'x-user-email': 'nobody@example.com' })), expect: 'deny' },
    { ...(await probe(ep, 'forged token', { 'x-mi-auth-token': `${b64u(JSON.stringify({ email: EMAIL, exp: Date.now() + 900000 }))}.deadbeef`, 'x-user-email': EMAIL })), expect: 'deny' },
    { ...(await probe(ep, 'VALID session', { 'x-mi-auth-token': mint(EMAIL), 'x-user-email': EMAIL }, `&email=${encodeURIComponent(EMAIL)}`)), expect: 'allow' },
  ];
  for (const c of cases) {
    const denied = c.status === 401 || c.status === 403;
    const ok = c.expect === 'deny' ? (denied && c.rows === 0) : (c.status === 200 && c.rows > 0);
    if (!ok) failures++;
    console.log(`    ${ok ? '✓' : '✗'} ${c.label.padEnd(26)} HTTP ${c.status}  rows=${c.rows}  ${c.expect === 'deny' ? '(must be denied, 0 rows)' : '(must be ALLOWED with data)'}`);
  }
}
console.log(failures === 0 ? '\n  AUTH_GATES_VERIFIED — denials denied, valid session still served\n' : `\n  ✗ ${failures} case(s) wrong\n`);
process.exit(failures ? 1 : 0);
