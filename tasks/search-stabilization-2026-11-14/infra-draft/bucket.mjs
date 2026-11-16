#!/usr/bin/env node
/**
 * DRAFT — NOT RUN. Private `open-snapshots` bucket for the search cache (Agent 3, 2026-11-16).
 * Eric/Agent 5: there is no staging Supabase (previews use the production project), so this must NOT be run until Eric
 * approves it for a specific project. Reviewed artifact only.
 *
 *   node bucket.mjs status --project-ref <ref>            # read-only: does it exist, is it private
 *   node bucket.mjs create --project-ref <ref> --go       # creates PRIVATE bucket (public:false). Idempotent.
 *   node bucket.mjs delete --project-ref <ref> --go       # empties then deletes the bucket (the rollback)
 *
 * Safety: without --go it only prints what it would do. --project-ref must equal the ref in NEXT_PUBLIC_SUPABASE_URL,
 * so it cannot hit a project you did not name. Env from the shell (strip quotes / literal \n yourself).
 */
import { createClient } from '@supabase/supabase-js';
const BUCKET = 'open-snapshots';
const [cmd] = process.argv.slice(2);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const go = process.argv.includes('--go');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required'); process.exit(2); }
const ref = new URL(url).hostname.split('.')[0];
if (arg('--project-ref') !== ref) { console.error(`--project-ref must be ${ref} (the project these credentials point at)`); process.exit(2); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const state = async () => { const { data, error } = await sb.storage.getBucket(BUCKET); return error || !data ? null : data; };
const s = await state();
console.log(`project ${ref} · bucket ${BUCKET}: ${s ? `exists, public=${s.public}` : 'absent'}`);
if (cmd === 'status') process.exit(s && s.public ? 1 : 0);
if (cmd === 'create') {
  if (s) { if (s.public) { console.error('EXISTS AND IS PUBLIC — refusing; fix by hand'); process.exit(1); } console.log('already private; nothing to do'); process.exit(0); }
  if (!go) { console.log(`DRY RUN: would createBucket('${BUCKET}', { public: false })`); process.exit(0); }
  const { error } = await sb.storage.createBucket(BUCKET, { public: false });
  if (error) { console.error('create failed:', error.message); process.exit(1); }
  const after = await state(); console.log(`created at ${new Date().toISOString()}: public=${after?.public}`); process.exit(after && !after.public ? 0 : 1);
}
if (cmd === 'delete') {
  if (!s) { console.log('absent; nothing to do'); process.exit(0); }
  if (!go) { console.log(`DRY RUN: would emptyBucket + deleteBucket('${BUCKET}')`); process.exit(0); }
  const e1 = await sb.storage.emptyBucket(BUCKET); if (e1.error) { console.error('empty failed:', e1.error.message); process.exit(1); }
  const e2 = await sb.storage.deleteBucket(BUCKET); if (e2.error) { console.error('delete failed:', e2.error.message); process.exit(1); }
  console.log(`deleted at ${new Date().toISOString()}`); process.exit((await state()) ? 1 : 0);
}
console.error('usage: status|create|delete --project-ref <ref> [--go]'); process.exit(2);
