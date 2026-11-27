# Mindy Connected Business Apps — Google Workspace + Microsoft 365

**Product and engineering specification | November 24, 2026 | Proposed, not approved or implemented**

## Executive decision

**Build connectors, not an ERP.** Let a customer give Ask Mindy permission to use their existing Google Workspace or Microsoft 365 account to complete useful work after Mindy produces market intelligence. Mindy remains the intelligence and action layer; Google and Microsoft remain the systems where files, drafts and calendar events live.

**First customer job:** "Find a contract worth pursuing, use my capability statement, prepare the buyer outreach, and set a follow-up." The customer should complete that job inside Ask Mindy, using their selected business account, without copying between five apps.

This is a **new, separate Ask Mindy integration capability**. It must not delay PR [#2421, intelligence gate](https://github.com/ecoffie/market-assassin/pull/2421), change Opportunity Map behavior, or duplicate Data Core search or Design & Output report-building. No pricing or billing redesign in this scope.

## 1. Customer problem and product bar

**Problem:** Small businesses already have documents, mail and calendars, but their research-to-action workflow is fragmented. After Mindy recommends a pursuit, the customer must find a capability statement, prepare an email, open another app, then remember to follow up. Government market intelligence becomes useful when it turns into work they can complete.

**Customer-facing promise:** "Connect your business account once. Ask Mindy can use the files you choose, prepare drafts and create follow-ups with your approval. You stay in control."

**Not the promise:** an ERP; autonomous business administration; access to every employee's inbox; replacement of Google/Microsoft; automatic sending or submitting a bid; a new AI model or fine-tuning effort.

**Definition of first success:** An authenticated customer, using either supported provider, selects one existing capability file; Mindy cites its content while preparing pursuit-specific outreach based on verified government records; the customer approves an email draft and calendar follow-up; Mindy returns working links to those objects and can recognize them in the current pursuit context.

**Opportunity-cost rule:** Prefer one complete, reliable workflow to fifteen shallow integrations. Do not build a generalized workflow marketplace, background mailbox agent, cross-tenant enterprise sync or new file editor in v1.

## 2. Existing Mindy foundation: reuse, don't rebuild

The following is verified from repository `main` as inspected on November 24, 2026; it is **not evidence the integrations already exist**.

- `src/lib/supabase/auth.ts` lines 176–231: Google and Microsoft/Azure sign-in are supported. Microsoft requests `email profile openid`. Google sign-in includes offline/consent parameters. **These sign-in grants do not themselves authorize Gmail, Drive, Outlook or OneDrive APIs.**
- `src/app/api/app/chat/route.ts`: Ask Mindy has a native authenticated backend, history, selected-opportunity context, source handling, Vault acting scope, and tool orchestration. Reuse these; never make Opportunity Map UI controls a dependency.
- `src/lib/chat/chat-tool-executor.ts` and `src/lib/chat/chat-tool-policy.ts`: existing tool offer/execute checks, confirmation-oriented classifications, quotas and structured logs. Extend this safety model rather than letting an LLM call provider endpoints directly.
- `docs/ask-mindy/IMPLEMENTATION-OWNERSHIP.md`: Ask Mindy owns experience and orchestration; Data Core owns federal-source evidence; Design & Output owns output quality; Agent 4 controls independent review and release.

**Before adding code, the assigned owner should check whether any existing integration credential store, OAuth callback, document picker, or provider adapter already serves this purpose.** No duplicate auth path.

## 3. V1 experience and interfaces

### A. Connect account

From **Ask Mindy → Connect business apps** (also accessible in existing Settings):

1. Pick **Google Workspace** or **Microsoft 365**.
2. Choose a specific account; show the provider identity and account email before linking it to the active Mindy workspace.
3. Explain permissions in plain language, requested **only when needed**: selected documents, email drafts, and calendar follow-ups.
4. Complete provider OAuth authorization and return to the same Mindy conversation.
5. See a connection status, connected address, available capabilities, and **Disconnect** / **Reconnect** actions.

Allow a Mindy user to connect an account different from their Mindy sign-in provider, or both providers. A connection belongs to an **authorized acting scope**; one customer's connected account must never leak into another customer or client workspace.

### B. One complete pursuit-to-action journey

> Customer: "Find three Florida maintenance opportunities my company could realistically pursue. Use the capability statement in my Drive to draft outreach to the best buyer and remind me to follow up next Tuesday."

1. **Research:** Ask Mindy/ Data Core recommend specific opportunities, supported by record IDs and eligibility caveats.
2. **Choose evidence:** Ask Mindy offers **Select a file**; the customer chooses the capability statement in their connected Google Drive or Microsoft OneDrive. Mindy reads only the authorized file and attributes the claims it uses to that file.
3. **Propose outreach:** Show buyer/office, source, email recipient if verified, subject and draft body. If there is no verified address, leave recipient blank and show the relevant office instead; **never invent an email address**.
4. **Approve draft creation:** On explicit confirmation, create a draft in the connected Gmail or Outlook account. Return the actual draft identifier/link when provided by the API. **Do not send.**
5. **Approve follow-up:** Confirm date, time zone, calendar, description and whether any attendees will be invited; in v1 create a **personal follow-up event with no external attendees**. Return the event link/identifier.
6. **Continue in chat:** Respond with a concise recap: opportunity, outreach draft created, follow-up scheduled. Keep the action and source references associated with this authorized conversation or pursuit.

If the customer has no connected account, offer the same **copyable draft within Mindy** and a calendar suggestion. Do not fail the entire intelligence answer just because the connector is unavailable.

### C. Initial capability matrix

| Capability | Google | Microsoft | V1 outcome |
|---|---|---|---|
| Link account | OAuth delegated consent | Microsoft identity delegated consent | Customer-controlled account connection |
| Select and read company file | Google Picker + Drive API, selected-file access | OneDrive file selection/Graph API | Source-backed capability context |
| Draft email | Gmail API `users.drafts.create` | Graph `POST /me/messages` | Draft saved, not sent |
| Create personal follow-up | Google Calendar Events insert | Graph Events create | Calendar item, no invitees by default |
| Open created object | Provider deep link or ID | Provider web link or ID | Verified working link or explicit limitation |
| Disconnect | Revoke when supported; discard token | Revoke/disconnect; discard token | No further provider calls |

**V1 exclusions:** full mailbox search/reading, auto-send, deleting or modifying existing messages, bulk contact import, organization-wide SharePoint search, Teams posting, spreadsheet writes, autonomous recurring workflows, finance, accounting, payroll, inventory, CRM replacement, and auto-ingestion of all documents. Later iterations require observed customer demand.

## 4. Architecture and tool contract

```text
Ask Mindy (same existing conversation and acting workspace)
    ├── Data Core intelligence (unchanged)
    ├── Connected Apps service
    │      ├── Scoped connection / OAuth credentials
    │      ├── Provider adapters: Google | Microsoft
    │      └── Normalized files / drafts / calendar responses
    └── Existing chat tool executor + policy
            ├── read_connected_file            [read; selected file only]
            ├── create_outreach_draft            [write; explicit approval]
            └── create_followup_event           [write; explicit approval]
```

**Contract rules:**

- Tools accept a provider `connection_id` (or account choice), document ID, draft fields, event fields and optional verified opportunity ID. **Never accept an arbitrary user email, workspace ID, OAuth token or tenant ID from the LLM as authority.** Resolve all authority server-side from authenticated session and acting workspace.
- Tool outputs include `provider`, `connected_account`, `source_id`, `source_url` when valid, `retrieved_at`, `action_status`, `provider_object_id`, and audit-safe failure category. Company facts and buyer facts keep their distinct provenance.
- Reuse the existing confirmation policy, but implement an actual server-validated approval for the proposed payload. An assistant statement like "the user confirmed" is not authorization.
- Re-check the user/workspace binding and provider grant at execution time. Model planning is advisory; server execution is authoritative.
- Do not pass entire files or inboxes into a model. Extract bounded, task-relevant text, preserve citations, and respect existing private-data/model rules.
- **No provider send endpoints in v1.** Creating a draft is the maximum email action. No external attendee invitations in v1.
- Idempotency: bind each approved action to a stable server-generated action ID, account, payload hash and provider object ID. Retrying a request or restoring a chat must not create duplicate drafts or calendar events. Store a precise success/unknown/failed result rather than assuming a timeout means nothing happened.

### Minimal persistent model (implementation-agnostic)

**`connected_accounts`**: encrypted credential reference; provider; provider immutable account ID; connected email; Mindy owner user ID; authorized workspace; granted scopes; status (connected, reauth_needed, revoked); created/updated timestamps. Never store raw tokens in chat transcript, logs or model context.

**`connected_actions`**: immutable approval/action ID; acting user/workspace; provider connection ID; type; confirmed payload hash; source IDs; execution state; provider object ID/URL; timestamps; sanitized error code. Deduplicate by action ID.

**`connected_file_refs`** (optional v1): user-selected resource ID, provider, owner/workspace, file title/type/last-read metadata. Do not replicate the entire document repository or silently index all files.

The exact table names must conform to existing database conventions and ownership checks; no schema migration should be proposed if current infrastructure already fits.

## 5. OAuth, scopes, and data security

**Identity vs authority:** Existing Mindy sign-in and 2FA authenticate the Mindy user. Each connected account still needs its own OAuth authorization for business APIs. The customer may connect an account from a different provider than the one used to sign in.

Implement standard authorization-code flow with PKCE where supported, validated `state`/callback binding, server-side token exchange, encrypted refresh token storage, refresh/reauthorization, connection revocation and least privilege. Access remains **delegated on behalf of the customer**, not an app-wide impersonation grant.

**Incremental scopes by action:**

| Step | Google scope(s) to evaluate | Microsoft Graph delegated scope(s) to evaluate |
|---|---|---|
| Connection / account identity | `openid`, `email`, `profile` | `openid`, `profile`, `email`, `User.Read`, `offline_access` as required |
| User-selected file | `https://www.googleapis.com/auth/drive.file` with Google Picker (grant limited to picked files) | `Files.Read`: the grant covers **all** of the signed-in user's OneDrive files, not only picked ones; Mindy reads only the picked file, and the customer is told before consent. Broader SharePoint access not assumed |
| Save email draft | `https://www.googleapis.com/auth/gmail.compose` | `Mail.ReadWrite` (no `Mail.Send`) |
| Personal calendar follow-up | `https://www.googleapis.com/auth/calendar.events.owned` where sufficient; otherwise `calendar.events` | `Calendars.ReadWrite` |

**Critical permission differences:**

- Google `drive.file` supports user-selected files rather than unrestricted Drive search. Do not promise to search the entire Drive with this grant. Google `drive.readonly` is a **restricted** scope; avoid it in v1.
- Google `gmail.compose` permits both **drafting and sending** at the OAuth level. Application policy must strictly prohibit sending, with the provider send operation unavailable in the v1 executor. Scope classification/verification must be checked in the actual Google Cloud console before public activation.
- Microsoft `Mail.ReadWrite` permits mail read/write operations beyond draft creation, although it does **not** confer sending permission. The app must expose only draft creation and never broader mailbox operations in v1.
- **`Files.Read` is not selection-limited.** It lets the app read every file in the user's OneDrive. Microsoft offers no delegated per-picked-file permission for self-service consent, so the selection limit is an application rule, not a provider rule. The pre-consent note must say so plainly (`ACCESS_DISCLOSURE` in `src/lib/connected-apps/config.ts`). Never describe Microsoft file access as "only files you pick". Also: accessing shared SharePoint sites may require broader or selected-resource grants plus explicit resource assignments. Do not silently request broad permissions. Some tenant policies require administrator approval even for normally user-consentable delegated scopes.
- Google scope verification and possibly security assessment depend on actual scopes and data handling. Keep launch readiness separate per provider: one approved adapter can launch without waiting for the other.
- No workspace-wide or domain-wide delegation; no automatic access to colleagues' mailboxes; no background scanning.

**Guardrails:** secure tokens and key rotation; least-privilege DB access/RLS; CSRF protection; canonical provider user ID; tenant/workspace isolation; source-content prompt-injection protection; data-retention limits; explicit disconnect and deletion handling; sanitized telemetry; rate limits/provider 429 handling; no cross-provider account mixup; never put sensitive documents in provider/model logs.

Do not disclose one workspace's connected files to a user acting for another client without verified client authorization. Recognize shared-mailbox and admin-consent limitations explicitly.

## 6. Implementation sequence: independent vertical slices

**Slice A — Connect and selected-file read**
- Reuse current sign-in session; introduce a separate *Connect business account* OAuth consent flow.
- Build common connection record, account picker/status, revocation and encrypted credential handling.
- Support Google Picker + `drive.file`, and a OneDrive selection/read flow using delegated Graph access.
- Add one provider-neutral read tool and return file provenance into Ask Mindy's normal evidence model.
- Demo: "Use this capability statement to tailor your recommendation for this opportunity." Both providers independently tested.

**Slice B — Outreach draft**
- Use the same verified opportunity/office and selected-file evidence.
- Confirm recipient, subject, body and account; create a Gmail or Outlook draft, never send.
- Return an actual provider object ID/link, or say exactly what cannot be verified.

**Slice C — Calendar follow-up**
- Confirm account, calendar, local date/time/time zone and personal event details.
- Create one personal follow-up with no external attendees. Prevent duplicates on retry.

**Slice D — Native continuity and controlled rollout**
- Display created-action status and links in the existing Ask Mindy conversation; restore safely in History.
- Implement reconnect/disconnect and intelligible permission errors.
- Run controlled test accounts; Agent 4 independently reviews and verifies before activating more users.

Do not delay any slice for a full ERP, generalized agent framework, full inbox search, all SharePoint tenants or a synchronized company knowledge base. Google and Microsoft share an interface; adapters can reach release readiness separately.

## 7. Ownership and decision rights

- **Ask Mindy:** customer flow, request/intent, provider-neutral action tools, connection and workspace policies, chat completion, action confirmation and continuity.
- **Data Core:** no new work unless there is a concrete federal record/sourcing defect. Government opportunities and contacts still originate from verified Data Core evidence.
- **Design & Output:** use existing report/draft formats. Own any later document export polish; v1 does not require a new renderer.
- **Opportunity Map:** unchanged; Ask Mindy's intelligence or connectors must not depend on map filters/navigation.
- **Agent 4:** overlap check, privacy/security review, tests, feature/env gating, release verification, and escalation of genuinely material issues. Routine GREEN merges follow existing release policy.

Before assigning implementation, review existing auth, Vault and connection tooling to identify the owner and avoid duplicate components. No new standing agent team is necessary.

## 8. Acceptance checks (observable customer outcomes)

1. **Connect:** Google and Microsoft each work with a chosen business account; the displayed connected identity matches the grant. An unrelated account in the browser is not linked by mistake.
2. **Read:** A user deliberately selects a capability file. Ask Mindy can cite an exact relevant passage/record. Unselected files are inaccessible on the narrow Google grant.
3. **Business judgment:** Mindy ties the file to a real opportunity and generates a buyer-specific proposed email, not generic marketing copy or a technical report.
4. **Draft:** Explicitly approved draft appears in the chosen provider account. It has correct recipient when verified, does not send, and returns a stable ID/link.
5. **Calendar:** Explicitly approved follow-up appears in the correct calendar and time zone; no external invitation goes out; repeated request does not create duplicates.
6. **Isolation:** Two users or client workspaces cannot read or write one another's connected files, drafts or events. A provider account mismatch fails closed.
7. **Revocation:** Disconnect prevents new provider calls. Expired or revoked grants prompt reconnect without destroying the Mindy intelligence answer.
8. **Reliability:** Provider 401/403/429/5xx, network timeout and ambiguous post-write result are handled without falsely reporting success, duplicate writes or leaking token contents.
9. **Flag-off:** Existing Ask Mindy, MCP, intelligence gate and report paths behave as before when the integration flag is off.
10. **Customer experience:** A test customer completes the opportunity → chosen file → approved draft → approved reminder journey without leaving the Mindy chat except for provider consent and optional deep links.

**Measure use, not PR volume:** eligible-to-connected conversion; first successful file use; first approved draft and event; action failure/duplicate rate; customers who return to continue a pursuit; qualitative reports of saved time and usefulness. Do not count a successful API response as proof of customer value.

## 9. Explicitly deferred

Full mailbox search/summary, Teams posting, SharePoint site-wide indexing, unlimited cross-tenant enterprise access, Google Sheets/Excel modifications, document edits, CRM/accounting/payment integration, auto-sending email, auto-bidding, background unattended customer actions, user billing changes, model fine-tuning, full ERP modules. Reconsider only with a demonstrated customer problem and an owner.

## 10. Open product decisions (do not block a prototype)

1. Initial pilot cohort: a small mix of Google and Microsoft users who already complete pursuits in their respective suites. Do not assume which is dominant without usage evidence.
2. Microsoft v1 file boundary: personal OneDrive only, or customer-selected SharePoint files after delegated permission/tenant review? Default **OneDrive first**.
3. Provider consent strategy: staged file, draft and calendar grants (recommended), and whether users link more than one account per provider at v1 (allow in data model; keep UI single-account selection per action).

None of these decisions changes the core product direction: **connect the business tools customers already use and let Ask Mindy turn verified intelligence into approved actions.**

## Official API and policy references (review at implementation)

- Mindy existing Google/Azure sign-in: https://github.com/ecoffie/market-assassin/blob/main/src/lib/supabase/auth.ts#L176-L231
- Mindy chat tool policy: https://github.com/ecoffie/market-assassin/blob/main/src/lib/chat/chat-tool-policy.ts
- Google Drive authorization and `drive.file`: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Picker: https://developers.google.com/workspace/drive/picker/guides/overview
- Gmail create draft: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- Google Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google Calendar event create: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- Google OAuth verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- Microsoft Graph delegated permissions: https://learn.microsoft.com/en-us/graph/permissions-overview
- Microsoft Graph permissions: https://learn.microsoft.com/en-us/graph/permissions-reference
- Microsoft Graph create draft: https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0
- Microsoft Graph create event: https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0
- Microsoft Graph files: https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
- Microsoft selected-permission model: https://learn.microsoft.com/en-us/graph/permissions-selected-overview
