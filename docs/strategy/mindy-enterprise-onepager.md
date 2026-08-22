# Mindy Enterprise

**Your data, your edge.** For teams that want Mindy's federal-contracting intelligence grounded in their *own* private assets — with the security controls and contractual terms an enterprise requires.

---

## The baseline (already true, stays standard)

**When you use Mindy over MCP — connected to your own AI client, the way you're using it today — your strategy never reaches our servers.** The reasoning happens in your client and your model. Mindy only ever receives discrete public-data lookups: a NAICS code, an agency, a UEI. The comparison you're actually making is assembled on your side, and we never see it.

What we log for billing is the *tool name*, the credits it cost, and whether it succeeded — **not the arguments you passed**. Those records are keyed to your account alone: never pooled across customers, never used to train anything shared.

*(Using the Mindy web app instead is a different boundary — there, chat runs on our servers under the protections described at getmindy.ai/app/trust. Both are private to you; only MCP keeps the analysis itself entirely on your side.)*

**Enterprise doesn't unlock privacy — it formalizes it and builds capability on top.**

---

## What Enterprise adds

### 1. Private Data Fusion — the differentiator
An isolated workspace where you bring your **own** data alongside Mindy's public and proprietary federal intelligence:

- Your **past-performance library** — so bid/no-bid and capability analysis is grounded in what *you've actually done*
- Your **teaming roster and relationships** — partner matching from your network, not a generic list
- Your **active pipeline** — pursuits and stages, so Mindy's read reflects your real position

The result: analysis no competitor can replicate, because it runs on assets only you have.

### 2. Security & Trust
- **Signed Data Processing Agreement (DPA)** and written data-handling terms
- **Zero-retention mode, in writing** — billing already records counts, not arguments; Enterprise commits it contractually and bypasses our shared public-API response cache for your account
- **SSO / SAML**, role-based access, and **audit logs**
- A **security-review packet** to fast-track your compliance team's approval

### 3. Capacity & Support
- Dedicated credit allotment and **priority rate limits** — your agents never queue behind free traffic
- **Multi-seat organization** under one account and shared billing
- A **named account contact** and optional white-glove market workups delivered as a managed service

---

## How it works

- **Annual agreement**, not metered credits — a predictable line item, not pay-as-you-go.
- **Isolated tenant** — your workspace, your data, your controls, walled from every other account.
- Onboarding, DPA, and security packet handled up front so your team can green-light fast.

---

## Design-Partner Program

Mindy Enterprise is launching with a small number of design partners who help shape it. As an early partner you get:

- **Founder pricing** locked for the term
- **Direct input** on the roadmap — the private-data and security features get built around real requirements, starting with yours
- **First access** to each capability as it ships

*Ideal for firms putting live pursuit strategy through Mindy who need their own data in the loop and their controls in writing.*

---

**Next step:** a 20-minute scoping call to walk the data boundary, confirm which controls matter most to your team, and shape the design-partner terms.

*Mindy · GovCon Giants AI · getmindy.ai*

---

> **Internal note (not for the prospect):** pricing is left as "founder / design-partner" on purpose — set the real number before sending. Several capabilities here (private data fusion, SSO/SAML, contractual zero-retention) are the *program being stood up*, framed as design-partner work rather than shipped features — keep that honest in conversation. Let the partner fund the build.
>
> **Verified against the live DB 2026-08-22 — the MCP privacy claim is real, don't soften it:**
> - `mcp_call_log` columns are `user_email, api_key_id, tool_name, credits_charged, status, latency_ms, created_at`. **No argument/parameter column exists.** "We log the tool name, not what you asked" is literally true.
> - `mcp_external_cache` DOES store `query_params` (jsonb, 92,505 rows) — but it has **no `user_email` column**, so entries are not attributable to a person. It's a cost cache against public APIs (SAM/USASpending), not a query log. Zero-retention mode = bypassing it for that account. Small build, real control — don't oversell it as "we currently retain your arguments," because we don't retain them *linked to you*.
> - The "never reaches our servers" claim is **MCP-specific**. In the web app, chat runs on our servers. The parenthetical in §Baseline draws that line — keep it; a prospect who later uses the web app must not feel misled.
>
> **Why design-partner, not build-first (verified 2026-08-22):** `mcp_call_log` has **36 MCP users all-time, 32 active in 30 days, 1,485 calls total** — and usage is concentrated in a handful of accounts. Standing up SSO/SAML, contractual zero-retention, and private data fusion speculatively is real engineering for a base this size. Let the first buyer fund it and supply the requirements. (An earlier "~23 users" figure is stale — use these numbers.)
>
> **Audience:** North Star — Suki and Sandeep. **They are MCP users**, which is why the §Baseline claim lands as literally true for them; lead with it.
>
> **Companion assets:** `market-assassin/docs/SECURITY-CUSTOMER-FACING.md` (send to their security reviewer — has the MFA/CloudTrail/GuardDuty/VPC-Flow-Logs mapping table) · `/app/trust` (live) · `market-assassin/docs/PRD-data-trust-layer.md` (what's shipped vs. Phase 4).
