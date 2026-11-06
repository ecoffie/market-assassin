#!/usr/bin/env node
/**
 * Point the app at a different Mindy site for testing (e.g. a Vercel PR preview).
 *
 *   node scripts/set-server-url.mjs https://market-assassin-git-<branch>-eric-coffies-projects.vercel.app
 *   node scripts/set-server-url.mjs --reset        # back to https://getmindy.ai/app
 *
 * Rewrites capacitor.config.json (server.url + allowNavigation) and the Android app label
 * ("Mindy Preview"), then run `npx cap sync`. Never commit a non-production URL.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROD = 'https://getmindy.ai/app';
const arg = process.argv[2];
if (!arg) { console.error('usage: set-server-url.mjs <https://host> | --reset'); process.exit(1); }

const reset = arg === '--reset';
let url = PROD;
if (!reset) {
  const u = new URL(arg);
  if (u.protocol !== 'https:') { console.error('must be https'); process.exit(1); }
  url = `${u.origin}${u.pathname === '/' ? '/app' : u.pathname}`;
}
const host = new URL(url).host;

const cfgPath = join(root, 'capacitor.config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.server.url = url;
const base = ['getmindy.ai', '*.getmindy.ai', 'mi.govcongiants.com'];
cfg.server.allowNavigation = reset ? base : [...new Set([...base, host])];
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

const label = reset ? 'Mindy' : 'Mindy Preview';
const stringsPath = join(root, 'android/app/src/main/res/values/strings.xml');
writeFileSync(stringsPath, readFileSync(stringsPath, 'utf8')
  .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${label}$2`)
  .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${label}$2`));

console.log(`server.url = ${url}  (label: ${label})`);
