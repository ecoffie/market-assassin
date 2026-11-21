#!/usr/bin/env node
/**
 * Create/update the Market Assassin Cloud Agents environment and load Runtime Secrets
 * from a local .env file (default: repo .env.local).
 *
 * Usage:
 *   CURSOR_API_KEY=key_... node scripts/bootstrap-cursor-cloud-env.mjs
 *   CURSOR_API_KEY=key_... node scripts/bootstrap-cursor-cloud-env.mjs --env-file /path/to/.env.local
 *
 * Never prints secret values. Requires a user API key from
 * https://cursor.com/dashboard?tab=api-keys
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const API = 'https://api.cursor.com/v1';
const ENV_NAME = 'Market Assassin';
const REPO_URL = 'https://github.com/ecoffie/market-assassin';

/** Secrets needed to run unit/live checks for MCP + alert delivery work. */
const SECRET_NAMES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CRON_SECRET',
  'ADMIN_PASSWORD',
  'SAM_API_KEY',
  'RESEND_API_KEY',
  'DATABASE_URL',
];

/** Intentionally omitted: KV_* / UPSTASH_* — they make hermetic unit tests hit live Upstash. */

function parseArgs(argv) {
  const out = { envFile: resolve(ROOT, '.env.local'), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env-file') out.envFile = resolve(argv[++i]);
    if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

function loadEnvFile(path) {
  if (!existsSync(path)) throw new Error(`env file not found: ${path}`);
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map.set(m[1], v);
  }
  return map;
}

async function api(method, path, body) {
  const key = process.env.CURSOR_API_KEY;
  if (!key) throw new Error('Set CURSOR_API_KEY (Dashboard → API Keys)');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function environmentJson() {
  return JSON.stringify({
    install: 'npm ci',
    installTimeoutMinutes: 45,
    terminals: [],
  });
}

async function findOrCreateEnvironment() {
  const listed = await api('GET', `/environments?name=${encodeURIComponent(ENV_NAME)}&limit=100`);
  const items = listed?.items || listed?.environments || [];
  const hit = items.find((e) => e.name === ENV_NAME);
  if (hit) {
    console.log(`environment exists: ${hit.id}`);
    await api('PATCH', `/environments/${hit.id}`, {
      repos: [{ url: REPO_URL }],
      environmentJson: environmentJson(),
    }).catch(async (e) => {
      // Some deployments use PUT for full replace
      if (e.status === 404 || e.status === 405) {
        console.log('PATCH not supported; leaving existing config, will set secrets only');
        return;
      }
      throw e;
    });
    return hit.id;
  }

  try {
    const created = await api('POST', '/environments', {
      owner: 'personal',
      name: ENV_NAME,
      repos: [{ url: REPO_URL }],
      environmentJson: environmentJson(),
    });
    console.log(`created environment: ${created.id}`);
    return created.id;
  } catch (e) {
    if (e.status === 409 && e.body?.environmentId) {
      console.log(`name conflict → using ${e.body.environmentId}`);
      return e.body.environmentId;
    }
    throw e;
  }
}

async function putSecret(envId, name, value) {
  await api('PUT', `/environments/${envId}/secrets/${encodeURIComponent(name)}`, {
    value,
    type: 'runtime_secret',
  });
}

function resolveSecrets(env) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const name of SECRET_NAMES) {
    const v = String(env.get(name) || '').trim();
    if (v) out.set(name, v);
  }
  // Local .env often sets SUPABASE_URL to the auth custom domain (auth.getmindy.ai).
  // Cloud agents need the project API host (NEXT_PUBLIC_SUPABASE_URL).
  const pub = out.get('NEXT_PUBLIC_SUPABASE_URL') || '';
  const url = out.get('SUPABASE_URL') || '';
  if (pub && (!url || /auth\.|localhost/i.test(url) || url.length < 30)) {
    out.set('SUPABASE_URL', pub);
  }
  if (!out.get('SUPABASE_ANON_KEY') && out.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
    out.set('SUPABASE_ANON_KEY', out.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
  }
  // Drop empties / oversize (API cap 4096 bytes)
  for (const [k, v] of [...out.entries()]) {
    if (!v || Buffer.byteLength(v, 'utf8') > 4096) out.delete(k);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnvFile(args.envFile);
  const secrets = resolveSecrets(env);
  const present = [...secrets.keys()];
  const missing = SECRET_NAMES.filter((n) => !secrets.has(n));
  console.log(`env file: ${args.envFile}`);
  console.log(`secrets present: ${present.length}/${SECRET_NAMES.length}`);
  if (missing.length) console.log(`missing (skipped): ${missing.join(', ')}`);
  console.log('omitted on purpose: KV_* / UPSTASH_*');
  if (secrets.get('SUPABASE_URL') === env.get('NEXT_PUBLIC_SUPABASE_URL')) {
    console.log('SUPABASE_URL coerced to NEXT_PUBLIC_SUPABASE_URL (auth-host guard)');
  }

  if (args.dryRun) {
    console.log('dry-run: would create/update', ENV_NAME, '→', REPO_URL);
    process.exit(0);
  }

  const envId = await findOrCreateEnvironment();
  for (const [name, value] of secrets) {
    await putSecret(envId, name, value);
    console.log(`secret set: ${name}`);
  }
  console.log(`done. environmentId=${envId}`);
  console.log('Open: https://cursor.com/dashboard/cloud-agents');
}

main().catch((e) => {
  console.error(e.message);
  if (e.body) console.error(JSON.stringify(e.body));
  process.exit(1);
});
