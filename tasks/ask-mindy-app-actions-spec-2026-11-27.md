# Ask Mindy controls the app and the Map: action registry spec

Status: DRAFT for approval · 2026-11-27 · client owner: Agent 2 (Mindy App) · server owner: Agent 1 (Ask Mindy) ·
review and release: Agent 4. Sequenced after the research-report rollout. Nothing ships until this is approved; slice 1 then
ships behind a flag that is off by default.

## Goal

A customer says what they want ("show me VA construction work in Florida closing this month") and Mindy does it. They never
need to know which dropdown, which horizon toggle or which search box. The pattern is the one Agentforce, HubSpot Breeze and
Notion AI use: the assistant proposes a named action, the client runs it through the same code as the button, shows what changed,
and offers Undo.

## Non-goals

- No second engine. Every action calls the function behind today's button. If a button does not exist, there is no action.
- No Map redesign, no new filters, no new data. The registry can only reach what the UI already reaches.
- No server-side UI state. The server proposes; the client decides and executes.
- No free-form code, selectors or URLs from the model. Names and typed args only.

## Contract (server → client, on the existing chat stream)

```
{ type: 'action', id: '<uuid>', name: '<registry name>', args: { … } }
```

- Sent on the same SSE stream as `token`, `progress` and `mode`, in either standard Ask Mindy or research mode (Agent 1 exposes
  one action tool to both).
- `id` is unique per action. The client reports the outcome once via the existing telemetry path:
  `ran | confirmed | declined | undone | rejected:<reason>`.
- An unknown `name`, invalid args, a surface mismatch (a Map action while on /app, or the reverse) or a gated action is
  **ignored with a plain note** ("Mindy suggested something this page can't do"), and logged. It is never partially applied.
- At most 3 actions per turn. Extra ones are rejected, so a runaway turn cannot thrash the UI.
- The answer text must still stand alone. An action is a convenience, never the only way the customer gets the information.

## The registry (one file, shared by both surfaces)

`src/lib/chat/app-actions/registry.ts` declares each action **once**:

| field | meaning |
|---|---|
| `name` | stable id, e.g. `map.apply_view` |
| `surfaces` | `['map']`, `['app']` or both |
| `kind` | `view` (runs immediately) or `write` (one-line confirm first) |
| `args` | a strict schema: allowlisted keys, enums, lengths; unknown keys are rejected |
| `gate` | the same plan or sign-in check the button uses (`__proGate`, `__playersGate`, `hasProAccess`…) |
| `describe(args)` | the plain sentence shown after it runs ("Filtered to Florida · VA · construction") |
| `snapshot()` / `restore(s)` | how Undo works for this action (below) |

The **validation** (schema, enum lists, gate rule names, describe) is pure TypeScript and unit-tested. The **execution**
adapters are thin. On /app they are React handlers. On the Map they live in the ES5 drawer script: a `MAP_ACTIONS` table that
calls the existing `window.*` functions. A generated parity test fails CI if the TS registry and the Map table disagree on
names, kinds or arg keys, so the two surfaces cannot drift.

## Inventory by surface

### Map (`/opportunity-map` and `/app?panel=map`)

| action | kind | existing function it calls | args (validated) |
|---|---|---|---|
| `map.apply_view` | view | `window.__applySavedSearch(ss)`: the same path as opening a saved search | `mode` ∈ open/recompete; `q` ≤120 chars; `filters` with keys from `FILT` only (`state`, `setAside`, `setAsideMulti`, `agency`, `subAgency`, `office`, `naics`, `psc`, `noticeType`, `noticeMulti`, `closingDays`, `postedDays`, `valueRange`, `vehicle`, `hasDocs`, `hasContact`, `likelihood`…), each validated against the control's own option list; `horizons` {open, recompete, forecast} booleans |
| `map.search` | view | `runSearch(q)` in the search panel (same as typing and pressing Enter) | `q` 2–120 chars, plain text |
| `map.set_horizons` | view | `window.toggleHorizon(h)` / `window.__isolateHorizon(h)` | `open`/`recompete`/`forecast` booleans, or `isolate` ∈ those three |
| `map.go_to` | view | `window.__showMatchingLocations()` / `window.__mapNationalView()` / state centroid fit (`__STATE_CENTROIDS`) | `state` (2-letter USPS) or `national: true`; no free coordinates |
| `map.open_opportunity` | view | `window.openOppDrawer(noticeId)` / `window.openForecastDrawer(id)` | `notice_id` matching the existing id pattern; only ids that appeared in this turn's tool results |
| `map.clear_filters` | view | the bar's own reset (`__saselReset`, `__naicsReset`, `__agencyReset` + FILT reset) | none |
| `map.set_sort` | view | `window.__setSortScope` / existing sort control | `sort` ∈ the control's options |
| `map.show_companies` | view (gated) | `setMapMode('companies')` via `__playersGate` | none; the gate behaves exactly as the button does |
| `map.save_search` | **write** | `/api/app/mindy-actions` `save_search` → `createSavedSearch` (see below) | `name` ≤80 chars, `alert_frequency`; filters = current view |
| `map.update_alert` | **write** | `/api/app/mindy-actions` `update_alert` → `updateSavedSearch` | `search_id` (uuid), `alert_frequency` ∈ daily/weekly/off |
| `map.save_opportunity` (heart) | **write** | the existing heart handler | `notice_id` (as above) |
| `map.add_to_pursuits` / `map.remove_from_pursuits` | **write** | `/api/app/mindy-actions` → `createCanonicalPursuit` / pipeline DELETE check | `{kind, notice_id \| contract_id}` / `{pursuit_id \| notice_id}` |
| `map.export` | **write** | the existing list export | `format` ∈ the control's options |

### /app (standalone Ask Mindy and the shell)

| action | kind | existing function it calls | args |
|---|---|---|---|
| `app.open_panel` | view | `onPanelChange(panel)` | `panel` ∈ `AppPanel` minus admin-only panels; plan-gated panels keep their own gate |
| `app.open_map_view` | view | switch to `map` panel with the view encoded the way the Map share URL already is (`?shell=app` + filters) | same schema as `map.apply_view` |
| `app.open_report` | view | `ChatReportPreview` open / `/reports/<id>` | `report_id` matching `REPORT_ID_RE`, owned (the server already checks) |
| `app.open_opportunity` | view | open the opportunity in the map panel (`?opp=`) | `notice_id` (as above) |
| `app.add_to_pipeline` | **write** | the existing pipeline add (`/api/pipeline`) | `notice_id` |
| `app.start_proposal` | **write** | `startProposalFromNotice()` (the "Start a proposal" button) | `notice_id` of the attached opportunity only |
| `app.save_search` / `app.watch` | **write** | the Watchlist panel's existing handlers | as on the Map |

Explicitly **not** exposed: anything in billing, account, team or seat settings; deleting anything (conversations, Vault
documents, pipeline items); sending email; sharing links; admin panels. Mindy can open the Settings panel, but it cannot press
anything inside it.

## Top 5 by customer value (slice order)

People get lost in filters and search, so those come first.

1. **`map.apply_view`**: one action covers "VA construction in Florida closing in 30 days". It replaces the dropdowns, chips
   and horizon toggles in one step, through the saved-search code that already restores whole views.
2. **`map.search`**: keyword search exactly as typed into the box, for "show me cybersecurity work".
3. **`map.open_opportunity`**: "open the Navy one", from an id Mindy just cited. It removes the "where is it on the map" hunt.
4. **`map.go_to`**: "just Florida" / "the whole country". Bounded to states and national, never free coordinates.
5. **`app.open_panel`**: "where are my saved searches?", "take me to my pipeline". Navigation help in /app.

Slice 1 = #1 and #2 on the Map (view-only, no confirm needed), behind the flag. Write actions come in a later slice, together
with the confirm UI.

## Confirm rules

- `view` actions run immediately, then show the change line plus **Undo**.
- `write` actions **never** run without a click. The client renders one line, e.g. "Save this search as 'VA construction FL'?
  [Save] [Not now]". The confirm shows exactly what will be written (name, frequency, opportunity title). Mindy's prose cannot
  pre-confirm.
- A write that needs a plan the customer lacks shows the same upgrade path as the button, not an error.
- No auto-confirm, no "always allow", no batching of writes in slice 1–2.
- Card chat (per-opportunity) does not run actions in slice 1.

## Undo

- Before a `view` action runs, the client takes `snapshot()`. For Map view actions that is `_mapState()` plus `MODE`: the same
  `{mode, filters (incl. q, horizons), bbox}` object the map already round-trips through `__applySavedSearch` for "last search"
  restore. Undo calls `restore(snapshot)` → `__applySavedSearch(snapshot)` plus the stored bbox.
- One Undo level per action, shown on that action's change line until the next action or 2 minutes. Undo is itself a view
  action, so it is never stacked.
- `write` actions are undone with the existing inverse control where one exists (unsave, unwatch, remove from pipeline), offered
  as "Undo" for 10 seconds after confirming. Otherwise there is no Undo, and the confirm says so.
- If the customer changed the map by hand after the action, Undo is withdrawn rather than overwriting their change.

## Gating and flag

- Flag `ASK_MINDY_APP_ACTIONS` (default off) plus an allowlist (Eric, Erika), then the beta. The server sends `action` events
  only to allowlisted users, and the client runs actions only when its capability endpoint says so. This reuses the
  `/api/app/chat/capabilities` pattern by adding `{ actions: boolean }`. Belt and braces: an action event reaching a
  non-allowlisted client is ignored.
- Each action's `gate` runs at execution time, exactly as for the button (sign-in, Pro, Players gate). If the customer can't
  click it, Mindy can't do it.

## Safety

- Args are validated against the control's own option lists: no free HTML, CSS selectors, URLs or coordinates.
- Strings are bounded and stripped of control characters, and the change line is shown as text.
- Notice and report ids must match their existing patterns, and for `open_opportunity` must have appeared in this turn's tool
  results, so a prompt-injected id from a web page cannot be opened silently. (Reading is harmless, but the rule keeps intent
  clear.)
- Every action and outcome is logged with its `id`, `name` and outcome. Args are logged redacted (no free text over 60
  characters).

## Test plan

- **Registry unit tests:** schema accepts and rejects (unknown keys, bad enums, oversize strings, wrong surface), gate mapping,
  `describe()` text, snapshot/restore round trip, max 3 per turn, unknown action → rejected with a note.
- **Parity test:** the TS registry and the Map `MAP_ACTIONS` table agree (names, kinds, arg keys). Generated from the TS source
  and failing CI on drift.
- **Map jsdom (the real drawer script):** for each Map action, an `action` event changes the right state: `FILT`/`Q`/horizons
  via a spy on `__applySavedSearch` and `runSearch`. The change line appears, and Undo restores the exact snapshot. A write
  shows a confirm and does nothing until clicked; Decline does nothing. A gated action follows the gate path.
- **/app component tests:** `app.open_panel` calls `onPanelChange`, the write confirm works, a non-allowlisted user's events
  are ignored.
- **End-to-end (one per action, Playwright on a preview, signed-in test account):** a chat prompt produces a visible UI change.
  Example: "show VA construction in Florida" → the filter chips show VA · construction · FL and the list count changes → Undo →
  the original chips come back. Run with `verify-ask-mindy` alongside the answer checks.
- **Regression:** the same prompts with the flag off produce no UI change and identical answers.

## Write actions backend (Agent 3, Data Core)

- **Execution.** On Yes, the client POSTs `/api/app/mindy-actions` with `{email, action_id, name, args, confirmed: true}`. `name` is BARE (`save_search`, `update_alert`, `add_to_pursuits`, `remove_from_pursuits`); the client strips the surface prefix (`map.`/`app.`). The route checks the same MI session as the buttons, returns 400 `confirmation_required` unless `confirmed === true`, and calls the EXISTING lib.
- **`save_search` {name, alert_frequency: daily|weekly|off}:** the model supplies only these. The client adds `mode` and `filters` from the CURRENT view: the same object the Map's Save button posts (`_mapState().filters`). That way a saved search reopens exactly what the customer saw, and an injected filter can't be saved. The route calls `createSavedSearch`, idempotent by fingerprint.
- **`update_alert` {search_id, alert_frequency}:** calls `updateSavedSearch`, owner-scoped.
- **`add_to_pursuits` {kind:'opportunity', notice_id} | {kind:'recompete', contract_id}:** calls `createCanonicalPursuit`. The title and fields come from our DB, never from args. A duplicate returns `already: true`.
- **`remove_from_pursuits` {pursuit_id} | {notice_id}:** the same ownership check as the pipeline DELETE.
- **Response:** `{ok, action_id, name, message, already?, target?: {kind, id, href}, error_code?}`. The client shows `message` as plain text (≤300 characters), plus a link when `target.href` exists.
- **Undo after a confirmed write (10 s):** `add_to_pursuits` → `remove_from_pursuits` with the returned target id; `update_alert` → the previous frequency. `save_search` has no Undo in v1 ("You can remove it from Watchlist").
- Both sides validate the args (plain name ≤80, enum frequency, id patterns, uuids).

## Server half (Agent 1)

- One tool, offered to standard Ask Mindy and research mode (e.g. `propose_app_action`), whose input schema is generated from
  the same registry file, so the model can only name registered actions with valid args. It emits the `action` event and returns
  "proposed" to the model, never "done": the client decides.
- System guidance: propose an action only when the customer asked to see, filter, open or go somewhere; one action per intent;
  always also answer in words.
- Honour the flag and the allowlist server-side.

## Open questions for Eric

1. Should slice 1 include `map.open_opportunity`, or stay strictly filters and search?
2. For write actions, is a one-line inline confirm enough, or should saved searches and alerts open the existing save dialog
   pre-filled?
3. Should actions run inside the Map card chat (per-opportunity) at all, or only in the main Ask Mindy window?
