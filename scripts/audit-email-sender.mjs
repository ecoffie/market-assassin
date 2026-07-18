#!/usr/bin/env node
/**
 * audit-email-sender — HARD GATE against the "silent email drop" bug class.
 *
 * office365 (smtp.office365.com, from alerts@govcongiants.com) ACCEPTS a message
 * (nodemailer sendMail resolves `true`) then DROPS it — zero delivery to external
 * inboxes (proven 2026-07-18: 30 days of a real Gmail = 0 delivered from it; only
 * mail.getmindy.ai / Resend ever lands). 17 senders were still calling
 * `transporter.sendMail` directly, so their purchase/access emails silently never
 * arrived. All were rerouted through `sendEmail()` (Resend) in PR #379.
 *
 * The ONLY sanctioned nodemailer/office365 use is the fallback INSIDE
 * `src/lib/send-email.ts` (Resend is primary; office365 is its last-ditch fallback).
 * Everywhere else, email MUST go through `sendEmail()` from `@/lib/send-email`.
 *
 * This is zero-tolerance (no baseline): the sweep left 0 offenders outside
 * send-email.ts, so ANY reappearance of `transporter.sendMail` or
 * `nodemailer.createTransport` outside that file is NEW and BLOCKS the push.
 *
 * Exit codes: 0 = clean · 1 = offender found (blocks push)
 * Run:  node scripts/audit-email-sender.mjs
 * See memory: mindy-email-sender-architecture.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC_ROOT = 'src';
const ALLOWED_FILE = 'src/lib/send-email.ts'; // the sole sanctioned office365 fallback

// A raw office365 send or transport built outside sendEmail(). Matches the method
// call and the transport factory; either one means email is bypassing Resend.
const OFFENDER = /\btransporter\.sendMail\s*\(|\bnodemailer\.createTransport\s*\(|\bcreateTransport\s*\(\s*\{[^}]*office365/;
const SIMPLE = /\btransporter\.sendMail\s*\(|\bnodemailer\.createTransport\s*\(/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC_ROOT)) {
  if (file === ALLOWED_FILE) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (SIMPLE.test(line) || OFFENDER.test(line)) {
      violations.push({ file, line: i + 1, text: line.trim().slice(0, 100) });
    }
  });
}

if (violations.length === 0) {
  console.log('✓ email-sender: no direct office365/nodemailer sends outside send-email.ts');
  process.exit(0);
}

console.error(`✗ email-sender: ${violations.length} direct office365/nodemailer send(s) outside send-email.ts:`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error('');
console.error('  office365 SILENTLY DROPS external mail (sendMail returns true but nothing arrives).');
console.error('  Send through the Resend helper instead:');
console.error("    import { sendEmail } from '@/lib/send-email';");
console.error("    await sendEmail({ to, subject, html, text, emailType, transactional: true });");
console.error('  (The only sanctioned nodemailer use is the fallback inside send-email.ts.)');
process.exit(1);
