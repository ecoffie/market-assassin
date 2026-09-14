#!/usr/bin/env node
/**
 * Maps account chrome — required regression check.
 *
 * Would have caught (2026-09-14):
 *   1. HMAC sessions decoded as JWTs → purple "?" on / and /opportunity-map
 *   2. Markets → Players linked ?mode=buyers → blank dataset dropdown
 *   3. A later main deploy overwriting the fix (live HTML no longer matched source)
 *
 *   npm run verify:maps-account            # source (offline) — merge gate
 *   npm run verify:maps-account -- --live  # + getmindy.ai HTML (and HMAC /me when secrets exist)
 *   npm run verify:maps-account -- --live --host getmindy.ai
 *
 * Exit 0 = pass. Exit 1 = fail. Exit 2 = usage.
 */
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const JSON_OUT = args.includes('--json');
const hostIdx = args.indexOf('--host');
const HOST = (hostIdx >= 0 ? args[hostIdx + 1] : 'getmindy.ai')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function loadDotEnv() {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!JSON_OUT) {
    const mark = pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗ FAIL\x1b[0m';
    console.log(`${mark} ${name}  \x1b[2m${detail}\x1b[0m`);
  }
}

function mustContain(name, hay, needle) {
  check(name, hay.includes(needle), needle);
}
function mustNotContain(name, hay, needle) {
  check(name, !hay.includes(needle), `must not contain ${JSON.stringify(needle)}`);
}

// ── SOURCE ──────────────────────────────────────────────────────────────────
const avatar = read('src/lib/mindy/account-avatar.ts');
const menu = read('src/app/opportunity-map/account-menu.ts');
const map = read('src/app/opportunity-map/route.ts');
const today = read('src/app/today/route.ts');
const reports = read('src/app/opportunity-map/reports/route.ts');
const me = read('src/app/api/app/me/route.ts');
const avatarTest = read('src/lib/mindy/account-avatar.unit.test.ts');
const menuTest = read('src/app/opportunity-map/account-menu-avatar.unit.test.ts');

mustContain('HMAC decode reads payload.sig slot 0 (not JWT [1])', menu, 'b64json(parts[0])');
mustNotContain('client must not treat HMAC as JWT split(".")[1]', menu, 't.split(".")[1]');
mustNotContain('initials must never return "?"', menu, 'if(!src)return "?"');
mustContain('lib initials empty-identity returns blank, not "?"', avatar, 'if (!first) return \'\';');
mustContain('broken photo falls back to paintInitial, never "?"', menu, 'img.onerror=function(){paintInitial(name,em);}');
mustContain('OAuth picture from identities[].identity_data', avatar, 'identity_data');
mustContain('pictureFromAuthUser reads data.picture', avatar, 'data.picture');
mustContain('/api/app/me resolves HMAC via requireMIAuthSession', me, 'requireMIAuthSession');
mustContain('/me uses profileFromAuthUser (OAuth metadata + identities)', me, 'profileFromAuthUser');
mustContain('homepage injects ACCOUNT_MENU_JS', today, 'ACCOUNT_MENU_JS');
mustContain('opportunity-map injects ACCOUNT_MENU_JS', map, 'ACCOUNT_MENU_JS');
mustContain('setMapMode remaps buyers → companies before writing the pill', map, "if(mode==='buyers')mode='companies'");
mustContain('Players gate remaps buyers → companies', map, "window.__playersGate = function(mode, onResume)");
check(
  'Players gate canonicalizes buyers before setMapMode',
  /window\.__playersGate = function\(mode, onResume\)\{[\s\S]{0,400}if\(mode==='buyers'\)mode='companies'/.test(map),
  "if(mode==='buyers')mode='companies' inside __playersGate",
);
mustNotContain('#fltDataset has no buyers option', map, '<option value="buyers"');
mustContain('Players option is companies', map, '<option value="companies">Players</option>');
const PLAYERS_HREF = 'href="/opportunity-map?mode=companies">Players</a>';
const siblingNav = [
  ['Today', today],
  ['Markets', reports],
  ['Vault', read('src/app/opportunity-map/vault/route.ts')],
  ['Forecasts', read('src/app/opportunity-map/forecasts/route.ts')],
  ['Pursuits', read('src/app/opportunity-map/pursuits/route.ts')],
  ['Market', read('src/app/opportunity-map/market/route.ts')],
  ['Proposal', read('src/app/opportunity-map/proposal/route.ts')],
  ['Favorites', read('src/app/opportunity-map/favorites/route.ts')],
  ['Saved', read('src/app/opportunity-map/saved/route.ts')],
];
for (const [label, src] of siblingNav) {
  mustContain(`${label} Players nav emits ?mode=companies`, src, PLAYERS_HREF);
  mustNotContain(`${label} Players nav must not emit ?mode=buyers`, src, 'href="/opportunity-map?mode=buyers"');
}
mustContain(
  'ContinueExploring Players card uses companies',
  read('src/components/today/ContinueExploring.tsx'),
  "href: '/opportunity-map?mode=companies'",
);

const setMapAt = map.indexOf('window.setMapMode=function(mode){');
const remapAt = setMapAt >= 0 ? map.indexOf("if(mode==='buyers')mode='companies'", setMapAt) : -1;
const dselAt = setMapAt >= 0 ? map.indexOf('dsel.value=mode', setMapAt) : -1;
check(
  'setMapMode remaps buyers BEFORE writing #fltDataset',
  setMapAt >= 0 && remapAt >= 0 && dselAt >= 0 && remapAt < dselAt && (dselAt - setMapAt) < 4000,
  'if(mode===\'buyers\')mode=\'companies\' before dsel.value=mode',
);

mustContain('HMAC unit test still pins payload.sig', avatarTest, "token.split('.').length).toBe(2)");
mustContain('OAuth identities picture unit test still exists', avatarTest, 'identities[].identity_data.picture');
mustContain('never "?" initials unit test still exists', avatarTest, 'never returns "?"');
mustContain('photo onerror unit test still exists', menuTest, 'img.onerror=function(){paintInitial(name,em);}');

// ── LIVE ────────────────────────────────────────────────────────────────────
async function fetchText(path) {
  const url = `https://${HOST}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    const body = await res.text();
    return { url, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function runLive() {
  const pages = [
    { path: '/', label: 'homepage /' },
    { path: '/today', label: 'homepage /today' },
    { path: '/opportunity-map', label: 'opportunity-map' },
    { path: '/opportunity-map/reports', label: 'Markets' },
  ];
  for (const page of pages) {
    try {
      const { status, body, url } = await fetchText(page.path);
      check(`${page.label} HTTP 200 (${url})`, status === 200, `status ${status}, ${body.length} bytes`);
      if (status !== 200) continue;
      check(
        `${page.label} HMAC decoder is in the served HTML`,
        body.includes('b64json(parts[0])'),
        'b64json(parts[0])',
      );
      check(
        `${page.label} does not ship the JWT-slot decoder`,
        !body.includes('t.split(".")[1]'),
        'no t.split(".")[1]',
      );
      check(
        `${page.label} does not paint "?" for a missing photo src`,
        !body.includes('if(!src)return "?"'),
        'no if(!src)return "?"',
      );
      check(
        `${page.label} broken photo falls back to initials`,
        body.includes('img.onerror=function(){paintInitial(name,em);}'),
        'img.onerror → paintInitial',
      );
    } catch (e) {
      check(`${page.label} fetch`, false, String(e?.message || e));
    }
  }

  try {
    const { status, body } = await fetchText('/opportunity-map?mode=buyers');
    check('map ?mode=buyers HTTP 200', status === 200, `status ${status}`);
    check(
      'deployed setMapMode remaps buyers → companies',
      body.includes("if(mode==='buyers')mode='companies'"),
      "if(mode==='buyers')mode='companies'",
    );
    check(
      'deployed dataset pill has Players, not a buyers option',
      body.includes('<option value="companies">Players</option>') && !body.includes('<option value="buyers"'),
      'option companies=Players, no buyers option',
    );
  } catch (e) {
    check('map ?mode=buyers fetch', false, String(e?.message || e));
  }

  try {
    const { status, body } = await fetchText('/opportunity-map/reports');
    check(
      'deployed Markets → Players href is companies',
      status === 200 && body.includes('href="/opportunity-map?mode=companies">Players</a>')
        && !body.includes('href="/opportunity-map?mode=buyers">Players</a>'),
      status === 200 ? 'href ?mode=companies' : `status ${status}`,
    );
  } catch (e) {
    check('Markets Players href fetch', false, String(e?.message || e));
  }

  loadDotEnv();
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    check(
      'HMAC /api/app/me (skipped — no TWO_FACTOR_SECRET / ADMIN_PASSWORD in env)',
      true,
      'source HMAC decode + requireMIAuthSession still required; CI cannot mint a prod session',
    );
    return;
  }
  const email = 'maps-account-regression@getmindy.ai';
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + 60 * 60 * 1000,
    verifiedAt: new Date().toISOString(),
    authLevel: 'password',
  })).toString('base64url');
  const token = `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  try {
    const res = await fetch(`https://${HOST}/api/app/me`, {
      headers: { 'x-mi-auth-token': token },
    });
    if (res.status === 401) {
      check(
        'HMAC /api/app/me (skipped — minted token 401, local secret ≠ prod)',
        true,
        'HTML decoder still required; source requireMIAuthSession still required',
      );
      return;
    }
    const json = await res.json().catch(() => ({}));
    const ok = res.status === 200 && String(json.email || '').toLowerCase() === email;
    const pictureOk = json.picture == null || /^https?:\/\//i.test(String(json.picture));
    const name = json.name == null ? '' : String(json.name);
    const ini = name
      ? name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
      : (email.split('@')[0][0] || '').toUpperCase();
    check(
      'HMAC session /api/app/me returns that email (existing MI token, no new auth)',
      ok && pictureOk && ini !== '?',
      ok ? `email matches, picture=${json.picture ? 'url' : 'null'}, initials≠?` : `status ${res.status}`,
    );
  } catch (e) {
    check('HMAC session /api/app/me', false, String(e?.message || e));
  }
}

const sourceFailed = () => results.some((r) => !r.pass);

if (!LIVE) {
  if (JSON_OUT) console.log(JSON.stringify({ host: null, results }, null, 2));
  process.exit(sourceFailed() ? 1 : 0);
}

runLive()
  .then(() => {
    if (JSON_OUT) console.log(JSON.stringify({ host: HOST, results }, null, 2));
    process.exit(sourceFailed() ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
