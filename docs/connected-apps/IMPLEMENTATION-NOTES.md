# Connected business apps: implementation notes

Spec: [CONNECTED-APPS-SPEC-2026-11-24.md](./CONNECTED-APPS-SPEC-2026-11-24.md). This file records what was checked before building, what was reused, what is built, and what only an admin can do. Independent of PR #2421. Agent 4 owns review and release.

## 1. Inventory of existing infrastructure (origin/main, 2026-11-24)

| Looked for | Found | Decision |
|---|---|---|
| Google/Microsoft business-API OAuth | None. Sign-in is Supabase Google/Azure (`src/lib/supabase/auth.ts`), with the client credentials held in the Supabase dashboard. Its grants do not authorize Drive, Gmail, Calendar or Graph. | New, separate consent flow, as the spec requires. Sign-in is untouched. |
| Encrypted credential storage | `src/lib/crypto/secretbox.ts` (AES-256-GCM, authenticated) | **Reused** for refresh and access tokens. |
| Connection table | `user_crm_connections`: one GoHighLevel token per `owner_email`. No workspace scope, refresh token, scopes or status. | **Not reused.** It's the wrong shape. New `connected_accounts`. |
| OAuth routes under `src/app/oauth`, `src/lib/mcp/oauth` | Mindy acting as the OAuth **server** for MCP clients (the opposite direction). | Not reused. The signed-state technique mirrors `mcp/oauth/tokens.ts`. |
| Google API clients (`src/lib/gsc`, `src/lib/ga4`, BigQuery) | Service-account access to Mindy's own Google properties | Not applicable. These connectors act on the customer's behalf, with delegated access. |
| Whose data (acting scope) | `resolveChatActingScope` / `vaultEmailFor` (`src/lib/chat/chat-acting-scope.ts`), the same resolver as Vault and chat | **Reused.** A connection belongs to `own:<email>` or `ws:<workspaceId>`. An unconfirmed workspace refuses. |
| Document text extraction | `src/lib/documents/extract.ts` (pdf, docx, txt, xlsx) | Will be reused for selected-file reads (Slice A, part 2). |
| Chat tool execution and confirmation | `src/lib/chat/chat-tool-executor.ts`, `chat-tool-policy.ts` | Will be extended for `read_connected_file` and later the write tools. No direct LLM-to-provider calls. |

## 2. Built in Slice A, part 1 (branch `feat/connected-apps-slice-a`, flag off)

- `src/lib/connected-apps/config.ts`
  - Providers, endpoints, and least-privilege scopes per capability (from the spec's table).
  - Never `drive.readonly`, `drive`, `gmail.send`, `Mail.Send`, `Sites.*` or `*.All`. This is asserted by a test.
  - Flag: `CONNECTED_APPS` + `CONNECTED_APPS_ALLOWLIST`.
- `src/lib/connected-apps/oauth.ts`
  - Authorization code flow with PKCE S256.
  - An HMAC-signed, 10-minute state that binds the verified user, the acting scope, the capabilities and a same-origin return path. The PKCE verifier is encrypted inside it.
  - Server-side code exchange.
  - Provider identity: Google `sub`, Graph `id`.
  - Refresh, and revoke where the provider supports it (Google yes; Microsoft has no per-grant revoke, so disconnect discards our token).
  - Provider errors become sanitized codes.
- `src/lib/connected-apps/store.ts`
  - Every read is filtered by acting scope; there is no lookup by id alone.
  - Tokens are encrypted and never returned in views.
  - Refreshes when the token is near expiry.
  - A dead grant becomes `reauth_needed` and fails closed. A transient failure does not.
  - Disconnect revokes and then nulls the tokens.
- Routes:
  - `POST /api/app/connected-apps/start`: authenticated; returns the consent URL.
  - `GET /api/app/connected-apps/callback`: signed state only; returns to the conversation with `connect=ok|error`.
  - `GET` / `DELETE /api/app/connected-apps`: list and disconnect, scope-checked.
- Migration `supabase/migrations/20261124_connected_accounts.sql`: **authored, not applied.** RLS on with no policies (service role only). Unique on `(scope_key, provider, provider_account_id)`.

Tests cover:
- state round-trip, tamper, expiry, no clear verifier;
- open-redirect guard;
- scopes and PKCE in the URLs;
- the forbidden-scope assertion;
- sanitized token errors;
- identity mapping;
- scope isolation (list, use, disconnect);
- encryption at rest;
- refresh, reauth and transient failures;
- disconnect;
- the route gates (401, 404, 409, 503);
- a client-workspace scope bound into the state;
- cancelled consent;
- a successful callback;
- a sanitized failed callback.

## 3. What only an admin can do (blocks live testing, not the code)

1. **Google Cloud** (the project that owns Mindy's OAuth consent screen):
   - Create an OAuth 2.0 **Web** client for connectors, separate from Supabase sign-in.
   - Register the redirect URIs `https://getmindy.ai/api/app/connected-apps/callback` and the preview equivalents.
   - Enable the **Drive API, Google Picker API, Gmail API and Calendar API**.
   - Add the scopes `drive.file`, `gmail.compose` and `calendar.events.owned` to the consent screen.
   - Create a **browser API key** restricted to the Picker API, and note the **project number** (the Picker `appId`).
   - Check `gmail.compose` verification requirements in the console before any public activation (spec §5).
2. **Microsoft Entra ID**:
   - Create an app registration, multi-tenant with personal accounts as decided, with the same redirect URI and a client secret.
   - Add the delegated permissions `openid profile email offline_access User.Read Files.Read Mail.ReadWrite Calendars.ReadWrite`. **No `Mail.Send`.**
   - Some customer tenants will require admin consent. The callback reports the tenant's refusal code to the customer.
3. **Environment variables** (production changes need Eric plus Agent 4):
   - `CONNECTED_APPS_GOOGLE_CLIENT_ID`, `CONNECTED_APPS_GOOGLE_CLIENT_SECRET`
   - `CONNECTED_APPS_MICROSOFT_CLIENT_ID`, `CONNECTED_APPS_MICROSOFT_CLIENT_SECRET`, optional `CONNECTED_APPS_MICROSOFT_TENANT`
   - `CONNECTED_APPS_STATE_SECRET`
   - **a dedicated `CRM_TOKEN_ENC_KEY`.** `secretbox` falls back to `MCP_OAUTH_SIGNING_SECRET` / `ADMIN_PASSWORD`. If one of those were rotated, every stored token would become unreadable, so set a dedicated key before storing customer refresh tokens.
   - Picker: `NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY` and `NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID`.
   - `CONNECTED_APPS` + `CONNECTED_APPS_ALLOWLIST`.
4. **Migration:** `npm run migrate -- --go --only 20261124_connected_accounts.sql`, after Agent 4 review and Eric's approval.

## 4. Next slices

- **Slice A, part 2:** file selection (Google Picker with `drive.file`; OneDrive file picker) and a provider-neutral `read_connected_file` chat tool.
  - It reads only the selected file and extracts bounded text with `extract.ts`.
  - The output carries `provider`, `connected_account`, `source_id`, `source_url` and `retrieved_at` provenance, separate from federal-record provenance.
  - Prompt-injection guard on file content.
- **Slice B:** `create_outreach_draft`.
  - Server-validated approval of the exact payload (action id plus payload hash).
  - Gmail `users.drafts.create` or Graph `POST /me/messages`. Never send.
  - No invented recipients.
  - A `connected_actions` table for idempotency.
- **Slice C:** `create_followup_event`: a personal event with no attendees, deduplicated by action id.
- **Slice D:** in-chat status and links, History restore, reconnect UX, a controlled test-account rollout.

## 5. Notes for review

- **The callback can't re-check a client-workspace authorization**, because it receives no session header. The workspace binding is verified at `/start` and carried in a signed state that lives 10 minutes. Execution-time tools (Slice A part 2 onward) re-resolve the acting scope on every call, as spec §4 requires.
- **Revoking a grant at the provider.** Google: when someone revokes access in their Google account, the next refresh returns `invalid_grant`, which marks the connection `reauth_needed`. Microsoft: same, via `invalid_grant` or `interaction_required`.
