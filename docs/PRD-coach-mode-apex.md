# PRD: Coach Mode / Org White-Label (APEX is one instance)

> **Generalized:** a coach/counselor at ANY partner organization (APEX
> Accelerator, SBDC, Chamber, FHC) manages MANY client businesses. Coach Mode
> lets one coach switch between assigned clients — each with its own pipeline,
> vault, and market profile — plus a per-org "Org Tab" (assigned-client
> deadlines, alerts, internal news). The Knowledge Base is the org's "Custom
> Workbench". APEX Illinois is the first instance, but this is the **white-label
> org tier**, not an APEX-only feature.

**Status:** Draft / scoping — 2026-06-05. Build after sign-off.
**Trigger:** Eric: "Build Coach mode for APEX — we designed it, never built it.
And we'll do the same white-label for ANY/ALL organizations who have members
(see the MD files)." Sources: APEX Illinois proposal (Feb 20, 2026);
`docs/strategy/MI-UNIFIED-PRODUCT-ARCHITECTURE.md` (MI Team / Enterprise /
White-Glove tiers — seats, white-label, dedicated coach, all **❌ NEEDS BUILD**);
`tasks/COACH-ENTERPRISE-BD-PLAN.md`; `docs/strategy/APEX-GROWTH-STRATEGY.md`
(90+ APEX locations, 300+ counselors, 30K businesses/yr).

**This is NOT APEX-specific.** APEX = the proving instance. The build is the
generic **organization white-label + coach/multi-client** layer that any partner
org (SBDC, Chamber, FHC, accelerator) gets. "APEX Tab" → "Org Tab" (branded per
org). Aligns with the documented Team / Enterprise / White-Glove tiers.

**Two personas, ONE machinery (Eric, 2026-06-05):**
A solo **consultant managing multiple entities** is the SAME use case as a coach
— each entity = a workspace with its own profile/pipeline/vault, switch between
them, see a cross-entity dashboard. The only difference is provisioning weight:

| | Org (APEX) | Consultant (solo) |
|---|---|---|
| Tenant | the organization (many coaches + clients) | the consultant IS the org (sole admin+coach) |
| Setup | white-label org provisioned (branding, multiple coaches) | lightweight — "Add a client" creates the entity workspace, no org branding |
| Entry | org-admin invites coaches | consultant self-serves: turn on "Manage clients" |

Same `organizations` + `org_clients` + switcher under the hood. v1 should expose
a **lightweight Consultant entry point** (a solo user flips on multi-client
management; an org row is auto-created with them as sole admin+coach) so a
consultant isn't forced through APEX-org setup. The APEX/white-label org is the
same model with branding + multiple coaches added.

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

## 3. White-label / org generalization (APEX = instance #1)

This is the **org white-label tier** from MI-UNIFIED-PRODUCT-ARCHITECTURE.md, not
an APEX feature. The same build serves any partner org:

- **organizations table** — id, name, slug, branding (logo, color, "Org Tab"
  label), tier. APEX Illinois is one row.
- **org membership** — coaches + clients belong to an org. A coach's clients are
  org-scoped.
- **Per-org branding** — the "Org Tab" shows the org's name/logo; reports can be
  white-labeled (Enterprise tier's "white-label reports — NEEDS BUILD").
- **Reusable** — SBDC, Chamber, FHC get the same model with their own org row.

So everywhere this PRD says "APEX Tab", read **"Org Tab (branded per org)"**.

## 4. v2+ (NOT v1)

- **Deep integrations:** Slack notifications, Outlook draft-replies, Google
  Drive pull. External OAuth + per-tool APIs — a real phase of its own.
- **Full white-label skin** (logo, colors, branded reports, custom domain).
- **SSO/SAML** (Enterprise tier — NEEDS BUILD).
- **Coach analytics:** counselor activity, client outcomes, ROI reporting for
  the org's funder (APEX → DoD).
- **Bulk client onboarding** (import a roster).
- **Org admin dashboard** + seat management.

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

## 7. Open questions — RESOLVED (2026-06-05)

- **Coach→client link:** `organizations` table + org membership with a `role`
  (`coach` | `client_owner` | `org_admin`). A coach's clients = client
  workspaces in the same org the coach is assigned to. (Reuses workspaces.)
- **Active-workspace mechanism:** an explicit **`x-active-workspace` header**
  (+ a localStorage-backed client picker) that workspace-scoped routes read to
  operate as the selected client. Falls back to the user's own workspace.
- **Org news:** an **org-admin role** posts to their org's news feed (not Mindy
  super-admin). [non-blocking call]
- **Billing:** **per-coach-seat** at the org level (matches Enterprise tier).
  Decide pricing before GA; the data model supports it now. [non-blocking call]

---

## 8. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Scope Coach Mode as a PRD first. Reuse WORKSPACES (each client = a workspace the coach is a member of + switches between) — not a new isolation model. v1 = client switcher + per-client pipeline/vault/profile + APEX Tab + Knowledge-Base-as-Workbench. Integrations (Slack/Outlook/Drive) = v2. Most of the APEX proposal already exists in Mindy. | Eric |
