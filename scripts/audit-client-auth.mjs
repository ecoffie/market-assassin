#!/usr/bin/env node
/**
 * audit-client-auth — catches the "Missing two-factor session" bug class at its
 * SOURCE: a component fetch to a 2FA-gated /api/app route that forgets to send
 * the MI auth header. (The server-side complement is scripts/audit-api-auth.js,
 * which checks that the ROUTE enforces auth; this checks that the CALLER sends it.)
 *
 * See memory: authed_fetch_401_class. Standard fix = route the fetch through
 * authedFetch(url, email, init) (or at least pass getMIApiHeaders/a header wrapper).
 *
 * Exit codes:
 *   0 = no NEW violations (baseline-known ones are allowed)
 *   1 = new unauthenticated gated fetch found → BLOCKS the push
 *
 * Run:  node scripts/audit-client-auth.mjs           (gate mode)
 *       node scripts/audit-client-auth.mjs --list     (print every finding)
 *       node scripts/audit-client-auth.mjs --update-baseline  (accept current set)
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const API_ROOT = 'src/app/api/app';
const COMPONENT_ROOT = 'src/components/app';
const BASELINE_FILE = 'tests/fixtures/client-auth-baseline.json';

// Markers that mean "this route enforces a 2FA/MI session" → callers MUST auth.
const ENFORCE_MARKERS = /requireMIAuthSession|requireTwoFactorSession|verifyTwoFactorSession|Missing two-factor/;
// Any of these on/near a fetch call means the header is being sent.
const HEADER_MARKERS = /getMIApiHeaders|authedFetch|x-mi-auth-token|getAuthHeaders|getForecastHeaders|getMindyHeaders|headers\s*:\s*h\b|headers\(\)|\.\.\.headers/;

function walk(dir, test, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}

// 1) Which /api/app routes enforce 2FA?
const enforcing = new Set();
for (const p of walk(API_ROOT, (f) => f.endsWith('route.ts'))) {
  if (ENFORCE_MARKERS.test(readFileSync(p, 'utf8'))) {
    enforcing.add('/' + p.replace(/^src\/app\//, '').replace(/\/route\.ts$/, ''));
  }
}

// 2) Scan component fetches for gated calls missing auth.
//    findings      = HARD block: a gated fetch with NO auth header at all → instant 401.
//    headerOnly    = WARN: a gated raw fetch that sends the token via getMIApiHeaders/
//                    a wrapper but is NOT authedFetch → no 401 token-refresh recovery,
//                    so an expired 30-day token strands the user ("Missing two-factor
//                    session"). This is the recurring bug class; nudge toward authedFetch.
const findings = [];
const headerOnly = [];
for (const p of walk(COMPONENT_ROOT, (f) => /\.(tsx|ts)$/.test(f))) {
  const lines = readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:fetch|authedFetch)\(\s*[`'"]([^`'"]*\/api\/app\/[^`'"?]*)/);
    if (!m) continue;
    // authedFetch always authenticates AND self-heals on 401 → never a finding.
    if (/authedFetch\(/.test(lines[i])) continue;
    const urlPath = m[1].split('?')[0].replace(/\$\{[^}]*\}/g, '').replace(/\/+$/, '');
    const enforced = [...enforcing].find(
      (u) => urlPath === u || urlPath.startsWith(u + '/') || u.startsWith(urlPath)
    );
    if (!enforced) continue;
    // Look at the fetch call block (this line + next 7) for a header marker.
    const block = lines.slice(i, i + 8).join('\n');
    if (HEADER_MARKERS.test(block)) {
      // Sends the token but isn't authedFetch → no expired-token recovery.
      headerOnly.push(`${p}:${i + 1} -> ${enforced}`);
      continue;
    }
    findings.push(`${p}:${i + 1} -> ${enforced}`);
  }
}

const args = process.argv.slice(2);
const baseline = existsSync(BASELINE_FILE)
  ? new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).allowed || [])
  : new Set();

if (args.includes('--update-baseline')) {
  writeFileSync(BASELINE_FILE, JSON.stringify({ allowed: findings.sort() }, null, 2) + '\n');
  console.log(`[client-auth] baseline updated: ${findings.length} known finding(s) recorded.`);
  process.exit(0);
}

const newViolations = findings.filter((f) => !baseline.has(f));

if (args.includes('--list')) {
  console.log(`[client-auth] ${enforcing.size} gated routes; ${findings.length} no-auth finding(s), ${headerOnly.length} header-only (no 401-refresh):`);
  findings.forEach((f) => console.log('  ' + (baseline.has(f) ? '(known) ' : 'NEW ') + f));
  headerOnly.forEach((f) => console.log('  (warn) ' + f));
}

// WARN (non-blocking): gated raw fetches that send the token but aren't authedFetch,
// so they can't recover from an expired token. Surfaced so the count trends to zero
// and nobody adds new ones by copy-paste, without hard-blocking existing code.
if (headerOnly.length > 0) {
  console.warn(`[client-auth] ⚠ ${headerOnly.length} gated fetch(es) send the token but aren't authedFetch → no expired-token (401) recovery. Prefer authedFetch(url, email, init). Run --list to see them.`);
}

if (newViolations.length === 0) {
  console.log(`[client-auth] OK — no new unauthenticated gated fetches (${findings.length} baseline-known).`);
  process.exit(0);
}

console.error(`\n[client-auth] ✗ ${newViolations.length} NEW unauthenticated fetch(es) to a 2FA-gated /api/app route:\n`);
newViolations.forEach((f) => console.error('  ' + f));
console.error(`\nFix: route the fetch through authedFetch(url, email, init) — see memory authed_fetch_401_class.`);
console.error(`(If intentional, run: node scripts/audit-client-auth.mjs --update-baseline)\n`);
process.exit(1);
