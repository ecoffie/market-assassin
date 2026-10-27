#!/usr/bin/env node
/**
 * audit-email-sender — HARD GATE for Mindy sender isolation.
 *
 * Mindy product email goes out through ONE path: `sendEmail()` in src/lib/send-email.ts,
 * which sends via Resend from the verified mail.getmindy.ai domain and has NO fallback.
 *
 * History:
 *  - 2026-07-18: office365 (smtp.office365.com, as alerts@govcongiants.com) was proven to
 *    accept-then-drop external mail; 17 direct `transporter.sendMail` senders were rerouted
 *    through sendEmail() (PR #379). The fallback inside send-email.ts was left as the one
 *    sanctioned exception.
 *  - 2026-10-27: that exception is gone. The fallback last fired 2026-08-03 (27 sends), moving
 *    Mindy mail onto govcongiants.com whenever Resend failed. Two manual scripts in scripts/
 *    also still built their own office365 transport, because this gate only walked src/.
 *
 * Zero tolerance, no baseline, no allowed file. Blocks the push on any of:
 *   1. a nodemailer transport or `.sendMail(` call anywhere in src/ or scripts/;
 *   2. a From header on @govcongiants.com in src/ or scripts/ (`from: '... <x@govcongiants.com>'`).
 *
 * Exit codes: 0 = clean · 1 = offender found (blocks push)
 * Run:  node scripts/audit-email-sender.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['src', 'scripts'];
const SELF = 'scripts/audit-email-sender.mjs';

const RULES = [
  {
    id: 'nodemailer-transport',
    re: /\.sendMail\s*\(|\bnodemailer\.createTransport\s*\(|\bcreateTransport\s*\(|require\(\s*['"]nodemailer['"]\s*\)|from\s+['"]nodemailer['"]/,
    why: 'direct SMTP/office365 send — Mindy email must go through sendEmail() (Resend only)',
  },
  {
    id: 'govcongiants-from',
    re: /\bfrom\s*:\s*[`'"].*@(?:[a-z0-9-]+\.)*govcongiants\.com/i,
    why: 'From on govcongiants.com — Mindy email is sent only from mail.getmindy.ai',
  },
];

// Unit tests mock the nodemailer MODULE to prove it is never called; mocks are not senders.
const isTest = (p) => /\.(unit\.)?test\.(ts|tsx|js|mjs)$/.test(p) || p.includes('__tests__');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(p)) out.push(p);
  }
  return out;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (file === SELF || isTest(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return; // comments explain history
      for (const rule of RULES) {
        if (rule.re.test(line)) violations.push({ file, line: i + 1, rule, text: trimmed.slice(0, 110) });
      }
    });
  }
}

if (violations.length === 0) {
  console.log('✓ email-sender: no nodemailer/office365 senders and no @govcongiants.com From in src/ or scripts/');
  process.exit(0);
}

console.error(`✗ email-sender: ${violations.length} sender-isolation violation(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule.id}] ${v.text}`);
  console.error(`      → ${v.rule.why}`);
}
console.error('');
console.error('  Send through the Resend helper (default From: Mindy <alerts@mail.getmindy.ai>):');
console.error("    import { sendEmail } from '@/lib/send-email';");
console.error("    await sendEmail({ to, subject, html, text, emailType });");
console.error('  sendEmail has no fallback and refuses any From outside mail.getmindy.ai.');
process.exit(1);
