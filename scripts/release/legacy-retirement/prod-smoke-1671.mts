/**
 * #1671 production smoke — READ-ONLY. Runs after the merge deploy is READY (manifest P0).
 *
 *   npx tsx scripts/release/legacy-retirement/prod-smoke-1671.mts [--host https://getmindy.ai] [--expect-sha <sha>]
 *
 * Only GETs, no cookies, no sign-in, no writes. Exit 1 on any failure.
 */
const args = process.argv.slice(2);
const val = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const HOST = (val('--host') || 'https://getmindy.ai').replace(/\/$/, '');

type Check = { name: string; ok: boolean; detail: string };
const out: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => { out.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`); };

async function redirect(path: string, expect: string) {
  const r = await fetch(HOST + path, { redirect: 'manual' });
  const loc = r.headers.get('location') || '';
  const target = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
  add(`${path} → ${expect}`, r.status === 307 && target === expect, `${r.status} ${target || '(none)'}`);
}
async function page(path: string, mustContain: RegExp | null, mustNot?: RegExp) {
  const r = await fetch(HOST + path, { redirect: 'follow' });
  const html = await r.text();
  const ok = r.status === 200 && (!mustContain || mustContain.test(html)) && (!mustNot || !mustNot.test(html));
  add(`${path} serves`, ok, `${r.status}${mustContain ? ` contains ${mustContain}` : ''}${mustNot ? ` lacks ${mustNot}` : ''}`);
}

async function main() {
  const sha = val('--expect-sha');
  if (sha) {
    // Prove WHICH build is serving before judging it: /opportunity-map stamps VERCEL_GIT_COMMIT_SHA
    // as <!-- maps-account-build:<sha> -->. Pass the MERGE commit on main.
    const r = await fetch(`${HOST}/opportunity-map`, { cache: 'no-store' }).catch(() => null);
    const serving = ((r ? await r.text() : '').match(/maps-account-build:([a-fA-F0-9]+)/) || [])[1] || '';
    add('serving build is the release', !!serving && serving.startsWith(sha.slice(0, 7)), serving ? serving.slice(0, 12) : 'no build stamp found');
  }
  await redirect('/briefings?welcome=true', '/app');
  await redirect('/federal-market-assassin', '/app?panel=research');
  await redirect('/opportunity-hunter', '/app?panel=research');
  await redirect('/bundles/ultimate', '/pricing');
  await redirect('/start', '/app');
  await page('/recompete', /Open Recompetes in Mindy/);
  // Branding on /alerts/preferences is client-rendered, so HTML can't prove it — that is browser check P5.
  await page('/alerts/preferences', null);
  // getmindy.ai/ is host-rewritten to the landing page, so the legacy grid is only provable on the
  // raw Vercel host, where / used to serve it.
  if (HOST === 'https://getmindy.ai') {
    const r = await fetch('https://market-assassin.vercel.app/', { redirect: 'follow' }).catch(() => null);
    const html = r ? await r.text() : '';
    add('market-assassin.vercel.app/ has no legacy tools grid', !!r && !/Government Contracting Intelligence Tools/.test(html), r ? `${r.status}` : 'unreachable');
  }
  await page('/app', /Mindy/i);
  const failed = out.filter((c) => !c.ok);
  console.log(`\n${out.length - failed.length}/${out.length} passed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
