# Scope: Keyless OAuth for Mindy MCP — "Add connector → Sign in with Mindy"

**Status:** Proposed, awaiting Eric sign-off (2026-07-12)
**Goal:** Match Higgsfield's connect UX — no API key shown, no terminal command. The
user copies the URL, adds it as a custom connector, clicks **Connect**, signs in with
their Mindy account, and they're done. The AI client handles auth invisibly.

---

## 1. Before → after (the whole point)

**Today (key-based):**
1. Create an API/connection key on `/mcp`
2. Copy it, paste `Authorization: Bearer mcp_live_…` into a config file (or a `claude mcp add` command)
3. Restart the client

**After (keyless OAuth):**
1. Copy `https://mcp.getmindy.ai/mcp`
2. In Claude Desktop / Cursor: **Add custom connector** → paste URL
3. **Connect → Sign in with Mindy** (browser pops, one click if already signed into getmindy.ai)

No key on screen, no command. Keys survive only as an *optional* fallback for headless/scripts, demoted to an "Advanced" section.

---

## 2. Why the key exists at all

The key is an artifact of our MCP server having **no OAuth**. Higgsfield can hide the key
because their server is an **OAuth-protected resource**: the client discovers the auth
server, does a browser sign-in, obtains its own token, and sends it as the Bearer. The
user never sees a credential because there isn't one to paste.

So "remove the key" isn't a copy change — it requires our server to speak the MCP
authorization spec (OAuth 2.1).

---

## 3. Architecture — MCP server as OAuth 2.1 resource + authorization server

We act as **both** the Authorization Server (AS) and Resource Server (RS), same origin,
to keep it simple. The login step reuses the **existing getmindy.ai session** (Supabase
Google/Microsoft/Apple + the MI 2FA token) — we are NOT building a new identity system,
only an OAuth envelope around the one we have.

```
Claude Desktop                     getmindy.ai (AS + RS)
──────────────                     ─────────────────────
add connector URL  ─────────────►  GET /.well-known/oauth-protected-resource   (RFC 9728)
                                     → points at our AS metadata
discover AS        ─────────────►  GET /.well-known/oauth-authorization-server  (RFC 8414)
register client    ─────────────►  POST /oauth/register   (Dynamic Client Reg, RFC 7591)
authorize (PKCE)   ─────────────►  GET  /oauth/authorize   → reuse Mindy sign-in + consent
                                     → 302 back with ?code=…
exchange code      ─────────────►  POST /oauth/token       → { access_token, refresh_token }
call tools         ─── Bearer ──►  POST /mcp/mcp           → validate token → runMeteredTool
```

---

## 4. Endpoints to build

| Endpoint | Spec | Job |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 | Tell clients which AS protects `mcp.getmindy.ai` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | Advertise authorize/token/register endpoints, PKCE S256, scopes |
| `POST /oauth/register` | RFC 7591 | Dynamic Client Registration — Claude registers itself, gets a client_id |
| `GET /oauth/authorize` | OAuth 2.1 | If signed into getmindy.ai → consent screen → issue auth code (PKCE). If not → send to `/app` sign-in, return here after |
| `POST /oauth/token` | OAuth 2.1 | Exchange code (+ PKCE verifier) → access token; also `grant_type=refresh_token` |
| `POST /oauth/revoke` | RFC 7009 | Revoke a token (also drives a "disconnect" in the console) |

The transport (`src/app/mcp/[transport]/route.ts`) gains a token check **before**
`runMeteredTool`, and `401` responses carry `WWW-Authenticate: Bearer resource_metadata=…`
so clients know where to authenticate.

---

## 5. The login step (reuses existing auth — no new IdP)

`/oauth/authorize` is a thin page:
- **Already signed into getmindy.ai** (Supabase session or MI 2FA cookie/token present) →
  show a one-screen consent ("Allow Claude to access your Mindy account?") → on Allow,
  mint a short-lived auth code bound to the user's email + PKCE challenge → 302 to the
  client's redirect_uri.
- **Not signed in** → redirect to `/app` sign-in with a return param, come back here after.

This is why matching Higgsfield is feasible without a second identity stack: we already
own the hard part (accounts + sessions). OAuth is the envelope.

---

## 6. Token format + validation

- **Access token = signed JWT** (HS256 with a dedicated `MCP_OAUTH_SIGNING_SECRET`, or
  reuse the 2FA signing approach). Claims: `sub` = email, `aud` = `https://mcp.getmindy.ai/mcp`,
  `scope`, `exp` (short, e.g. 1h). Stateless → no DB read on the hot path.
- **Refresh token** = opaque, stored hashed in a new `mcp_oauth_tokens` table (for
  revocation + rotation). Long-lived (e.g. 30d), rotated on use.
- **Transport validation** swaps `verifyApiKey` for `verifyAccessToken`: check signature,
  `aud`, `exp` → extract email → hand to `runMeteredTool` exactly as today. **API-key path
  stays as a fallback** (try OAuth token first, then `mcp_live_` key). The billing seam is
  untouched — identity in, metered call out.

---

## 7. Billing / credits — unchanged

Metering keys off the **authenticated user email**, which the OAuth token carries just
like the API key does. `runMeteredTool` doesn't change. The only shift:
- **Free 25 credits** grant moves from "first key minted" → "first successful OAuth
  authorize" (so keyless users still get the welcome grant). Same idempotency guard.

---

## 8. Backward compatibility

- Existing `mcp_live_` keys keep working (fallback path) — no break for anyone already connected.
- The `/mcp` console keeps a collapsed **"Advanced: API keys (for headless / CI)"** section.
- stdio transport (local dev) unaffected.

---

## 9. Security checklist (this is why it's not a quick change)

- [ ] **PKCE S256 required** on authorize + token (reject plain/none).
- [ ] **Exact redirect_uri match** against the registered client (no open redirect).
- [ ] **Auth codes:** single-use, ≤60s TTL, bound to client_id + PKCE + user.
- [ ] **Access token:** short TTL, correct `aud` (reject tokens minted for another resource).
- [ ] **Refresh rotation** + revocation list; revoke cascades to "disconnect".
- [ ] **DCR abuse:** rate-limit `/oauth/register`; no secrets returned for public clients.
- [ ] **Consent screen** can't be clickjacked (frame-busting / `X-Frame-Options`).
- [ ] **Scope** minimal (a single `mcp` scope to start).
- [ ] Reuse existing session verification (`verifyUserSession` / `verifyTwoFactorSessionToken`) — do not re-implement identity.

---

## 10. Client coverage

| Client | Keyless OAuth connector? | Notes |
|---|---|---|
| **Claude Desktop / Claude.ai** | ✅ native "Add custom connector" does the OAuth dance | primary target — this is Higgsfield's flow |
| **Cursor** | ✅ supports MCP OAuth | secondary |
| **Claude Code** | ✅ `claude mcp add <url>` triggers browser OAuth (no `--header` needed) | the "command" disappears too |
| Headless / CI / your own agent | uses the API-key fallback | why we keep keys as Advanced |

---

## 11. Test plan

1. **Metadata discovery** — `curl` both `.well-known` docs, validate against RFC shapes.
2. **DCR** — `POST /oauth/register`, assert a client_id back.
3. **Full handshake against real Claude Desktop** — add the connector, confirm the sign-in
   popup shows "Sign in to auth.getmindy.ai", Allow, then a tool call succeeds and a credit debits.
4. **PKCE/redirect negatives** — tampered verifier rejected; unregistered redirect_uri rejected;
   expired/replayed code rejected; wrong-`aud` token rejected.
5. **Fallback** — an existing `mcp_live_` key still works.
6. **Welcome grant** — first authorize grants 25 credits once; re-auth doesn't re-grant.
7. Extend `scripts/mcp-http-smoke.mjs` with an OAuth-token variant alongside the key variant.

---

## 12. Phasing

- **Phase A (core, ~1.5–2 d):** metadata + DCR + authorize (reusing session) + token +
  JWT validation in the transport behind a flag, API-key fallback intact. Test with Claude Desktop.
- **Phase B (~0.5 d):** `/mcp` page → keyless 3-step ("copy URL → add connector → sign in");
  demote keys to Advanced; move the 25-credit grant to first-authorize.
- **Phase C (~0.5 d):** refresh-token rotation, `/oauth/revoke` + a "Disconnect" button, smoke-test coverage.

**Total: ~2–3 focused days.** Security-sensitive; Phase A ships behind a flag and is not
promoted on the page until the real Claude Desktop handshake is verified.

---

## 13. Open questions for Eric

1. **Same origin** (`getmindy.ai` is both AS + RS) vs a dedicated `auth`/`mcp` split — I recommend same origin; simpler, fewer CORS/DNS moving parts.
2. **Keep API keys** as an Advanced fallback? — I recommend yes (headless/CI need them).
3. **Consent screen copy/branding** — "Allow **Claude** to access your Mindy account (SAM search, playbooks, financials). It can spend your credits." — OK, or reword?
4. **Welcome grant** move to first-authorize — confirm.
5. Any client besides Claude Desktop/Cursor/Claude Code you want verified before we call it done?
