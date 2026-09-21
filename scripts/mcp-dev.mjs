#!/usr/bin/env node
/**
 * mcp-dev.mjs — launch the Mindy MCP stdio server locally with real env loaded.
 *
 * The MCP server (src/mcp/server.ts) needs NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY to reach the RAG corpus. This runner loads them from
 * .env.local (or whatever --env-file you point at), then execs the server via tsx.
 *
 * WHY a runner and not `tsx src/mcp/server.ts` directly: Claude Desktop spawns the
 * command from an arbitrary cwd with a minimal env, so we can't rely on the shell's
 * loaded vars. This script pins cwd to the repo root and loads the env file itself.
 *
 * KNOWN TRAP (this repo): `.env.local`'s SUPABASE_SERVICE_ROLE_KEY has gone stale
 * before ("Invalid API key"). If retrieval returns an auth error, point at a known-good
 * env file:  node scripts/mcp-dev.mjs --env-file /path/to/.env.prod
 *
 * Usage:
 *   npm run mcp:dev                       # loads .env.local
 *   node scripts/mcp-dev.mjs --env-file X # loads a specific env file
 *
 * For Claude Desktop, see MCP-README below — Desktop launches this same command.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// --- parse --env-file ---
const args = process.argv.slice(2);
const envFileIdx = args.indexOf('--env-file');
const envFile = envFileIdx >= 0 ? args[envFileIdx + 1] : resolve(repoRoot, '.env.local');

// --- load env (minimal dotenv, no dependency) ---
const loaded = {};
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // `vercel env pull` writes literal escaped newlines inside quoted values — a trailing
    // \n on a URL silently breaks the request path. Unescape then trim.
    val = val.replace(/\\n/g, '').trim();
    loaded[key] = val;
  }
  console.error(`[mcp-dev] loaded env from ${envFile}`);
} else {
  console.error(`[mcp-dev] WARNING: env file not found: ${envFile} — server will use ambient env only`);
}

// Required for the RAG corpus.
for (const required of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!loaded[required] && !process.env[required]) {
    console.error(`[mcp-dev] ERROR: ${required} is not set (env file: ${envFile}). Corpus calls will fail.`);
  }
}

const child = spawn('npx', ['tsx', resolve(repoRoot, 'src/mcp/server.ts')], {
  cwd: repoRoot,
  // stdio inherit: stdin/stdout are the MCP wire, stderr is diagnostics.
  stdio: 'inherit',
  env: { ...process.env, ...loaded },
});

child.on('exit', (code) => process.exit(code ?? 0));
