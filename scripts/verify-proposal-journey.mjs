#!/usr/bin/env node
/**
 * PRODUCTION VERIFICATION — one real Proposal journey, then prove the events.
 *
 * Eric's acceptance contract (2026-08-23):
 *   1. run one real journey: Workspace → Draft → Compliance → Export
 *   2. prove all four occurred ONCE — no duplicate COMPLETION events
 *   3. prove no proposal/customer text landed in telemetry
 *   4. prove /api/admin/proposal-funnel flips null → measured ONLY for proven steps
 *
 * WHY THE API AND NOT THE PAGE SHELL: /app's page needs a Supabase session bootstrap that
 * localStorage injection cannot fake (scripts/browser-verify.mjs documents this — a seeded
 * MI token lands on the sign-in screen). The API routes, which is where every emitter
 * actually lives, authenticate on the SIGNED MI 2FA token. So we mint a genuine token and
 * drive the REAL production routes — the same requests ProposalsPanel makes. This exercises
 * the production emitters end-to-end; it does not mock or bypass them.
 *
 *   node scripts/verify-proposal-journey.mjs --dry     # show what it WOULD do
 *   node scripts/verify-proposal-journey.mjs --go      # run the journey for real
 */
import dotenv from 'dotenv';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '..', '.env.local') });

const BASE = process.env.VERIFY_BASE || 'https://getmindy.ai';
const EMAIL = (process.env.VERIFY_EMAIL || 'evankoffdev@gmail.com').toLowerCase();
const GO = process.argv.includes('--go');

const b64u = (s) => Buffer.from(s).toString('base64url');
function mintToken(email) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error('No TWO_FACTOR_SECRET / ADMIN_PASSWORD in env');
  const payload = b64u(JSON.stringify({
    email, exp: Date.now() + 30 * 60 * 1000,
    verifiedAt: new Date().toISOString(), authLevel: '2fa',
  }));
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Every funnel token, so a duplicate on ANY of them is visible. */
const COMPLETION = ['proposal_workspace_opened', 'proposal_section_drafted', 'compliance_completed', 'proposal_exported'];

async function countEvents(sinceIso) {
  const { data, error } = await supabase
    .from('user_engagement')
    .select('user_email, created_at, metadata')
    .eq('event_source', 'proposal')
    .eq('user_email', EMAIL)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .range(0, 999);
  if (error) throw new Error(`engagement read failed: ${error.message}`);
  return data || [];
}

/** A pursuit belonging to this account — the journey needs a real one. */
async function findPursuit() {
  const { data, error } = await supabase
    .from('user_pipeline')
    .select('id, title, notice_id, user_email, owner_email')
    .or(`user_email.eq.${EMAIL},owner_email.eq.${EMAIL}`)
    .not('notice_id', 'is', null)
    .limit(1);
  if (error) throw new Error(`pipeline read failed: ${error.message}`);
  return (data || [])[0] || null;
}

const token = mintToken(EMAIL);
const H = { 'Content-Type': 'application/json', 'x-mi-auth-token': token };

async function main() {
  console.log(`\n  base=${BASE}  email=${EMAIL}  mode=${GO ? 'GO' : 'DRY'}\n`);

  const pursuit = await findPursuit();
  if (!pursuit) {
    console.error('  ✗ no pursuit with a notice_id owned by this account — cannot run a REAL journey.');
    console.error('    Refusing to fabricate one: a synthetic pursuit would not prove the production path.');
    process.exit(1);
  }
  console.log(`  pursuit: ${pursuit.id}  notice=${pursuit.notice_id}  "${(pursuit.title || '').slice(0, 50)}"`);

  if (!GO) {
    console.log('\n  DRY — would call, in order:');
    console.log(`    GET  /api/app/proposal/pursuit-docs?pipeline_id=${pursuit.id}   → proposal_workspace_opened`);
    console.log('    POST /api/app/proposal/draft                                   → proposal_section_drafted');
    console.log('    POST /api/app/proposal/compliance                              → compliance_completed');
    console.log('    POST /api/app/proposal/export                                  → proposal_exported');
    console.log('\n  Re-run with --go to execute.\n');
    return;
  }

  const t0 = new Date(Date.now() - 5000).toISOString();
  const results = [];

  // 1 — WORKSPACE OPENED
  {
    const url = `${BASE}/api/app/proposal/pursuit-docs?email=${encodeURIComponent(EMAIL)}&pipeline_id=${encodeURIComponent(pursuit.id)}`;
    const r = await fetch(url, { headers: H });
    const j = await r.json().catch(() => ({}));
    results.push({ step: 'workspace', http: r.status, ok: r.ok && j.success !== false });
    console.log(`  1 workspace   HTTP ${r.status} ${r.ok ? '✓' : '✗ ' + (j.error || '')}`);
  }

  // 2 — SECTION DRAFTED
  {
    const r = await fetch(`${BASE}/api/app/proposal/draft?email=${encodeURIComponent(EMAIL)}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        sectionType: 'technical',
        text: 'The contractor shall provide network engineering support services including '
            + 'installation, configuration and sustainment of enterprise routing equipment.',
        fileName: 'journey-verification.txt',
      }),
    });
    const j = await r.json().catch(() => ({}));
    results.push({ step: 'draft', http: r.status, ok: r.ok && j.success });
    console.log(`  2 draft       HTTP ${r.status} ${r.ok && j.success ? '✓' : '✗ ' + (j.error || '')}`);
  }

  // 3 — COMPLIANCE
  {
    const r = await fetch(`${BASE}/api/app/proposal/compliance?email=${encodeURIComponent(EMAIL)}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        pipeline_id: pursuit.id,
        text: 'L.1 The offeror shall submit a technical volume not to exceed 20 pages. '
            + 'M.2 Proposals will be evaluated on technical approach and past performance. '
            + 'L.3 Submit past performance references for three contracts.',
        fileName: 'journey-verification.txt',
      }),
    });
    const j = await r.json().catch(() => ({}));
    results.push({ step: 'compliance', http: r.status, ok: r.ok && j.success });
    console.log(`  3 compliance  HTTP ${r.status} ${r.ok && j.success ? '✓' : '✗ ' + (j.error || '')}`);
  }

  // 4 — EXPORT (.docx, NOT the ?format=text preview — the preview is deliberately not an export)
  {
    const r = await fetch(`${BASE}/api/app/proposal/export?email=${encodeURIComponent(EMAIL)}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        fileName: 'journey-verification',
        drafts: { technical: { draft: 'Technical approach narrative.', wordCount: 4, status: 'draft' } },
        compliance: [], checklist: [], sectionOrder: ['technical'],
      }),
    });
    const ct = r.headers.get('content-type') || '';
    results.push({ step: 'export', http: r.status, ok: r.ok });
    console.log(`  4 export      HTTP ${r.status} ${r.ok ? `✓ (${ct.slice(0, 40)})` : '✗'}`);
  }

  // Emitters are awaited inside the routes, but give the DB a beat.
  await new Promise((res) => setTimeout(res, 3000));

  // ---- PROOF ----
  const rows = await countEvents(t0);
  const byAction = {};
  for (const r of rows) {
    const a = r.metadata?.action || '(none)';
    (byAction[a] ||= []).push(r);
  }

  console.log('\n  ── events emitted by THIS journey ──');
  for (const a of COMPLETION) {
    const n = (byAction[a] || []).length;
    const mark = n === 1 ? '✓' : n === 0 ? '✗ MISSING' : `✗ DUPLICATE x${n}`;
    console.log(`    ${a.padEnd(30)} ${n}  ${mark}`);
  }
  const extra = Object.keys(byAction).filter((a) => !COMPLETION.includes(a));
  if (extra.length) console.log(`    (other actions seen: ${extra.join(', ')})`);

  // No customer text anywhere in the emitted metadata.
  const NEEDLES = ['contractor shall', 'network engineering', 'offeror shall', 'Technical approach narrative', 'not to exceed 20 pages'];
  const leaks = [];
  for (const r of rows) {
    const blob = JSON.stringify(r.metadata || {});
    for (const n of NEEDLES) if (blob.toLowerCase().includes(n.toLowerCase())) leaks.push({ action: r.metadata?.action, needle: n });
  }

  console.log('\n  ── content-leak check ──');
  if (leaks.length) {
    for (const l of leaks) console.log(`    ✗ ${l.action} leaked "${l.needle}"`);
  } else {
    console.log('    ✓ no proposal/customer text in any emitted metadata');
  }
  console.log('    sample metadata:', JSON.stringify(rows[0]?.metadata || {}).slice(0, 200));

  const allOnce = COMPLETION.every((a) => (byAction[a] || []).length === 1);
  const httpOk = results.every((r) => r.ok);

  console.log(`\n  RESULT: journey=${httpOk ? 'PASS' : 'FAIL'}  events=${allOnce ? 'PASS (each exactly once)' : 'FAIL'}  leaks=${leaks.length ? 'FAIL' : 'PASS'}\n`);
  process.exit(httpOk && allOnce && !leaks.length ? 0 : 1);
}

main().catch((e) => { console.error('  ✗', e.message); process.exit(1); });
