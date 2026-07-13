#!/usr/bin/env node
/**
 * mcp-oauth-smoke.mjs — prove the KEYLESS OAuth flow end-to-end, the way a real
 * MCP client (Claude Desktop) does it, minus the human clicking "Allow".
 *
 * Flow asserted, in order:
 *   1. Discovery — /.well-known/oauth-authorization-server + protected-resource resolve.
 *   2. DCR — POST /oauth/register returns a client_id.
 *   3. Authorize — POST /api/oauth/authorize/approve (with a minted MI 2FA token
 *      standing in for the signed-in "Allow") returns a redirect with ?code=.
 *   4. Token — POST /oauth/token (authorization_code + PKCE verifier) returns an
 *      access_token + refresh_token.
 *   5. Keyless call — connect the MCP transport with the ACCESS TOKEN (no API key),
 *      initialize, tools/list = 9, call get_balance.
 *   6. Refresh — POST /oauth/token (refresh_token) rotates to new tokens.
 *   7. Negatives — replayed code rejected; wrong PKCE verifier rejected.
 *
 * Usage (after the migration is applied + the branch is deployed to a URL):
 *   MI_AUTH_TOKEN=<minted 2FA token> MI_EMAIL=evankoffdev@gmail.com \
 *     node scripts/mcp-oauth-smoke.mjs --base https://<preview-or-prod>
 *
 * Mint MI_AUTH_TOKEN with:
 *   npx tsx -e 'import "dotenv/config"; import {createMIAuthSessionToken} from "./src/lib/two-factor-session"; console.log(createMIAuthSessionToken("evankoffdev@gmail.com"))'
 */
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = (argVal('--base', process.env.MCP_BASE || 'http://localhost:3000')).replace(/\/$/, '');
const TOKEN = process.env.MI_AUTH_TOKEN || '';
const EMAIL = process.env.MI_EMAIL || 'evankoffdev@gmail.com';
const REDIRECT = 'http://localhost:9876/callback';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`\n❌ OAUTH SMOKE FAILED: ${m}`); process.exit(1); };

async function main() {
  if (!TOKEN) fail('set MI_AUTH_TOKEN (a minted MI 2FA token) — see header for the one-liner');
  console.log(`\n── MCP OAuth smoke ──\n   base: ${BASE}\n`);

  // 1. Discovery
  const asMeta = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  if (!asMeta.authorization_endpoint || !asMeta.token_endpoint) fail('AS metadata missing endpoints');
  if (!asMeta.code_challenge_methods_supported?.includes('S256')) fail('AS metadata must advertise S256');
  const prMeta = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
  if (!prMeta.authorization_servers?.length) fail('protected-resource metadata missing authorization_servers');
  ok('discovery metadata (authorization-server + protected-resource) resolve');

  // 2. DCR
  const reg = await (await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'oauth smoke', redirect_uris: [REDIRECT] }),
  })).json();
  if (!reg.client_id) fail(`DCR returned no client_id: ${JSON.stringify(reg)}`);
  ok(`dynamic client registration → ${reg.client_id}`);

  // 3. Authorize (approve) with PKCE
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const approve = async (v = verifier) => {
    const res = await fetch(`${BASE}/api/oauth/authorize/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': TOKEN, 'x-user-email': EMAIL },
      body: JSON.stringify({
        email: EMAIL, client_id: reg.client_id, redirect_uri: REDIRECT, response_type: 'code',
        code_challenge: v === verifier ? challenge : b64url(createHash('sha256').update(v).digest()),
        code_challenge_method: 'S256', scope: 'mcp', state: 'xyz123',
      }),
    });
    return res.json();
  };
  const appr = await approve();
  if (!appr.redirect) fail(`approve returned no redirect: ${JSON.stringify(appr)}`);
  const code = new URL(appr.redirect).searchParams.get('code');
  if (!code) fail('no code in approve redirect');
  ok('authorize approved (session-backed) → code issued');

  // 4. Token exchange
  const tok = await (await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }),
  })).json();
  if (!tok.access_token || !tok.refresh_token) fail(`token exchange failed: ${JSON.stringify(tok)}`);
  ok(`token exchange → access_token + refresh_token (expires_in=${tok.expires_in})`);

  // 5. Keyless MCP call with the ACCESS TOKEN (no API key)
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } },
  });
  const client = new Client({ name: 'oauth-smoke', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 9) fail(`expected 9 tools, got ${tools.length}`);
  const bal = await client.callTool({ name: 'get_balance', arguments: {} });
  const balance = JSON.parse(bal.content[0].text).balance;
  await client.close();
  ok(`KEYLESS access token works → ${tools.length} tools, balance=${balance}`);

  // 6. Refresh rotation
  const refreshed = await (await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }),
  })).json();
  if (!refreshed.access_token || !refreshed.refresh_token) fail(`refresh failed: ${JSON.stringify(refreshed)}`);
  ok('refresh_token rotation → new access + refresh');

  // 7. Negatives
  const replay = await (await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }),
  })).json();
  if (replay.access_token) fail('replayed code was accepted (must be single-use)');
  ok('replayed authorization code rejected');

  const appr2 = await approve();
  const code2 = new URL(appr2.redirect).searchParams.get('code');
  const badPkce = await (await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, code_verifier: 'the-wrong-verifier', client_id: reg.client_id, redirect_uri: REDIRECT }),
  })).json();
  if (badPkce.access_token) fail('wrong PKCE verifier was accepted');
  ok('wrong PKCE verifier rejected');

  console.log('\n✅ OAUTH SMOKE PASSED — keyless connect works end-to-end.\n');
}

main().catch((e) => fail(e?.message || String(e)));
