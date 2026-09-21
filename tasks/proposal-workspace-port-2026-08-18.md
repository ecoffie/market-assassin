# Port Proposal Assist INTO the Proposal Workspace — spec

**Status: SPEC ONLY. Not started. Deliberately deferred until after the 2026-08-22 demo.**
**Decision (Eric, 2026-08-18):** *"the app panel solved all of these issues that we are not
reintroducing in this new workspace. Why not take the proposal assist that works and recreate it
into proposal workspace instead of vice versa."*

That is the correct direction and this spec assumes it. The alternative — porting features one at
a time INTO the Workspace — is what produced the current state and would keep producing it.

---

## The defect that started this

Eric opened a **Sources Sought** pursuit in the Workspace (`?pursuit=96ea6675-…`). The right rail
correctly read **Contract Type: Sources Sought**. The left rail still showed the full RFP skeleton:

> Executive Summary · Technical Approach · Staffing Plan · Quality Control · Transition Plan ·
> Risk Management · Past Performance · **Pricing** · Teaming Partners · Final Review ·
> **Submit Proposal**

An RFI/Sources-Sought response is 2–5 pages of capability. It has no Transition Plan, no Risk
Management, and nothing to "submit". **The Workspace displays the notice type and then ignores it.**

Eric's three points, all confirmed in code:

1. **"If I am doing only an RFI how do I do that… versus an IDIQ. Or what if it's just an RFP."**
   → `STAGES` is ONE hardcoded array (`src/app/opportunity-map/proposal/route.ts:354`). Every
   notice type gets the identical 15 sections. `notice_type` is read at line 628 **for display
   only** (`drow('Contract Type', p.notice_type||'')`) and never branches anything.
2. **"We don't treat pricing in the same place as technical writeup."**
   → Pricing sits in the narrative rail as `{key:'pricing', kind:'deferred'}`. The code already
   admits it has no source ("no fabricated data"), but placing it beside the prose sections
   implies Mindy will write it.
3. **"Pricing requires spreadsheet plus not something that we do. Usually requires the estimator."**
   → Correct, and stronger than the code's position: pricing is not a late SECTION, it is a
   **different workflow with a different owner and a different artifact** (estimator, spreadsheet).

---

## Why port the panel INTO the Workspace (measured, not assumed)

| | `/app` ProposalsPanel | Proposal Workspace |
|---|---|---|
| lines | **3,788** | 821 |
| compliance refs | **232** | 41 |
| referee refs | **25** | 2 |
| notice-type awareness | **yes** — `classifyNoticeType` + `detectNoticeTypeFromText` + LOI path | **none** (display only) |
| architecture | React component (`'use client'` + props) | route handler emitting HTML/JS **strings** |

The Workspace's string-emitting architecture is the same one that produced this session's
template-literal escaping bugs and the cross-script-block scope class. Rebuilding 3,788 lines of
proven logic inside it — and then maintaining both — is the lib-duplicate-drift bug class by
construction.

### The port is smaller than it looks

`ProposalsPanel` is **already portable** — this is the load-bearing finding:

- `'use client'` + a plain props interface: `{ email, tier, panelContext? }`
- `/app` mounts it as `<ProposalsPanel email={email} tier={tier} panelContext={panelContext} />`
  (`src/components/app/panels/index.tsx:104`)
- **`panelContext={{ pursuit_id: 'xyz' }}` is an ALREADY-DOCUMENTED path.** From the props
  comment: *"PipelinePanel sets `{ pursuit_id: 'xyz' }`… we then auto-fetch that pursuit's cached
  SAM attachments and pre-populate the RFP upload state."* That is exactly what the Workspace
  route needs to pass.
- **Auth is NOT React-context-dependent.** `authedFetch` / `getMIApiHeaders`
  (`src/components/app/authHeaders`) read the `mi_beta_auth_token` from `localStorage` directly.
  No provider to reproduce. This was the main risk before measuring; it is now small.

---

## Target shape

`/opportunity-map/proposal` becomes a **thin route that mounts the panel**:

```
/opportunity-map/proposal?pursuit=<id>
  └─ renders <ProposalsPanel email={…} tier={…} panelContext={{ pursuit_id: <id> }} />
```

One implementation, one place to fix a bug, notice-type handling inherited for free.

---

## Feature parity — what must NOT be lost

The Workspace has three things the panel does not. These move INTO the panel; they are not
reasons to keep a second implementation.

| Workspace-only | refs | Port as |
|---|---|---|
| **M-Win score** + "Why this score?" | 23 | A panel sub-component, shown when a pursuit is in context |
| Section-progress strip (Compliance/Technical/Past Perf/Pricing/Attachments %) | 2 | Panel header strip; keep the honest 0/pending for ungrounded bars |
| "Prepare for Submission" | 2 | Panel action; gate on notice type (see below) |

Also preserve: `Back to Pursuits` breadcrumb, `Share`, the Documents rail (already `pursuit-docs`),
and the Team/assign affordance (panel has 37 refs — likely already ahead).

---

## Notice-type behaviour (the actual fix)

Use the SHARED lib the panel already uses — `src/lib/utils/notice-type.ts`
(`classifyNoticeType`, `noticeTypeLabel`, `noticeTypeToDetected`, `Respondability`). **Do not
write a second classifier.**

| Notice type | Section set | Terminal action |
|---|---|---|
| **Sources Sought / RFI** | LOI path: Company Overview · Capabilities · Past Performance · Differentiators · POC (panel's `detectedNoticeType` path, ~line 106-124) | "Export response" — **no** "Submit Proposal" |
| **RFP / RFQ** | Full RFP set (`RFP_SECTION_TABS`): Exec Summary · Technical · Management · Past Performance | Prepare for Submission |
| **IDIQ / multiple-award** | OPEN QUESTION — see below | — |
| **unknown** | Fall back to RFP set, but say so; never silently assume |

⚠️ **`Respondability` already exists in the shared lib** (`'bid' | 'response' | 'none'`). A notice
typed `none` must not offer a drafting flow at all — check this before building the section map.

### OPEN QUESTION for Eric — IDIQ
Eric named IDIQ as a distinct case ("how do I do that in the new workspace versus an IDIQ"). It is
**not** a SAM notice type — it is a contract vehicle, and an IDIQ solicitation usually arrives AS
an RFP. Needs Eric's answer before building: does IDIQ need its own section set (e.g. capability +
task-order pricing model + teaming), or is it "an RFP with a teaming emphasis"? **Do not guess.**

---

## Pricing — remove from the narrative rail

Pricing is not a prose section and must stop looking like one.

- **Take it out of the section list.** It is a separate workflow with a different owner.
- Replace with a **Pricing handoff**: name the artifact (spreadsheet), name the owner (estimator),
  allow attaching the completed file, and reflect its status in the progress strip.
- Mindy's honest role: surface the pricing INPUTS it genuinely has (`get_pricing_intel` / GSA CALC
  labor rates, historical award values, M-Estimate) — **never generate a price**.
- Keep the progress bar honest: an unattached pricing artifact is `pending`, never a guessed %.

This matches what the code already believes (`kind:'deferred'`, "no fabricated data") and what
Eric said: *"not something that we do."*

---

## Execution plan (post-demo)

1. **Confirm the IDIQ question with Eric** (blocking — do not guess a section set).
2. Extract the Workspace-only three (M-Win, progress strip, Prepare-for-Submission) into panel
   sub-components, behind props so `/app` is unchanged when no pursuit is in context.
3. Repoint `/opportunity-map/proposal` to mount `<ProposalsPanel panelContext={{pursuit_id}} />`.
4. Wire notice-type section sets via the SHARED lib; add the Sources Sought/RFI LOI path.
5. Pull Pricing out of the narrative rail → Pricing handoff.
6. Delete the dead `STAGES` array and the string-emitting section rail **only after** parity is
   proven — not before.

### Proof required before calling it done
- Browser-verified on a **Sources Sought** pursuit: LOI sections, **no** "Submit Proposal",
  no Transition/Risk.
- Browser-verified on an **RFP** pursuit: full section set intact.
- M-Win, progress strip and Prepare-for-Submission still render (nothing lost).
- `/app?panel=proposals` **unchanged** — same render with no `pursuit_id` in context.
- A ledger row + the usual gates.

---

## Risks

- **The panel is 3,788 lines** — mounting it in a new route may surface assumptions about `/app`
  chrome (layout width, sidebar, tier gating). Auth is NOT one of them (measured above).
- `tier` must be resolved in the map route the same way `/app` resolves it, or Pro gating drifts.
- The Workspace URL is already shared/deep-linked (`?pursuit=`, `?section=`, `?notice=`); the
  mounted panel must honour `?section=` or those links break.
- **Do not delete the Workspace route file until parity is browser-proven.** A half-ported
  surface is worse than either whole one.

---

*Written 2026-08-18. Spec only — no code changed. Blocking question for Eric: the IDIQ section set.*
