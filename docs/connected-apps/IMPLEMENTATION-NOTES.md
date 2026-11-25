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
  - **This slice defines file access only.** Mail and calendar scopes are not in the code; they arrive, and get reviewed, with the slice that ships the tool that uses them.
  - Never `drive.readonly`, `drive`, `gmail.send`, `Mail.Send`, `Sites.*` or `*.All`. This is asserted by a test.
  - **Honest access note (`ACCESS_DISCLOSURE`).** `/start` returns `access_note`, which the UI shows before sending the customer to consent. Google `drive.file` is limited to picked files. Microsoft `Files.Read` covers **all** of the user's OneDrive files; Mindy reads only the picked file, and the note says the grant is broader.
  - Flag: `CONNECTED_APPS` + `CONNECTED_APPS_ALLOWLIST`.
- `src/lib/connected-apps/oauth.ts`
  - Authorization code flow with PKCE S256.
  - An HMAC-signed, 10-minute state that binds the verified user, the acting scope, the capabilities and a same-origin return path. The PKCE verifier is encrypted inside it.
  - **Browser binding.** `/start` sets a random `mindy_ca_bind` cookie (HttpOnly, Secure, SameSite=Lax, path = the callback, 10 minutes) and puts its SHA-256 in the state. The callback refuses with `browser_mismatch` unless the same browser presents the matching cookie, and clears it on every outcome. A consent link forwarded to someone else therefore connects nothing.
  - **Dedicated secrets, required.** `CONNECTED_APPS_STATE_SECRET` signs; `CONNECTED_APPS_TOKEN_ENC_KEY` encrypts (own salt). Both at least 32 characters and different. There is no fallback to `ADMIN_PASSWORD`, `MCP_OAUTH_SIGNING_SECRET` or `CRM_TOKEN_ENC_KEY`; without them the routes answer 503 `not_configured` and the store refuses to write.
  - Server-side code exchange.
  - Provider identity: Google `sub`, Graph `id`.
  - Refresh, and revoke where the provider supports it (Google yes; Microsoft has no per-grant revoke, so disconnect discards our token).
  - Provider errors become sanitized codes.
- `src/lib/connected-apps/store.ts`
  - Every read is filtered by acting scope **and the Mindy user who connected the account** (`owner_email`). In a client workspace shared by several coaches, one coach can never list, use or disconnect a colleague's connection. There is no lookup by id alone (Agent 4 review, fixed in `bb750006`).
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
   - Add the scope `drive.file` to the consent screen. (`gmail.compose` and `calendar.events.owned` are added later, with the slices that use them.)
   - Create a **browser API key** restricted to the Picker API, and note the **project number** (the Picker `appId`).
2. **Microsoft Entra ID**:
   - Create an app registration, multi-tenant with personal accounts as decided, with the same redirect URI and a client secret.
   - Add the delegated permissions `openid profile email offline_access User.Read Files.Read`. **No `Mail.Send`.** (`Mail.ReadWrite` and `Calendars.ReadWrite` are added later, with the slices that use them.) Note `Files.Read` covers all of the user's OneDrive files.
   - Some customer tenants will require admin consent. The callback reports the tenant's refusal code to the customer.
3. **Environment variables** (production changes need Eric plus Agent 4):
   - `CONNECTED_APPS_GOOGLE_CLIENT_ID`, `CONNECTED_APPS_GOOGLE_CLIENT_SECRET`
   - `CONNECTED_APPS_MICROSOFT_CLIENT_ID`, `CONNECTED_APPS_MICROSOFT_CLIENT_SECRET`, optional `CONNECTED_APPS_MICROSOFT_TENANT`
   - `CONNECTED_APPS_STATE_SECRET` and `CONNECTED_APPS_TOKEN_ENC_KEY`: **required**, 32+ random characters each, different from each other. Without them the feature refuses to run. Rotating `CONNECTED_APPS_TOKEN_ENC_KEY` makes stored connections unreadable (customers reconnect), so treat it as long-lived.
   - Picker: `NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY` and `NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID`.
   - `CONNECTED_APPS` + `CONNECTED_APPS_ALLOWLIST`.
4. **Migration:** `npm run migrate -- --go --only 20261124_connected_accounts.sql`, after Agent 4 review and Eric's approval.

## 3b. Built in Slice A, part 2 (branch `feat/connected-apps-slice-a2`, stacked on #2424, flag off)

Use a file from Drive or OneDrive in Ask Mindy: server side plus the Ask Mindy control.

- **Selection is the authority, not the model.** File handles also carry the picker's email, so a colleague in the same workspace is refused (`other_user`).
- **Selection details:**
  - `POST /api/app/connected-apps/selections` confirms the picked file through the connection's own grant (exists, readable type, under 15 MB).
  - It returns a **file handle**: HMAC-signed (domain-separated from the OAuth state), bound to the acting scope, the connection, the provider and the file id, valid 24 h.
  - `read_connected_file` accepts only a handle. A raw file id from the model, a forged handle, or one signed for another workspace is refused before any provider call.
  - This is what limits Microsoft `Files.Read` to the file the customer chose.
- **Every read re-checks.** The acting scope is re-resolved from the closure, the handle is re-verified against it, the connection is re-checked (revoked or reauth needed fails closed), and the provider must return the same file id.
- **One extraction pipeline.** Bytes are capped at 15 MB (metadata and body) and extracted by `src/lib/documents/extract.ts`. Native Google Docs and Sheets are exported to .docx and .xlsx. NUL bytes are stripped.
- **Untrusted content.** Text is fenced with the same `UPLOADED_DOCUMENT` fence and rule as uploads (a file cannot close its own fence). Results go into the turn's document texts for the web-search privacy guard.
- **Provenance.** Each read returns provider, connected account, source id, source link, modified date and retrieval time, kept separate from federal-record provenance.
- **Chat wiring.**
  - The client sends `connectedFiles` (handles). The server verifies them and adds a note listing the picked files.
  - `read_connected_file` is offered only on a turn with a verified selection, never in card chat. It is a free tool, classified as a chat-private read in `chat-tool-policy.ts`.
  - The trace records `connected_files:<n>[:dropped=<m>]`.
- **`POST /api/app/connected-apps/picker-token`** gives the browser picker a short-lived **access** token (never the refresh token, `no-store`), plus the public Google Picker key and app id. This is the provider-documented pattern.
- **Ask Mindy control (`src/components/app/chat/ConnectedFiles.tsx`).**
  - Hidden unless the list endpoint answers, so it is invisible while the flag is off.
  - Connect shows the server's `access_note` and leaves Mindy only on "Continue". The consent outcome (`connect=ok|error`) is shown in plain words, then stripped from the address bar.
  - Google uses Google's own Picker (`drive.file`). The pick is exchanged for a handle and shown as a removable chip (up to 5). Handles go with every question as `connectedFiles` and are cleared on New chat.
  - **OneDrive uses Mindy's own chooser (`OneDriveChooser.tsx`), not Microsoft's v8 picker.**
    - Per Microsoft's docs (learn.microsoft.com/onedrive/developer/controls/file-pickers), the v8 picker runs on SharePoint tokens, not Graph, and "you cannot reuse tokens for Graph calls". It needs extra delegated permissions: SharePoint `MyFiles.Read` for business, `OneDrive.ReadOnly` for personal accounts. It also needs a SharePoint token in the browser.
    - Those widen the consent screen and the review for no added capability, because the `Files.Read` grant already reads the user's own files.
    - So `POST /api/app/connected-apps/browse` lists or searches the user's OWN OneDrive through Graph on the existing grant, at the customer's click. It returns folders and readable files only, metadata only, with no-store caching.
    - The Microsoft token never reaches the browser, and `/picker-token` is now Google-only.
    - Picks go through the same signed-handle `/selections`. The model still cannot list or search a drive.
- **Tests:** 35 new (OneDrive listing, OData quote escaping, provider refusals, chooser flow; plus handle signing, isolation, expiry, domain separation, provider mapping and errors, export vs download, size cap, NUL strip, fence integrity, coach/client isolation, dead connection, file-id swap, route gates, token response shape).

## 3c. Live acceptance (Slice A), each provider independently

Not run yet. As of 2026-11-24 there are no `CONNECTED_APPS_*` variables in any environment, and `20261124_connected_accounts.sql` is pending.

**Setup (one preview branch, never production):**
1. Admin console:
   - Google OAuth web client with the Drive and Picker APIs, the `drive.file` scope, and a Picker key.
   - Entra app with `Files.Read` and no `Mail.Send`.
   - In both, register the redirect URI `https://<preview branch alias>/api/app/connected-apps/callback`.
2. Migration, after Agent 4 and Eric approve: `npm run migrate -- --go --only 20261124_connected_accounts.sql`. The database is shared, so this creates the table in production (empty, service-role only).
3. Preview-branch-scoped variables on a **Git-built** preview. CLI deploys do not get branch-scoped variables.
   - `CONNECTED_APPS=true`, `CONNECTED_APPS_ALLOWLIST=<test account>`
   - `CONNECTED_APPS_STATE_SECRET` and `CONNECTED_APPS_TOKEN_ENC_KEY` (fresh, 32+ characters, preview only)
   - `CONNECTED_APPS_REDIRECT_BASE=https://<preview branch alias>`
   - the Google and Microsoft client id and secret
   - `NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_PICKER_KEY` and `NEXT_PUBLIC_CONNECTED_APPS_GOOGLE_APP_ID`

**Acceptance preview (ready, 2026-11-24):**
- Branch `preview/ca-accept`, Git-built.
- Stable address: `https://market-assassin-git-preview-ca-accept-eric-coffies-projects.vercel.app`
- Callback: `https://market-assassin-git-preview-ca-accept-eric-coffies-projects.vercel.app/api/app/connected-apps/callback`
- Set on that branch only: the flag, allowlist (`erika@govcongiants.com`), redirect base, and two fresh secrets.
- Eric adds the client id/secret pairs and the Picker key and app id. After that, rebuild the preview with an empty commit on the branch.

**Per provider, independently (one does not wait for the other):**
1. Connect. Check the access note shows before consent and the result shows after.
2. Run each case with the same question, A without the file and B with it.
3. Run `npx tsx --env-file=.env.local scripts/acceptance/connected-file-ab.mts ...` (usage in the script header).
4. Disconnect. Confirm the token is discarded and a later read fails closed.

**Cases:**
- **Material:** `material-cap-statement.txt` against the known opportunity **VA janitorial `36C24823P1623`** (Florida, SDVOSB set-aside, ends 2027-08-31). B's assessment of that opportunity must change because of the document's SDVOSB claim, with a verified quote.
  - There is no "unchanged but justified" pass: a convincing explanation must not hide that the document had no influence.
- **Relevance:** `overview-cap-statement.txt`, with no prescribed outcome. Every change must cite a verified quote that is relevant to the opportunity it changes. Green-cleaning products can legitimately matter for janitorial work.

**Gates on every run:**
1. The trace shows the file was read.
2. Every document claim has a verbatim quote.
3. Nothing contradicts the document.
4. **Certification is not verified eligibility.** Set-asides that rest on the document's 8(a) or SDVOSB claim must be stated conditionally, as needing verification. Presenting the company as eligible outright fails.
5. The case-specific gate above.

## 4. Next slices

- **Slice A, part 2:** built (see 3b), for Google Drive and OneDrive.
  - It reads only the selected file and extracts bounded text with `extract.ts`.
  - The output carries `provider`, `connected_account`, `source_id`, `source_url` and `retrieved_at` provenance, separate from federal-record provenance.
  - Prompt-injection guard on file content.
- **Slice B:** `create_outreach_draft`. Adds the `draft` capability and its scopes (Gmail `gmail.compose`, Graph `Mail.ReadWrite`) for review in that PR.
  - Server-validated approval of the exact payload (action id plus payload hash).
  - Gmail `users.drafts.create` or Graph `POST /me/messages`. Never send.
  - No invented recipients.
  - A `connected_actions` table for idempotency.
- **Slice C:** `create_followup_event` (adds the `calendar` capability and scopes): a personal event with no attendees, deduplicated by action id.
- **Slice D:** in-chat status and links, History restore, reconnect UX, a controlled test-account rollout.

## 5. Notes for review

- **The callback can't re-check a client-workspace authorization**, because it receives no session header. The workspace binding is verified at `/start` and carried in a signed state that lives 10 minutes. Execution-time tools (Slice A part 2 onward) re-resolve the acting scope on every call, as spec §4 requires.
- **Revoking a grant at the provider.** Google: when someone revokes access in their Google account, the next refresh returns `invalid_grant`, which marks the connection `reauth_needed`. Microsoft: same, via `invalid_grant` or `interaction_required`.
