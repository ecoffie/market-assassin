/**
 * PRODUCTION SMOKE — Opportunity Share Attribution on getmindy.ai (post-deploy).
 *
 * Share → click → session only, against the LIVE site and read back from the LIVE database.
 * No signup, activation or purchase is manufactured in production (the E2E acceptance proved that
 * join logic). The sharer is a synthetic, clearly-labelled account holding a real signed MI session.
 *
 * Writes a handful of synthetic user_engagement rows (the synthetic sharer + fresh anon ids),
 * reads them back, runs the read-only funnel over them, then DELETES them and re-counts to zero
 * so smoke traffic never sits in the real share report. `--keep` skips the cleanup.
 *
 *   npx tsx scripts/acceptance/share-attribution-prod-smoke.mts            # dry
 *   npx tsx scripts/acceptance/share-attribution-prod-smoke.mts --go
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const GO = process.argv.includes('--go');
const KEEP = process.argv.includes('--keep');
const BASE = process.env.SMOKE_BASE || 'https://getmindy.ai';
const X = process.env.SMOKE_X || '1d0334b6ca824be59e69f4965cee4262';
const Y = process.env.SMOKE_Y || '164e0be63e4b481796eb2b28c1238189';
const RUN = Date.now().toString(36);
const SHARER = `share-attribution-acceptance+prod-smoke-${RUN}@getmindy.ai`;
if (!GO) { console.log(`DRY. Would smoke ${BASE} sharing ${X} and ${Y} as ${SHARER}. Pass --go.`); process.exit(0); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { createMIAuthSessionToken } = await import('../../src/lib/two-factor-session');
const { resolveFirstShareArrival } = await import('../../src/lib/attribution/share-attribution');

const proof: Record<string, unknown> = { run: RUN, base: BASE, X, Y, sharer: SHARER, started_at: new Date().toISOString() };
const failures: string[] = [];
const checks: unknown[] = []; proof.checks = checks;
const check = (label: string, ok: boolean, detail?: unknown) => {
  checks.push({ label, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 240) : ''}`);
  if (!ok) failures.push(label);
};
type Posted = { email: string; metadata?: Record<string, unknown> };

async function page(b: Browser, token?: string) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  const posted: Posted[] = [];
  p.on('request', (r) => { if (r.url().includes('/api/app/engagement') && r.method() === 'POST') { try { posted.push(JSON.parse(r.postData() || '{}')); } catch { /* */ } } });
  await p.evaluateOnNewDocument((tk?: string) => {
    if (tk) localStorage.setItem('mi_beta_auth_token', tk);
    try { (Clipboard.prototype as unknown as { writeText: (t: string) => Promise<void> }).writeText = function (t: string) { (window as unknown as { __copied: string }).__copied = t; return Promise.resolve(); }; } catch { /* */ }
  }, token);
  return { ctx, p, posted };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 60000): Promise<T> {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(500); }
}
const drawerText = (p: Page) => p.evaluate(() => (document.getElementById('oppDrawer')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
async function share(p: Page, notice: string) {
  await p.goto(`${BASE}/opportunity-map?opp=${notice}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForFunction(() => (document.getElementById('oppDrawer')?.innerText || '').split('\n').length > 6, { timeout: 90000 });
  await sleep(1500);
  await p.evaluate(() => { (window as unknown as { __copied: string }).__copied = ''; });
  await p.click('#oppShare');
  return p.waitForFunction(() => (window as unknown as { __copied?: string }).__copied, { timeout: 15000 }).then((h) => h.jsonValue() as Promise<string>);
}
async function rowsFor(owner: string) {
  const { data, error } = await db.from('user_engagement').select('user_email, event_type, created_at, metadata')
    .eq('user_email', owner).eq('event_source', 'opportunity_map').order('created_at', { ascending: true }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as { user_email: string; created_at: string; metadata: Record<string, unknown> }[];
}
async function attrState(p: Page) {
  const ls = await p.evaluate(() => localStorage.getItem('gca_attribution'));
  const ck = (await p.browserContext().cookies()).find((c) => c.name === 'gca_attr')?.value;
  return { ls: ls ? JSON.parse(ls) : null, cookie: ck ? JSON.parse(decodeURIComponent(ck)) : null };
}

const anonIds: string[] = [];
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  // ── SHARE (authenticated) ───────────────────────────────────────────────────
  console.log(`\nSHARE on ${BASE} as authenticated ${SHARER}`);
  const A = await page(browser, createMIAuthSessionToken(SHARER));
  const url1 = await share(A.p, X);
  const u1 = new URL(url1); const S = u1.searchParams.get('sh')!;
  proof.share_url = url1; proof.S = S;
  check('copied URL = opp=<notice>&src=share&sh=<uuid>', u1.origin === new URL(BASE).origin && u1.searchParams.get('opp') === X && u1.searchParams.get('src') === 'share' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(S), url1);
  const url2 = await share(A.p, Y);
  const S2 = new URL(url2).searchParams.get('sh')!; proof.S2 = S2; proof.share_url_2 = url2;
  const sharerRows = await until(async () => { const r = await rowsFor(SHARER); return r.filter((x) => x.metadata?.action === 'listing_share').length >= 2 ? r : null; });
  const shareRow = sharerRows.find((r) => r.metadata?.share_id === S);
  proof.listing_share_row = shareRow;
  check('listing_share row in PROD stores the same share_id + notice, sharer = authenticated email, method',
    !!shareRow && shareRow.metadata.notice_id === X && shareRow.user_email === SHARER.toLowerCase() && shareRow.metadata.kind === 'opp' && shareRow.metadata.method === 'clipboard', shareRow);

  // ── ANONYMOUS ARRIVAL ────────────────────────────────────────────────────────
  console.log('\nARRIVAL (fresh anonymous browser)');
  const B = await page(browser);
  await B.p.goto(url1, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await B.p.waitForFunction(() => /life raft/i.test(document.getElementById('oppDrawer')?.innerText || ''), { timeout: 90000 }).catch(() => {});
  const bText = await drawerText(B.p);
  check('shared link opens opportunity X\'s drawer', /life raft/i.test(bText), bText.slice(0, 120));
  const anon = await until(() => B.posted.find((e) => e.metadata?.action === 'map_view')?.email);
  anonIds.push(anon);
  const bRows = await until(async () => { const r = await rowsFor(anon); return r.some((x) => x.metadata?.action === 'map_view') && r.some((x) => x.metadata?.action === 'listing_open') ? r : null; }, 90000);
  const mv = bRows.find((r) => r.metadata.action === 'map_view')!;
  const lo = bRows.find((r) => r.metadata.action === 'listing_open')!;
  proof.arrival = { anon, map_view: mv, listing_open: lo };
  check('PROD map_view: entry=share, same share_id, notice X, anonymous identity, first-touch time',
    mv.metadata.entry === 'share' && mv.metadata.share_id === S && mv.metadata.notice_id === X && /^anon:/.test(mv.user_email) && typeof mv.metadata.ft_at === 'string', mv.metadata);
  check('PROD listing_open: entry=share, same share_id, notice X, anonymous identity',
    lo.metadata.entry === 'share' && lo.metadata.share_id === S && lo.metadata.notice_id === X && /^anon:/.test(lo.user_email), { entry: lo.metadata.entry, share_id: lo.metadata.share_id, notice_id: lo.metadata.notice_id });
  const st1 = await attrState(B.p);
  check('gca_attribution (localStorage) + gca_attr (cookie) written by the Map, first_touch = S / X',
    st1.ls?.first_touch?.share_id === S && st1.ls?.first_touch?.notice_id === X && st1.cookie?.first_touch?.share_id === S);
  const ftAt = st1.ls?.first_touch?.captured_at;
  check('first-touch timestamp on the event equals the stored first touch', mv.metadata.ft_at === ftAt, { event: mv.metadata.ft_at, stored: ftAt });
  const resolved = await resolveFirstShareArrival(db, anon);
  check('server-side validation resolves the arrival to share S by the authenticated sharer',
    resolved.ok && resolved.arrival?.shareId === S && resolved.arrival?.sharer === SHARER.toLowerCase(), resolved);

  // Second shared opportunity in the SAME browser.
  await B.p.goto(url2, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await until(() => B.posted.filter((e) => e.metadata?.action === 'map_view').length >= 2, 90000);
  const st2 = await attrState(B.p);
  check('second shared opportunity: first_touch stays S (localStorage + cookie), last_touch moves to S2',
    st2.ls?.first_touch?.share_id === S && st2.cookie?.first_touch?.share_id === S && st2.ls?.last_touch?.share_id === S2 && st2.ls?.first_touch?.captured_at === ftAt,
    { first: st2.ls?.first_touch?.share_id, last: st2.ls?.last_touch?.share_id });

  // ── CONTROLS ────────────────────────────────────────────────────────────────
  console.log('\nCONTROLS');
  const fake = '00000000-1111-4222-8333-444444444444';
  const controls: [string, string, string, 'none' | 'unresolved'][] = [
    ['direct', '/opportunity-map', 'direct', 'none'],
    ['ordinary listing link', `/opportunity-map?opp=${X}`, 'listing_link', 'none'],
    ['alert link', `/opportunity-map?opp=${X}&src=alert`, 'alert', 'none'],
    ['briefing link', `/opportunity-map?src=pursuit_brief`, 'pursuit_brief', 'none'],
    ['saved-search link', `/opportunity-map?ss=00000000-0000-4000-8000-000000000000`, 'saved_search', 'none'],
    ['malformed sh', `/opportunity-map?opp=${X}&src=share&sh=not-a-share`, 'share_invalid', 'none'],
    ['fake well-formed sh', `/opportunity-map?opp=${X}&src=share&sh=${fake}`, 'share', 'unresolved'],
    ['real sh lifted onto another opportunity', `/opportunity-map?opp=${Y}&src=share&sh=${S}`, 'share', 'unresolved'],
  ];
  const ctl: Record<string, unknown> = {}; proof.controls = ctl;
  for (const [label, path, entry, expect] of controls) {
    const c = await page(browser);
    await c.p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const who = await until(() => c.posted.find((e) => e.metadata?.action === 'map_view')?.email, 90000);
    anonIds.push(who);
    const rows = await until(async () => { const r = await rowsFor(who); return r.find((x) => x.metadata?.action === 'map_view') ? r : null; }, 90000);
    const v = rows.find((x) => x.metadata.action === 'map_view')!;
    const res = await resolveFirstShareArrival(db, who);
    const attributed = res.ok && !!res.arrival;
    ctl[label] = { stored_entry: v.metadata.entry, stored_share_id: v.metadata.share_id ?? null, attributed };
    check(`${label}: stored entry=${entry}${expect === 'none' ? ', no share id' : ''}, NOT attributed`,
      v.metadata.entry === entry && !attributed && (expect === 'unresolved' || v.metadata.share_id === undefined), ctl[label]);
    await c.ctx.close();
  }

  // ── FROZEN SHARE TRUTH ───────────────────────────────────────────────────────
  console.log('\nFROZEN OPPORTUNITY SHARE TRUTH');
  const fb = { 'user-agent': 'facebookexternalhit/1.1' };
  const head = (h: string) => h.slice(0, h.indexOf('</head>'));
  const [plain, tagged] = await Promise.all([
    fetch(`${BASE}/opportunity-map?opp=${X}`, { headers: fb }).then((r) => r.text()),
    fetch(`${BASE}/opportunity-map?opp=${X}&src=share&sh=${S}`, { headers: fb }).then((r) => r.text()),
  ]);
  const pick = (h: string, re: RegExp) => (h.match(re) || [])[1] || null;
  const meta = (h: string) => ({
    title: pick(h, /<title>([^<]*)<\/title>/), canonical: pick(h, /<link rel="canonical" href="([^"]*)"/),
    og_title: pick(h, /property="og:title" content="([^"]*)"/), og_url: pick(h, /property="og:url" content="([^"]*)"/),
    og_image: pick(h, /property="og:image" content="([^"]*)"/), og_desc: pick(h, /property="og:description" content="([^"]*)"/),
    tw_card: pick(h, /name="twitter:card" content="([^"]*)"/),
  });
  const mPlain = meta(plain), mTagged = meta(tagged);
  proof.share_truth = { plain: mPlain, tagged: mTagged, head_bytes_identical: head(plain) === head(tagged), page_bytes_identical: plain === tagged };
  check('<head> byte-identical with and without src/sh (crawler UA)', head(plain) === head(tagged));
  check('same opportunity metadata; canonical/og:url are the clean ?opp= link', JSON.stringify(mPlain) === JSON.stringify(mTagged) && mPlain.canonical === `${BASE}/opportunity-map?opp=${X}` && /Life Raft/i.test(mPlain.og_title || ''), mPlain);
  const [imgA, imgB] = await Promise.all([fetch(mPlain.og_image!), fetch(`${mPlain.og_image}?src=share&sh=${S}`)]);
  const [bufA, bufB] = await Promise.all([imgA.arrayBuffer(), imgB.arrayBuffer()]);
  const sha = (b: ArrayBuffer) => createHash('sha256').update(Buffer.from(b)).digest('hex').slice(0, 16);
  proof.card = { status: imgA.status, type: imgA.headers.get('content-type'), bytes: bufA.byteLength, sha: sha(bufA), sha_with_params: sha(bufB) };
  check('social card: 200 image, identical bytes even with src/sh appended', imgA.status === 200 && /image\/png/.test(imgA.headers.get('content-type') || '') && sha(bufA) === sha(bufB), proof.card);

  // ── FUNNEL (read only) ───────────────────────────────────────────────────────
  console.log('\nFUNNEL REPORT (read-only, live DB)');
  const sql = readFileSync(join(process.cwd(), 'src/lib/attribution/share-funnel.sql'), 'utf8');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const { rows } = await c.query(`SELECT * FROM (${sql}) f`);
    const { rows: tot } = await c.query(`SELECT COUNT(*)::int shares, MIN(f.shared_on) first_day, COALESCE(SUM(share_visitors),0)::int visitors FROM (${sql}) f`);
    proof.funnel_all = rows; proof.funnel_totals = tot[0];
    console.log('   ', JSON.stringify(rows));
    const r1 = rows.find((r) => r.share_id === S); const r2 = rows.find((r) => r.share_id === S2);
    check('funnel: share S appears (opportunity X, sharer, method) with 1 unique visitor; fake/lifted controls excluded',
      !!r1 && r1.notice_id === X && r1.sharer === SHARER.toLowerCase() && r1.method === 'clipboard' && Number(r1.share_visitors) === 1, r1);
    check('funnel: share S2 appears with 1 visitor (the same browser)', !!r2 && Number(r2.share_visitors) === 1, r2);
    check('funnel: every attributable share is from deploy time forward (pre-deploy shares carry no share_id)',
      rows.every((r) => new Date(r.shared_on) >= new Date('2026-09-23')), tot[0]);
  } finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
} catch (err) {
  failures.push(`ERROR: ${(err as Error).message}`); console.error(err);
} finally {
  await browser.close();
  if (!KEEP) {
    console.log('\nCLEANUP (smoke rows never stay in the real share report)');
    const owners = [SHARER.toLowerCase(), ...anonIds];
    const { count, error } = await db.from('user_engagement').delete({ count: 'exact' }).in('user_email', owners);
    const { count: left, error: e2 } = await db.from('user_engagement').select('*', { count: 'exact', head: true }).in('user_email', owners);
    proof.cleanup = { deleted: count, remaining: left, errors: [error?.message, e2?.message].filter(Boolean) };
    console.log('  ', JSON.stringify(proof.cleanup));
    if (left !== 0) failures.push('cleanup left smoke rows');
  }
  proof.failures = failures;
  const out = process.env.SMOKE_PROOF || `share-attribution-prod-smoke-${RUN}.json`;
  writeFileSync(out, JSON.stringify(proof, null, 2));
  console.log(`\n${failures.length ? `✗ ${failures.length} FAILED` : '✓ ALL PRODUCTION CHECKS PASSED'} — proof: ${out}`);
  process.exit(failures.length ? 1 : 0);
}
