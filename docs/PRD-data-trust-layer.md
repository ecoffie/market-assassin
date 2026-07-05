# PRD — Data Trust Layer (Mindy)

**Author:** Eric Coffie + Claude
**Date:** 2026-07-05
**Status:** Scoped, not started
**Grounded in:** `docs/` audit of 2026-07-05 (see memory `vault_data_protection_audit`). Every claim here is backed by a file:line finding — no assumptions.

---

## Why this exists

Customers are putting their most sensitive data into the Mindy vault — EINs, CAGE codes, security clearances, real contract references, resume text, pricing templates (`20260526_profile_vault.sql`). Multiple have asked, in effect: *"Is my data safe in here? Can the AI steal it? Can another company see it?"* This is Alex Karp's (Palantir) point in SMB form — **data trust is a product feature, not a legal footnote.** For a tool being built to sell (`exit_strategy_brand_separation`), provable data trust is direct enterprise-valuation upside.

**The framing (application layer vs. frontier model):** Mindy is the *application layer* — the 463 routes, the vault, the RAG, the workflows. The frontier model (GPT-4o/Claude/etc.) is a swappable component Mindy *calls*. The trust story is: **your data lives in Mindy's application layer, under Mindy's access control; the model only ever sees the narrow, permission-filtered slice we hand it, and it never trains on it.** That is exactly the Palantir ontology/boundary pattern at SMB scale.

---

## The hard rule for this whole effort

> **Make every claim TRUE before we publish it.** A trust page that overclaims is worse than no page — it's a liability and, on sale, a diligence landmine. The audit found **3 claims that are false today.** We fix the enforcement first, then we advertise it. Order matters.

---

## What is TRUE today (safe to claim now)

Verified in the audit — these are real and shippable as-is:
- Every vault read/write **authenticates** (`verifyUserOwnsEmail`, `api-auth.ts:375`) and **scopes queries to the authenticated owner** (`.eq('user_email', auth.email)` on every route).
- **No route exposes a parameter to read another user's vault** — no `target_email`/`on_behalf`.
- **RAG retrieval is owner-scoped** — the pgvector RPC `match_vault_evidence(p_email)` filters every branch to the caller's rows (`20260702_vault_pgvector.sql:74`).
- **Uploaded files are private** — `vault-assets` is a `public:false` Storage bucket, served via signed URLs (`team/resume/route.ts:35`).
- **The frontier model does not train on your data** — OpenAI/Anthropic API business tiers contractually don't train on API inputs (provider policy, true today).

## What is FALSE today (must fix before claiming)

1. **"We delete your data on request"** — `delete-mindy-user`'s `USER_EMAIL_TABLES` (`delete-mindy-user/route.ts:23`) **omits all 5 vault tables** and the `vault-assets` files. The most sensitive PII *survives* account deletion.
2. **"Export or delete your data anytime"** — there is **no user self-serve export**, and delete is admin-password-only.
3. **"Your data is isolated at the database level"** — false. Isolation is **application-code only**; the vault tables have **zero RLS** (`20260526_profile_vault.sql` has none; the blanket RLS migration predates and omits them). A dropped `.eq` filter or an auth bypass = full cross-tenant read, with no DB backstop.

---

## Plan — 4 phases, enforcement before promise

### Phase 1 — Make the promises true (enforcement) — **DO FIRST**
The unglamorous, non-negotiable groundwork. No customer-facing surface until this lands.

| # | Fix | Why | Effort |
|---|-----|-----|--------|
| 1.1 | ✅ **DONE (2026-07-05).** Wired all 5 vault tables + `vault-assets` Storage files into `delete-mindy-user` via the shared `deleteAllVaultData()`; added self-serve `DELETE /api/app/vault?confirm=DELETE` (user-auth, owner-scoped). Canonical list in `src/lib/vault/vault-data.ts` so the admin + self-serve paths can't drift again. | Makes "we delete your data" true; closes the PII-survives-deletion gap. | S |
| 1.2 | ✅ **DONE (2026-07-05).** `GET /api/app/vault/export` returns the caller's full vault as a downloadable JSON (owner-scoped, `verifyUserOwnsEmail`), including a Storage-file manifest. | Makes "export anytime" true; table-stakes for enterprise/GDPR-style asks. | S |
| 1.3 | **Enable RLS as a backstop on the 5 vault tables** — `auth.uid()`/email-scoped policies so a dropped app-filter can't leak cross-tenant. Hand-run SQL (no in-app DDL). Keep service-role for legit server paths, but add the owner policy so anon/authed clients are DB-enforced. | The `coach_mode_tenancy` decision ("RLS as the enforcement backstop") — currently NOT done for vault. Turns app-code trust into defense-in-depth. | M |
| 1.4 | **Retire/​harden the weak auth surfaces for vault** — stop honoring the legacy `ma_access_email` cookie and the token-less domain staff-bypass on *vault* routes specifically. | Removes the weakest isolation paths from the highest-sensitivity data. | S |

### Phase 2 — The Trust Layer (customer-facing) — **the thing you asked to start with**
Now that the claims are true, surface them. Two pieces:

- **2.1 A "Your data is yours" trust page** (`/app/trust` or a Vault section) — plain-language, HubSpot/Notion-style, NOT legalese. States exactly what's now true: workspace-isolated + DB-enforced (after 1.3), we don't train models on your vault, the AI only retrieves *your* rows, files are private, you can export or delete anytime (after 1.1–1.2). Links to the legal `/privacy`.
- **2.2 Inline trust cues in the Vault UI** — a small "🔒 Only you can see this · Export · Delete" affordance on the vault itself, where the anxiety actually lives. Data-behind-glass done in reverse: reassurance at the point of upload.

*Design: navy→purple/emerald brand, matches `mindy-landing`. Copy in Mindy plain-language voice (`mindy_vocabulary_rule`) — no "tenant isolation" jargon; say "only you can see your vault."*

### Phase 3 — AI data-handling transparency
- **3.1 Provider transparency + no-training statement** — document (and where cheap, enforce) that vault text goes only to no-training API tiers; make the provider deterministic per data-class instead of "whoever answers first" so we can *tell* a customer who saw their data.
- **3.2 (Optional) PII-minimization before LLM calls** — for the highest-sensitivity fields (EIN, clearance, reference contacts), evaluate redacting/tokenizing before the model call where it doesn't break the workflow. Scope after 3.1; may not be worth the accuracy cost — decide with data.

### Phase 4 — Enterprise-grade (the Karp/ontology tier) — later, contract-driven
- Per-workspace `org_id` on vault tables + the full ontology/permission-boundary model (ties to Coach Mode enterprise tenancy).
- Tenant-scoped encryption / bring-your-own-key — the premium add-on for a customer who contractually demands it (per `coach_mode_tenancy`: only for the 1–2 who pay, never default).
- This is where "Mindy runs inside your FedRAMP boundary, model in-boundary, no external egress" (the FSIS §6 answer) becomes a shipped capability, not a teaming promise.

---

## Recommended build order

**Phase 1 (all of it) → Phase 2 → then decide 3/4 with data.** Phase 1 is ~1–2 days (1.3 RLS is the only medium lift, hand-run). Phase 2 is the visible payoff you asked to lead with — but it's honest *only because* Phase 1 shipped first. Phases 3–4 are strategic, revenue/contract-gated.

## Success criteria
- [ ] A user can export their full vault (self-serve) and delete it — including Storage files — with proof (row counts → 0).
- [ ] Vault tables have owner-scoped RLS; a query with the app-filter removed returns 0 cross-tenant rows in a test.
- [ ] The trust page makes only claims that map to a shipped enforcement (a checklist: each claim → its code/migration).
- [ ] Marketing literature updated (`MARKETING-FEATURE-LITERATURE.md`) in the shipping commit.

## Explicitly out of scope (for now)
- SOC 2 / formal audit (revenue-gated; note it as "roadmap").
- FedRAMP/ATO (that's the prime's boundary per the FSIS teaming posture — not Mindy priming).
