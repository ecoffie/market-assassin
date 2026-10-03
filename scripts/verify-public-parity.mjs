#!/usr/bin/env node
/**
 * verify-public-parity — a visual migration must not change what a crawler reads.
 *
 * Fetches the RAW server HTML (no JavaScript) for each route from a base host (usually prod)
 * and a candidate host (a local build or preview), then compares:
 *   title · every <meta name|property> · canonical · robots · JSON-LD (parsed) ·
 *   every <a href> in document order · visible text.
 *
 * Header and footer elements marked `data-mp-chrome` are excluded from the link and text
 * comparison, because adopting the shared chrome on a page that had none adds links by design;
 * those are reported separately. `dateModified` is dropped from JSON-LD and digits are masked
 * in visible text (live counts change between two fetches); `--exact-digits` disables that.
 *
 * Run:  node scripts/verify-public-parity.mjs --head http://localhost:3100
 *       node scripts/verify-public-parity.mjs --base https://getmindy.ai --head <url> --route /pricing
 *       node scripts/verify-public-parity.mjs --save snap.json --head <url>   (write a snapshot)
 *       node scripts/verify-public-parity.mjs --against snap.json --head <url> (compare to one)
 * Routes default to `parityRoutes` in src/lib/public-site/opt-in.json. Exit 1 on any difference.
 */
import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const BASE = arg('base', 'https://getmindy.ai');
const HEAD = arg('head', 'http://localhost:3100');
const EXACT_DIGITS = flag('exact-digits');
const manifest = JSON.parse(readFileSync('src/lib/public-site/opt-in.json', 'utf8'));
const routes = args.includes('--route')
  ? args.flatMap((a, i) => (a === '--route' ? [args[i + 1]] : []))
  : manifest.parityRoutes;

const UA = 'Mozilla/5.0 (compatible; MindyParity/1.0; +https://getmindy.ai)';

function dropVolatile(v) {
  if (Array.isArray(v)) return v.map(dropVolatile);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'dateModified').map(([k, x]) => [k, dropVolatile(x)]));
  }
  return v;
}

export function snapshot(html) {
  const { document } = new JSDOM(html).window;
  const meta = {};
  for (const m of document.querySelectorAll('meta[name], meta[property]')) {
    const key = m.getAttribute('name') ? `name:${m.getAttribute('name')}` : `property:${m.getAttribute('property')}`;
    (meta[key] ||= []).push(m.getAttribute('content') ?? '');
  }
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
    try {
      return dropVolatile(JSON.parse(s.textContent));
    } catch {
      return { unparseable: s.textContent.trim() };
    }
  });
  const chromeHrefs = [...document.querySelectorAll('[data-mp-chrome] a[href]')].map((a) => a.getAttribute('href'));
  for (const el of document.querySelectorAll('script, style, noscript, template, [data-mp-chrome]')) el.remove();
  const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  let text = (document.body?.textContent || '').replace(/\s+/g, ' ').trim();
  if (!EXACT_DIGITS) text = text.replace(/\d/g, '0');
  return {
    title: document.title,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    robots: meta['name:robots'] ?? null,
    meta,
    jsonLd,
    hrefs,
    text,
    chromeHrefs,
  };
}

async function fetchSnapshot(host, route) {
  const res = await fetch(new URL(route, host), { headers: { 'user-agent': UA }, redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), ...snapshot(await res.text()) };
}

function diffText(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `first difference at char ${i}:\n      base: …${a.slice(Math.max(0, i - 60), i + 80)}…\n      head: …${b.slice(Math.max(0, i - 60), i + 80)}…`;
}

export function compare(base, head) {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (base.status !== head.status) problems.push(`status ${base.status} → ${head.status}`);
  if (base.location !== head.location) problems.push(`redirect ${base.location} → ${head.location}`);
  for (const k of ['title', 'canonical', 'robots']) {
    if (!same(base[k], head[k])) problems.push(`${k}: ${JSON.stringify(base[k])} → ${JSON.stringify(head[k])}`);
  }
  const keys = new Set([...Object.keys(base.meta), ...Object.keys(head.meta)]);
  for (const k of keys) {
    if (!same(base.meta[k], head.meta[k])) problems.push(`meta ${k}: ${JSON.stringify(base.meta[k])} → ${JSON.stringify(head.meta[k])}`);
  }
  if (!same(base.jsonLd, head.jsonLd)) problems.push('JSON-LD differs');
  if (!same(base.hrefs, head.hrefs)) {
    const removed = base.hrefs.filter((h) => !head.hrefs.includes(h));
    const added = head.hrefs.filter((h) => !base.hrefs.includes(h));
    problems.push(`links differ (${base.hrefs.length} → ${head.hrefs.length}); removed ${JSON.stringify(removed.slice(0, 8))}, added ${JSON.stringify(added.slice(0, 8))}`);
  }
  if (base.text !== head.text) problems.push(`visible text differs; ${diffText(base.text, head.text)}`);
  return problems;
}

async function main() {
  const saved = arg('against') ? JSON.parse(readFileSync(arg('against'), 'utf8')) : null;
  const out = {};
  let failed = false;
  for (const route of routes) {
    const head = await fetchSnapshot(HEAD, route);
    out[route] = head;
    if (arg('save')) continue;
    const base = saved ? saved[route] : await fetchSnapshot(BASE, route);
    if (!base) {
      console.log(`✗ ${route}: no base snapshot`);
      failed = true;
      continue;
    }
    const problems = compare(base, head);
    const chromeNote = !same(base.chromeHrefs, head.chromeHrefs)
      ? ` (shared chrome links: ${base.chromeHrefs.length} → ${head.chromeHrefs.length}, excluded by design)`
      : '';
    if (problems.length) {
      failed = true;
      console.log(`✗ ${route}${chromeNote}`);
      for (const p of problems) console.log(`    ${p}`);
    } else {
      console.log(`✓ ${route}: title, ${Object.keys(head.meta).length} meta keys, canonical, robots, ${head.jsonLd.length} JSON-LD, ${head.hrefs.length} links, ${head.text.length} chars of text identical${chromeNote}`);
    }
  }
  if (arg('save')) {
    writeFileSync(arg('save'), JSON.stringify(out, null, 2));
    console.log(`saved ${Object.keys(out).length} snapshot(s) to ${arg('save')}`);
  }
  process.exit(failed ? 1 : 0);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
