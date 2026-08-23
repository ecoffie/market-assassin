#!/usr/bin/env node
/**
 * Verify the pipeline_id follow-up IN PRODUCTION.
 *
 * Proves three things, because the change is only correct if all three hold:
 *   1. WITH a pursuit    → pipeline_id lands in proposal_section_drafted metadata
 *   2. WITHOUT a pursuit → the draft STILL SUCCEEDS and pipeline_id is null (omitted,
 *                          not invented). This is the case Eric explicitly protected:
 *                          drafting must not depend on the id.
 *   3. Junk id           → rejected to null by server-side validation, draft unaffected.
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
const PURSUIT = process.env.VERIFY_PURSUIT || '0bb1dee7-d9fb-4a8d-a514-6ef28102644b';

const b64u = (s) => Buffer.from(s).toString('base64url');
const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD;
const payload = b64u(JSON.stringify({ email: EMAIL, exp: Date.now() + 1800000, verifiedAt: new Date().toISOString(), authLevel: '2fa' }));
const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
const H = { 'Content-Type': 'application/json', 'x-mi-auth-token': token };

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function draft(pipelineId, label) {
  const t0 = new Date(Date.now() - 3000).toISOString();
  const body = { sectionType: 'technical', text: 'Network engineering sustainment support.', fileName: `pid-check-${label}.txt` };
  if (pipelineId !== undefined) body.pipelineId = pipelineId;
  const r = await fetch(`${BASE}/api/app/proposal/draft?email=${encodeURIComponent(EMAIL)}`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  await new Promise((res) => setTimeout(res, 2500));
  // Bind the error: a FAILED read returns no rows, which is indistinguishable from
  // "the field is absent" — and misreading that is precisely how the missing pipeline_id
  // got misdiagnosed as a slow deploy in the first place.
  const { data, error } = await supabase
    .from('user_engagement').select('metadata, created_at')
    .eq('event_source', 'proposal').eq('user_email', EMAIL)
    .gte('created_at', t0).order('created_at', { ascending: false }).limit(5);
  if (error) throw new Error(`engagement read failed (NOT proof of absence): ${error.message}`);
  const ev = (data || []).find((d) => d.metadata?.action === 'proposal_section_drafted');
  return { httpOk: r.ok && j.success === true, stored: ev ? ev.metadata.pipeline_id : undefined, hasKey: ev ? 'pipeline_id' in ev.metadata : false };
}

const withP = await draft(PURSUIT, 'with');
if (!withP.hasKey) { console.log('not-live'); process.exit(1); }

const withoutP = await draft(undefined, 'without');
const junkP = await draft("'; DROP TABLE user_engagement;--", 'junk');

const pass =
  withP.httpOk && withP.stored === PURSUIT &&
  withoutP.httpOk && withoutP.stored === null &&
  junkP.httpOk && junkP.stored === null;

console.log(`  1 with pursuit     draft=${withP.httpOk ? 'OK' : 'FAIL'}  pipeline_id=${JSON.stringify(withP.stored)}`);
console.log(`  2 WITHOUT pursuit  draft=${withoutP.httpOk ? 'OK' : 'FAIL'}  pipeline_id=${JSON.stringify(withoutP.stored)}  (must still succeed)`);
console.log(`  3 junk id          draft=${junkP.httpOk ? 'OK' : 'FAIL'}  pipeline_id=${JSON.stringify(junkP.stored)}  (must be null)`);
console.log(pass ? 'PIPELINE_ID_LIVE — all 3 cases correct' : 'FAIL');
process.exit(pass ? 0 : 1);
