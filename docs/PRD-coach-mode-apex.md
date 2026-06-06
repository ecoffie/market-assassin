# PRD: Coach Mode (APEX Accelerators)

> A counselor at an APEX Accelerator manages MANY client small businesses. Coach
> Mode lets one counselor switch between their assigned clients — each with its
> own pipeline, vault, and market profile — plus an "APEX Tab" that aggregates
> assigned-client deadlines, alerts, and internal news. The Knowledge Base is
> the APEX "Custom Workbench" (institutional memory). We designed this for the
> APEX Illinois proposal but never built it.

**Status:** Draft / scoping — 2026-06-05. Build after sign-off.
**Trigger:** Eric: "Build Coach mode for APEX accelerators — we did a design but
never built it. Coach access should let me [manage clients, team interaction,
event finder, custom APEX Tab via the Workbench]." Source: APEX Illinois proposal
(Feb 20, 2026).

---

## 0. What ALREADY exists (the proposal is ~80% built)

Most of what the APEX proposal sells is live in Mindy today:

| Proposal feature | Status in Mindy |
|---|---|
| CRM / pipeline (add-to-pipeline, deadlines) | ✅ Pipeline panel + `user_pipeline` |
| Live market intel (SAM/FPDS, incumbents, spending) | ✅ Market Intel + Contractors (BQ) |
| Teaming / vendor search (set-aside, past perf) | ✅ Relationships → Find Partners |
| GovCon Event Finder (industry days) | ✅ Target List → "Find events with Mindy" |
| Proposal + compliance matrix | ✅ Proposal Assist (+ section-grouped matrix, SOW export) |
| "Custom AI Workbench" (search internal docs) | ✅ Knowledge Base (RAG over the corpus) + Manual Drive chat |
| Team interaction (chat/tagging/comments) | ✅ Comments + workspaces + Team Access |
| Pursuit deadline "red-flag" alerts | ✅ Pursuit change/amendment alerts (just shipped) |

**So Coach Mode is NOT a rebuild of these.** It's the missing layer ON TOP: a
counselor working across MULTIPLE clients, + an APEX-branded aggregation tab.

The genuinely NET-NEW work:
1. **Multi-client switching** — a coach belongs to many client workspaces and
   switches between them.
2. **The "APEX Tab"** — a cross-client dashboard (assigned-client deadlines,
   alerts, internal APEX news).
3. (Later) **Deep integrations** (Slack/Outlook/Drive) — a separate phase.

---

## 1. Architecture: clients = workspaces (decision)

**Decision (Eric):** reuse the existing workspace model. Each client business is
a **workspace**; the coach is a **member** of each client's workspace and
switches between them.

Why this works (already true today):
- `ensureWorkspaceMember`, `provisionTeamWorkspace`, `getWorkspaceId` exist.
- **9+ API surfaces already key data by `workspace_id`**: pipeline, vault,
  relationships, target-list, comments, proposals, target-outreach,
  market-focus. So switching workspace ALREADY gives the coach that client's
  pipeline + vault + relationships — no per-feature rework.
- `owner_email` preserves who did what within a shared workspace.

New infra needed (small):
- A **coach → clients** link: which client workspaces a coach manages. Could be
  workspace membership + a `role='coach'`, or a thin `coach_clients` view.
- A **client switcher** UI (like "Switch Account", but lists the coach's managed
  clients) that sets the active workspace for the session.

---

## 2. v1 scope (the build cut — Eric)

### A. Client switcher
- A coach sees a list of their assigned client businesses; selecting one sets
  the active workspace. All existing panels (pipeline, vault, proposal,
  relationships) then operate on THAT client — no panel changes needed.
- "Add a client" — provision a client workspace + add the coach as member.

### B. Per-client pipeline + vault + market profile
- Free, because those are already workspace-scoped. Verify each panel honors the
  active workspace for a coach (not just the coach's own email).

### C. The "APEX Tab"
- A cross-client dashboard for the coach: assigned-client **deadlines**
  (red-flag the urgent ones — reuse the pursuit-change alerts), new **alerts**
  per client, and an **internal news** feed (APEX announcements — admin-posted).
- "Which of my 15 clients has something due this week?" in one glance.

### D. Workbench = Knowledge Base
- The APEX "Custom AI Workbench" the proposal sells = the **Knowledge Base** we
  shipped (RAG over the corpus) + **Manual Drive** chat. For APEX, ingest their
  internal guidance docs (per the ingestion-criteria PRD) so counselors can ask
  "what guidance did we give construction firms in Cook County?"

---

## 3. v2+ (NOT v1)

- **Deep integrations:** Slack notifications, Outlook draft-replies, Google
  Drive pull. External OAuth + per-tool APIs — a real phase of its own.
- **APEX-branded skin** (logo, "APEX Tab" naming per org).
- **Coach analytics:** counselor activity, client outcomes, ROI reporting for
  the APEX center's DoD funder.
- **Bulk client onboarding** (import a roster).

---

## 4. Scope / non-goals

- **In (v1):** client switcher, per-client workspace operation, APEX Tab,
  Knowledge-Base-as-Workbench. Reuse workspaces — no new isolation model.
- **Out (v1):** Slack/Outlook/Drive integrations; white-label branding; billing/
  seat management for the org (handled separately); analytics.
- **Brand rule:** the proposal uses "OpnGovIQ" — internally this is **Mindy**;
  keep product UI on Mindy / GovCon Giants curriculum (exit-strategy rule). The
  "OpnGovIQ" name in the proposal is a sales artifact, not the product name.

---

## 5. Risks

- **Data isolation:** a coach must see ONLY their assigned clients — workspace
  membership must gate every read/write. Audit the workspace-scoped routes to
  confirm none leak across workspaces for a multi-workspace user.
- **Active-workspace plumbing:** today most routes derive workspace from the
  user's OWN email/workspace. A coach needs an EXPLICIT active-workspace
  selection (session/header) so the same routes operate on the chosen client.
  This is the main engineering surface.
- **Billing model:** who pays — the APEX center (per-coach seats) vs per-client?
  Out of scope for the build, but the data model shouldn't preclude either.
- **Scale:** an APEX center has 300+ counselors × dozens of clients each — the
  client switcher + APEX Tab queries must paginate/scope, not load everything.

---

## 6. Success criteria (v1)

- A coach logs in, sees their assigned clients, switches to one, and the whole
  app (pipeline, vault, proposal) operates as that client.
- The APEX Tab shows, across all the coach's clients: upcoming deadlines (with
  red-flags), recent alerts, and APEX internal news.
- A coach can ask the Knowledge Base / Manual Drive for APEX's internal guidance.
- Zero cross-client data leakage.

---

## 7. Open questions (resolve before/early build)

- Coach→client link: workspace `role='coach'` vs `coach_clients` table?
- Active-workspace mechanism: session cookie, header, or URL param?
- Who posts "APEX internal news" — an APEX admin role, or Mindy super-admin?
- Billing: per-coach-seat vs per-client (affects nothing in v1 build, but decide
  before GA).

---

## 8. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Scope Coach Mode as a PRD first. Reuse WORKSPACES (each client = a workspace the coach is a member of + switches between) — not a new isolation model. v1 = client switcher + per-client pipeline/vault/profile + APEX Tab + Knowledge-Base-as-Workbench. Integrations (Slack/Outlook/Drive) = v2. Most of the APEX proposal already exists in Mindy. | Eric |
