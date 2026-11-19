/**
 * Mint a short-lived HS256 JWT for the scorecard_reader PostgREST role.
 *
 * Supported credential path (no Mac minting):
 *   Actions secret SCORECARD_JWT_SECRET = the project's legacy JWT HS256 secret
 *   (set once). This script runs at the start of the weekday scorecard job,
 *   writes a 2h token to --out (or stdout), and the workflow masks it into
 *   GITHUB_ENV as SCORECARD_READONLY_JWT.
 *
 * Never prints the signing secret. Never logs the token when --out is used
 * (the caller reads the file). Do not commit the secret or a minted token.
 *
 *   node scripts/scorecard-mint-jwt.mjs --out "$RUNNER_TEMP/scorecard.jwt"
 */
import { writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { basename } from 'node:path';

export const SCORECARD_ROLE = 'scorecard_reader';
export const DEFAULT_TTL_SEC = 2 * 60 * 60;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

/**
 * @param {string} secret
 * @param {{ ttlSec?: number, nowSec?: number }} [opts]
 * @returns {string}
 */
export function mintScorecardJwt(secret, opts = {}) {
  const key = String(secret ?? '');
  if (!key) {
    throw new Error('SCORECARD_JWT_SECRET is not configured');
  }
  const ttlSec = typeof opts.ttlSec === 'number' && opts.ttlSec > 0 ? opts.ttlSec : DEFAULT_TTL_SEC;
  const nowSec = typeof opts.nowSec === 'number' ? opts.nowSec : Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({
    role: SCORECARD_ROLE,
    iss: 'supabase',
    iat: nowSec,
    exp: nowSec + ttlSec,
  });
  const sig = b64url(createHmac('sha256', key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function parseArgs(argv) {
  const outIdx = argv.indexOf('--out');
  const ttlIdx = argv.indexOf('--ttl-sec');
  return {
    outPath: outIdx >= 0 ? argv[outIdx + 1] : '',
    ttlSec: ttlIdx >= 0 ? Number(argv[ttlIdx + 1]) : DEFAULT_TTL_SEC,
  };
}

function main() {
  const { outPath, ttlSec } = parseArgs(process.argv.slice(2));
  if (process.argv.includes('--out') && !outPath) {
    console.error('scorecard mint: --out needs a file path');
    process.exit(2);
  }
  if (process.argv.includes('--ttl-sec') && !(ttlSec > 0)) {
    console.error('scorecard mint: --ttl-sec must be a positive number');
    process.exit(2);
  }
  let token;
  try {
    token = mintScorecardJwt(process.env.SCORECARD_JWT_SECRET || '', { ttlSec });
  } catch (err) {
    console.error(`scorecard mint: ${err instanceof Error ? err.message : 'mint failed'}`);
    process.exit(2);
  }
  if (outPath) {
    writeFileSync(outPath, token, { encoding: 'utf8', mode: 0o600 });
    // Never print the token when writing to a file.
    console.log(`scorecard mint: wrote ${SCORECARD_ROLE} token (${ttlSec}s ttl)`);
    return;
  }
  // Stdout path is for local piping only. Workflows must use --out + mask.
  process.stdout.write(token);
}

if (process.argv[1] && basename(process.argv[1]) === 'scorecard-mint-jwt.mjs') main();
