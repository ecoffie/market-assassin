#!/usr/bin/env node
/**
 * verify-public-site — runtime proof for pages on the Mindy public design system.
 *
 * For each route in `runtimeRoutes` (src/lib/public-site/opt-in.json), at desktop (1440×900)
 * and mobile (390×844):
 *   screenshot     full-page PNG into --out
 *   fonts          every visible text element renders in Libre Baskerville, Inter or IBM Plex
 *                  Mono at weight ≤ 700; no font requested from a CDN; no font file fetched twice
 *   palette        no purple-hue colour, no gradient, no large dark-slate surface (the logo image
 *                  and the embedded map iframe are excluded)
 *   contrast       WCAG AA for every visible text element (3:1 for large text)
 *   focus          the first 30 Tab stops each show a visible focus indicator
 *   reduced motion with prefers-reduced-motion: reduce, no infinite animation keeps running
 *   dark flash     a frame-by-frame record of the canvas colour from the first frame, on initial
 *                  load and on client navigation into and out of the public shell
 *
 * Run:  node scripts/verify-public-site.mjs --host http://localhost:3100 --out .tmp-public-site
 * Exit 1 on any failure.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const HOST = arg('host', 'http://localhost:3100');
const OUT = arg('out', '.tmp-public-site');
const manifest = JSON.parse(readFileSync('src/lib/public-site/opt-in.json', 'utf8'));
const ROUTES = args.includes('--route') ? args.flatMap((a, i) => (a === '--route' ? [args[i + 1]] : [])) : manifest.runtimeRoutes;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const ALLOWED_FAMILIES = ['libre baskerville', 'inter', 'ibm plex mono'];
const DARK_FIXTURE = '/design-fixtures/dark-origin';
const PUBLIC_FIXTURE = '/design-fixtures/public-site';

mkdirSync(OUT, { recursive: true });
const failures = [];
const report = {};
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const HOME = '/today';
const slug = (r) => (r === '/' || r === HOME ? 'home' : r.replace(/^\//, '').replace(/[^\w]+/g, '-'));

/** Browser-side helpers, injected into every page. */
const PAGE_HELPERS = () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  window.__rgba = (c) => {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  window.__lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  window.__purple = ([r, g, b, a]) => {
    if (a < 0.1) return false;
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, d = max - min;
    if (d < 0.08) return false;
    const l = (max + min) / 2, s = d / (1 - Math.abs(2 * l - 1));
    if (s < 0.2) return false;
    const R = r / 255, G = g / 255, B = b / 255;
    let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    return h >= 250 && h <= 320;
  };
  window.__canvasColor = () => {
    const h = getComputedStyle(document.documentElement);
    const hb = window.__rgba(h.backgroundColor);
    if (hb[3] > 0) return hb;
    if (document.body) {
      const bb = window.__rgba(getComputedStyle(document.body).backgroundColor);
      if (bb[3] > 0) return bb;
    }
    return h.colorScheme.includes('dark') ? [18, 18, 18, 1] : [255, 255, 255, 1];
  };
};

/** Records the canvas colour on every animation frame from the first one. */
const FRAME_RECORDER = () => {
  window.__frames = [];
  const tick = () => {
    if (window.__rgba) {
      window.__frames.push({
        t: Math.round(performance.now()),
        canvas: window.__canvasColor(),
        hasBody: !!document.body,
        hasContent: !!document.querySelector('[data-site="public"], .zhead, #dark-origin'),
        isPublic: !!document.querySelector('[data-site="public"], .zhead'),
      });
    }
    if (window.__frames.length < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function newPage(browser, viewport, { reducedMotion = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(PAGE_HELPERS);
  return page;
}

async function auditRendered(page, where) {
  const res = await page.evaluate((allowed) => {
    const out = { fonts: [], palette: [], contrast: [], checked: 0 };
    const vis = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    const effectiveBg = (el) => {
      let layers = [];
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.backgroundImage && s.backgroundImage !== 'none' && !/url\(/.test(s.backgroundImage)) return null;
        const c = window.__rgba(s.backgroundColor);
        if (c[3] > 0) {
          layers.push(c);
          if (c[3] >= 0.99) break;
        }
      }
      let bg = window.__canvasColor().slice(0, 3);
      for (const c of layers.reverse()) bg = bg.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
      return bg;
    };
    const vw = innerWidth * innerHeight;
    for (const el of document.querySelectorAll('body *')) {
      if (['SCRIPT', 'STYLE', 'IFRAME', 'IMG', 'NOSCRIPT', 'svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline'].includes(el.tagName)) continue;
      if (el.closest('svg, iframe')) continue;
      if (!vis(el)) continue;
      const s = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor']) {
        if (prop === 'borderTopColor' && parseFloat(s.borderTopWidth) === 0) continue;
        if (prop === 'outlineColor' && (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0)) continue;
        if (window.__purple(window.__rgba(s[prop]))) out.palette.push(`${desc(el)} ${prop} ${s[prop]}`);
      }
      if (/gradient\(/.test(s.backgroundImage)) out.palette.push(`${desc(el)} gradient ${s.backgroundImage.slice(0, 60)}`);
      const bgc = window.__rgba(s.backgroundColor);
      const r = el.getBoundingClientRect();
      if (bgc[3] > 0.9 && window.__lum(bgc) < 0.05 && r.width * r.height > vw * 0.25) out.palette.push(`${desc(el)} large dark surface ${s.backgroundColor}`);

      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      out.checked++;
      const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      const famOk = allowed.some((a) => fam === a || fam.startsWith(a) || fam.includes(`_${a.replace(/ /g, '_')}`) || fam.includes(a.replace(/ /g, '')));
      if (!famOk) out.fonts.push(`${desc(el)} family ${s.fontFamily.slice(0, 60)}`);
      if (+s.fontWeight > 700) out.fonts.push(`${desc(el)} weight ${s.fontWeight}`);
      const bg = effectiveBg(el);
      if (!bg) continue;
      const fgc = window.__rgba(s.color);
      const fg = fgc.slice(0, 3).map((v, i) => v * fgc[3] + bg[i] * (1 - fgc[3]));
      const [hi, lo] = [window.__lum(fg), window.__lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 40);
        out.contrast.push(`${desc(el)} ${ratio.toFixed(2)}:1 "${t}"`);
      }
    }
    return out;
  }, ALLOWED_FAMILIES);
  for (const k of ['fonts', 'palette', 'contrast']) {
    for (const f of [...new Set(res[k])].slice(0, 12)) fail(where, `${k}: ${f}`);
  }
  return res.checked;
}

async function auditFocus(page, where) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  const seen = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el.tagName === 'IFRAME') return null;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1;
      const ring = s.boxShadow && s.boxShadow !== 'none';
      const rect = el.getBoundingClientRect();
      return { el: `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`, visible: outline || ring, onScreen: rect.bottom > 0 && rect.top < innerHeight };
    });
    if (!r) continue;
    seen.push(r.el);
    if (!r.visible) fail(where, `focus: no visible indicator on ${r.el}`);
  }
  if (!seen.length) fail(where, 'focus: no focusable element reached');
  return seen.length;
}

async function auditReducedMotion(browser, route, where) {
  const page = await newPage(browser, VIEWPORTS.desktop, { reducedMotion: true });
  await page.goto(HOST + route, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  const running = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length,
  );
  if (running) fail(where, `reduced motion: ${running} infinite animation(s) still running`);
  await page.close();
  return running;
}

function darkFrames(frames, { publicOnly }) {
  return frames.filter((f) => f.hasBody && f.hasContent && (!publicOnly || f.isPublic) && window_lum(f.canvas) < 0.2);
}
function window_lum([r, g, b]) {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

async function auditInitialFlash(browser, route, where) {
  const page = await newPage(browser, VIEWPORTS.desktop);
  await page.evaluateOnNewDocument(FRAME_RECORDER);
  await page.goto(HOST + route, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 500));
  const frames = await page.evaluate(() => window.__frames);
  const dark = darkFrames(frames, { publicOnly: false });
  if (dark.length) fail(where, `dark flash on load: ${dark.length} dark frame(s), first at ${dark[0].t}ms`);
  await page.close();
  return { frames: frames.length, firstContentFrame: frames.find((f) => f.hasContent)?.t ?? null, dark: dark.length };
}

async function auditClientNavigation(browser) {
  const where = 'client navigation';
  const page = await newPage(browser, VIEWPORTS.desktop);
  await page.goto(HOST + DARK_FIXTURE, { waitUntil: 'networkidle2', timeout: 90000 });
  const startBg = await page.evaluate(() => window.__canvasColor());
  if (window_lum(startBg) > 0.2) fail(where, `dark fixture is not dark (${startBg})`);
  await page.evaluate(FRAME_RECORDER);
  await page.click('#to-public');
  await page.waitForSelector('[data-site="public"]', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  const inFrames = await page.evaluate(() => window.__frames);
  const darkIn = darkFrames(inFrames, { publicOnly: true });
  if (darkIn.length) fail(where, `dark → public: ${darkIn.length} dark frame(s) with public content on screen`);
  const publicBg = await page.evaluate(() => window.__canvasColor());
  if (window_lum(publicBg) < 0.8) fail(where, `public page canvas not cream after navigation (${publicBg})`);

  await page.evaluate(FRAME_RECORDER);
  await page.click('#to-dark');
  await page.waitForSelector('#dark-origin', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  const outFrames = await page.evaluate(() => window.__frames);
  const endBg = await page.evaluate(() => window.__canvasColor());
  const stillStyled = await page.evaluate(() => [...document.querySelectorAll('style')].some((s) => s.textContent.includes('color-scheme:light')));
  if (window_lum(endBg) > 0.2) fail(where, `public → dark: the dark theme did not return (${endBg})`);
  if (stillStyled) fail(where, 'public → dark: the public root paint stylesheet is still in the document');
  await page.close();
  return { darkToPublicFrames: inFrames.length, darkFramesWithPublicContent: darkIn.length, publicToDarkFrames: outFrames.length, endCanvas: endBg };
}

async function auditFontLoading(browser) {
  const where = 'font loading';
  // A fresh context so earlier audits cannot pre-warm the cache. Requests made by an embedded
  // product frame (the /today map iframe) are attributed separately: they are not this system's.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(VIEWPORTS.desktop);
  const requests = [];
  const embedded = [];
  page.on('response', (r) => {
    if (r.request().resourceType() !== 'font' && !/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return;
    const frame = r.frame();
    if (frame && frame !== page.mainFrame()) {
      embedded.push({ url: r.url(), frame: frame.url().replace(HOST, '') });
      return;
    }
    requests.push({ url: r.url(), fromCache: r.fromCache(), page: page.url() });
  });
  const visits = [];
  for (const route of [HOME, PUBLIC_FIXTURE, HOME]) {
    const before = requests.length;
    await page.goto(HOST + route, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')} ${f.weight} ${f.style}`));
    visits.push({ route, requests: requests.slice(before).map((r) => ({ file: r.url.replace(HOST, ''), fromCache: r.fromCache })), loaded: [...new Set(loaded)] });
  }
  if (requests.some((r) => /googleapis|gstatic/.test(r.url))) fail(where, 'a font was requested from Google Fonts');
  const network = requests.filter((r) => !r.fromCache);
  const counts = {};
  for (const r of network) counts[r.url] = (counts[r.url] || 0) + 1;
  for (const [url, n] of Object.entries(counts)) if (n > 1) fail(where, `${url.replace(HOST, '')} downloaded ${n} times`);
  const familyOf = (u) => (/libre-baskerville/.test(u) ? 'serif' : /ibm-plex-mono/.test(u) ? 'mono' : /inter-latin/.test(u) ? 'inter (static)' : /_next\/static\/media/.test(u) ? 'next/font' : 'other');
  const serifNetwork = network.filter((r) => familyOf(r.url) === 'serif');
  const serifUnique = new Set(serifNetwork.map((r) => r.url)).size;
  if (serifNetwork.length !== serifUnique) fail(where, 'Libre Baskerville files downloaded more than once across raw-HTML and React pages');
  await context.close();
  return {
    visits,
    networkDownloads: network.map((r) => `${familyOf(r.url)}  ${r.url.replace(HOST, '')}`),
    embeddedFrameFontRequests: [...new Set(embedded.map((e) => `${e.frame}  ${e.url.replace(HOST, '')}`))],
  };
}

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const route of ROUTES) {
      report[route] = {};
      for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
        const where = `${route} [${vpName}]`;
        const page = await newPage(browser, vp);
        const resp = await page.goto(HOST + route, { waitUntil: 'networkidle2', timeout: 90000 });
        if (!resp || ![200, 304].includes(resp.status())) fail(where, `HTTP ${resp?.status()}`);
        await page.evaluate(() => document.fonts.ready);
        await new Promise((r) => setTimeout(r, 800));
        const shot = join(OUT, `${slug(route)}-${vpName}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        const checked = await auditRendered(page, where);
        const focusStops = vpName === 'desktop' ? await auditFocus(page, where) : null;
        report[route][vpName] = { screenshot: shot, textElementsChecked: checked, focusStops };
        await page.close();
      }
      report[route].reducedMotionInfiniteAnimations = await auditReducedMotion(browser, route, `${route} [reduced motion]`);
      report[route].initialLoad = await auditInitialFlash(browser, route, `${route} [initial load]`);
    }
    if (ROUTES.includes(PUBLIC_FIXTURE)) report.clientNavigation = await auditClientNavigation(browser);
    if (ROUTES.includes(HOME) && ROUTES.includes(PUBLIC_FIXTURE)) report.fontLoading = await auditFontLoading(browser);
  } finally {
    await browser.close();
  }
  report.failures = failures;
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.log(`\n✗ ${failures.length} failure(s)`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log('\n✓ public site runtime checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
