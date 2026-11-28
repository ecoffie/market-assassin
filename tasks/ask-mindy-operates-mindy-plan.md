# Ask Mindy operates Mindy: phased plan (design, not built)

Status: DESIGN ONLY (2026-11-28). No code until after Mindy Day. Server, registry and prompts: Agent 1. Client handlers:
Agent 2. Review and release: Agent 4. Extends the action-registry spec in PR #2502
(`tasks/ask-mindy-app-actions-spec-2026-11-27.md`) and the slice already shipped (#2512, #2547).

## Direction

Eric, 2026-11-28: "the same idea as Notion and HubSpot, not require people to learn how to use all the tabs." Ask Mindy
becomes the way to operate Mindy. A customer says what they want; Mindy proposes a named action; the client runs it
through the **same code as the button** and shows what changed. A view gets Undo; a write needs a one-line confirm
first.

## What exists today (do not rebuild)

- **Registry:** `src/lib/chat/app-actions/registry.ts`, one declaration per action (surfaces, kind, `needsConfirm`,
  gate, model-facing description, strict JSON args schema) plus `validateAction`. The Map's ES5 mirror is checked by
  `app-actions-parity.unit.test.ts`.
- **Server:** `src/lib/chat/app-actions/propose.ts`, the chat-private `propose_app_action` tool:
  - offered only when `ASK_MINDY_APP_ACTIONS` plus its allowlist pass, never on card turns, and only where the surface
    has actions;
  - at most 3 per turn;
  - `open_record` accepts only ids a tool returned this turn;
  - the `pro` gate is checked server-side;
  - a write's reply to the model says it is pending ("Click Add to …", #2547).
- **Shipped on the Map:** `map.apply_view`, `map.search`, `map.set_horizons`, `map.go_to`, `map.open_record` (views), and
  `map.save_search`, `map.update_alert`, `map.add_to_pursuits`, `map.remove_from_pursuits` (writes, confirmed,
  executed by `POST /api/app/mindy-actions`).
- **Deep links that already exist:**
  - `/app?panel=<AppPanel>` (`src/components/app/UnifiedSidebar.tsx`);
  - Settings tabs via `section=` (`src/lib/app/settings-tabs.ts`: matching, profile, billing, team, account, plus the
    older `alerts`, `notifications`, `credits`, `security` and their anchors);
  - Vault sections (`src/lib/app/deep-link-params.ts`).
- **Settings writes the page uses today:** `POST /api/alerts/preferences` (alerts on/off, frequency, NAICS, PSC,
  keywords, agencies, states) and `POST /api/briefings/preferences`, both called from
  `src/components/app/panels/UnifiedSettingsPanel.tsx`.

## Rules for every phase

1. **No second engine.** Every action calls the route or function behind today's control. No control means no action.
2. **Server proposes, client executes.** The model never sends a URL, selector or free code; it sends a registry name
   and typed args.
3. **Validated twice:**
   - the server checks the registry schema and the gate before emitting;
   - the client checks the same schema again, and the **write route checks everything a third time** (owner, plan,
     values). It is the same route the Settings page calls, so a forged action can do no more than the page.
4. **Confirm rules:**
   - a `view` runs at once, with a change line plus Undo;
   - a `write` never runs without a click; its confirm line shows exactly what will change, before → after ("Alerts:
     daily → weekly");
   - Mindy's words say it is waiting, never done (#2547);
   - no auto-confirm, no "always allow", no batched writes;
   - after the click, the client shows the outcome line and Undo where the write is reversible.
5. **Never exposed (link to the page instead):** billing or plan changes, payment methods, credits purchase, cancelling,
   deleting the account, team seats and roles, sharing anything externally (share links, sending email), API keys,
   admin panels. For these Mindy answers "Open **Settings → Billing & credits**" with the deep link, and nothing more.
6. **Surface-aware:** an action declares `surfaces` (`map`, `app` or both). A wrong-surface action is rejected whole.
7. **Rollout:**
   - behind `ASK_MINDY_APP_ACTIONS` with an allowlist; then `'*'` only after the verify-ask-mindy checks and the Claude +
     Mindy MCP baseline check (`tasks/claude-mcp-baseline-benchmark-design.md`) pass for that phase;
   - each phase is its own release.

## Phase A: navigate and show (no new writes)

| action | surfaces | kind | gate | args | client runs |
|---|---|---|---|---|---|
| `app.navigate` | app, map | view | none (the destination keeps its own gate) | `panel` ∈ `AppPanel` minus admin-only and route-only panels; optional `section` ∈ the panel's known sections (Settings: `SETTINGS_SECTION_VALUES`; Vault: `VaultDeepLinkSection`) | `onPanelChange(panel)` plus `section=`; from the Map, `/app?panel=…&section=…` opens in a new tab (Decision 1) |
| `app.open_record` | app | view | none (the server already checks ownership) | `kind` ∈ `report`, `pursuit`, `opportunity` (document and saved_search wait for their deep links; see Client review); `id` matching that kind's id pattern, **from this turn's tool results only** (the evidence rule `map.open_record` uses) | opens the record in its panel (report pane, Vault document, pursuit drawer, watchlist item, map `?opp=`) |
| `app.show` | app | view | none | `what` ∈ a fixed list (`my_documents`, `my_pursuits`, `my_saved_searches`, `my_alert_settings`, `my_matching`, `my_profile`, `my_billing`, `my_team`) | maps to `app.navigate` with the right `panel` and `section`; a model-friendly alias, so "show me my alert settings" needs no panel ids |

Prompt rules (Agent 1):

- When the customer asks "where is…", "take me to…" or "show me my…", propose the action **and** say in one line where
  it is ("It's in Settings → Alerts & matching"), so the answer stands alone if the action is declined.
- Never claim a page opened; say what was proposed.

Phase A tests:

- **Registry:** each new action's schema, the allowed panel and section lists, rejection of admin-only panels, and the
  evidence rule for `app.open_record`.
- **Proposer:** the surface split. `app.*` is offered on `/app` and only `app.navigate` on the Map.
- **Route:** `/app` turns get the tool when flagged; card turns never do.
- **Client (Agent 2):** each panel and section actually opens; an unknown panel is ignored with a note.

## Phase B: settings writes with confirm

Every write goes through the **existing** preferences routes with the same body the Settings page sends. No new route.

| action | route (existing) | args | confirm line | Undo |
|---|---|---|---|---|
| `settings.set_alerts` | `POST /api/alerts/preferences` | `enabled` (bool) and/or `frequency` ∈ daily/weekly/off | "Alerts: daily → weekly" | yes: re-POST the snapshot |
| `settings.update_matching` | `POST /api/alerts/preferences` | `add` / `remove`, each with `naics[]` (6-digit, validated by `commitNaicsFromTypedInput`), `keywords[]` (plain, ≤60 chars each, ≤20 per call), `agencies[]` (from the agency list); never a full replace | "Add NAICS 541512 and keyword 'zero trust' to your matching" | yes |
| `settings.set_notifications` | `POST /api/briefings/preferences` | the fields the Notifications card exposes (briefing on/off and cadence) | before → after | yes |
| `settings.update_profile` | the Profile tab's existing save | `company_name`, `website`, `city`, `state` only; never UEI, CAGE, certifications or set-aside status, which come from SAM or the Vault with provenance | before → after | yes |

Rules:

- **Read-before-write:** the client GETs current preferences first and builds the confirm line and Undo snapshot from
  them. If the GET fails, the action is declined with a note; nothing is guessed.
- A matching change that would leave the alert with no NAICS, keywords or agencies is refused with a note, and the
  customer is pointed to the page.
- **Gate:** signed in, acting on their own account or the active workspace exactly as the page does. A coach or client
  workspace follows the same scope rules (`withWorkspace`).

Phase B tests:

- **Registry:** each write's schema and value limits, and `needsConfirm: true` on all.
- **Server:** the model's reply says it is pending.
- **Route** (POST contract tests against the real preferences routes with the client's body): the write lands exactly
  as the Settings page's would, and a forged extra field is ignored by the route.
- **Client:** the confirm shows before → after; Not now writes nothing; Undo restores the snapshot.

## Phase C: records

| action | surfaces | route (existing) | notes |
|---|---|---|---|
| `watch.save_search` / `watch.update_alert` / `watch.delete_search` | app (extends the Map's `save_search` / `update_alert`) | `POST /api/app/mindy-actions` (save, update) and the Watchlist panel's delete | delete needs a confirm naming the search; Undo re-creates it from the snapshot |
| `pursuit.add` / `pursuit.remove` / `pursuit.set_stage` | app and Map | `/api/app/mindy-actions` (`createCanonicalPursuit`) and the pipeline routes the Pipeline panel uses | stage ∈ the pipeline's stage list; ids from this turn's evidence or the pipeline listing tool |
| `document.open` / `document.rename` / `document.regenerate` | app | the Vault document routes the Documents panel uses; `regenerate` = `create_document` with `revises_document_id` (a new version, the old kept) | rename confirm shows the old → new name; nothing is ever deleted |
| `report.generate` / `report.open` | app | `generate_market_report` / the report pane | generate is a write: the confirm shows the market and that credits may apply, the same notice the button shows |

Never in Phase C: deleting documents or reports, sharing, exporting outside the app, or sending email.

Phase C tests:

- **Registry and evidence:** ids must come from this turn's tool results or a listing tool.
- **Route contract tests** for each write against the existing route.
- **Client:** confirm, outcome and Undo for each reversible write.

## Split of work

| | Agent 1 (server / registry / prompts) | Agent 2 (client handlers) |
|---|---|---|
| A | registry entries and schemas, `app.*` in the proposer, the surface split, prompt rules, evidence for `open_record`, route and proposer tests | `/app` action handler (`onPanelChange` + `section`), the Map → `/app` link handler, ignored-action note, client tests |
| B | registry writes, pending wording, refusal rules (empty matching, never-exposed list), contract tests against the preferences routes | read-before-write, confirm line before → after, Undo snapshot, workspace scope, client tests |
| C | registry writes, evidence and listing rules, `regenerate` via `revises_document_id`, credit notice wording | Watchlist, Pipeline and Documents handlers, confirm and Undo, client tests |

The parity test is extended so the `/app` handler table and the registry cannot drift, the same way the Map's mirror
is checked.

## Release gates per phase

1. Unit, route and parity tests are green; CI `verify` is green.
2. `verify-ask-mindy` on the preview with the flag allowlisted to the test email, including new scenarios for that
   phase's actions ("take me to my alert settings", "switch my alerts to weekly", "add 541512 to my matching").
3. The Claude + Mindy MCP baseline check passes its hard gates for the answer text. Actions themselves have no baseline;
   they are judged on correctness and on never acting unconfirmed.
4. Agent 4 review, then Eric's go to widen the allowlist; `'*'` only after one clean day on the allowlist.

## Client review (Agent 2, 2026-11-28): folded in

- **/app has no action UI today.** The Map's card and Undo are ES5 in `opportunity-map/route.ts`, so /app Phase A
  needs a new React action card plus a handler table (about one PR, Agent 2). The parity test is extended to cover
  that table.
- **Gates on navigation:** `app.navigate` applies the destination's lock through the sidebar's
  `clickActionFor()` / `nav-groups.ts`. A gated panel can be proposed, but the client shows it locked exactly as the
  sidebar does. Test: the client applies the gate.
- **Settings deep link:** add a `sectionRequest` nonce (the same bug class as Vault in #2560), and `syncAppUrl` writes
  `section=` for settings.
- **`app.open_record` in Phase A:** `report`, `pursuit` and `opportunity` work today. `document` needs a Vault per-document
  deep link first. `saved_search` lives in the Map shell's watchlist and needs a watchlist item param. Until those
  exist, both are **dropped from Phase A** (registry enum = report, pursuit, opportunity).
- **Phase B starts by extracting the Settings save** into `src/lib/app/settings-writes.ts`, one writer used by both the
  panel and the action. No action writes through a second code path.
- **List fields REPLACE on `/api/alerts/preferences`:** add/remove = GET current → compute the new list → POST **that
  field only**. NAICS and keyword posts trigger the route's derived-field step, which gets contract tests.
- **Re-GET at click time,** not at proposal time, and Undo restores **only the touched fields**.
- **After an action write,** emit a refetch event so open panels (Settings, Watchlist) show the new state.
- **Auth:** same auth and workspace headers as the page. Test: a coach-scope refusal (Phase B is own account only, per
  Decision 3).
- **One writer for briefings:** briefing on/off and cadence are also accepted by `/api/alerts/preferences`
  (`briefingsEnabled` / `briefingFrequency`). `settings.set_notifications` uses the single writer the Notifications
  card uses today; it is not split across two routes.
- **Phase C:** delete-search Undo re-creates the search from the full snapshot, so it gets a new id. The confirm says
  so.

## Decisions (Agent 4 reviewer defaults, 2026-11-28; Eric can override)

1. **Map → /app** opens in a **new tab**, so the Map session is kept. This matches the existing Map handoffs.
2. **Writable profile fields:** name, website, city and state only.
3. **Coach and client workspaces** are excluded from Phase B at launch (own account only). They are added later with the
   acting-scope checks.

Pending: Eric is deciding whether Phase A (`app.navigate` + `app.show`) is built for Mindy Day. Nothing starts until
Agent 4 relays his answer.
