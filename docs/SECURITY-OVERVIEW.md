# Mindy Security Overview

*Last updated: 2026-07-10. Owner: Eric. This is the internal source of truth — the
customer-facing version is `docs/SECURITY-CUSTOMER-FACING.md`. Keep both honest:
label anything not yet shipped "(in progress)" or "(planned)". Every claim here maps
to real code/config, not aspiration.*

---

## TL;DR (how to answer "is Mindy secure?")

Mindy runs on SOC-2-certified cloud infrastructure (Vercel, Supabase, Upstash, Stripe)
and we've hardened the application layer with: **two-factor authentication, per-user
admin accountability, a queryable audit trail, automated login-abuse alerting,
signature-verified payments, and secrets kept out of code.** Row-level database
isolation (RLS) is the current in-progress item.

**On the "AWS features" prospects sometimes ask for (MFA / CloudTrail / GuardDuty /
VPC Flow Logs):** those are *AWS product names*. Mindy doesn't run on AWS — it runs on
Vercel + Supabase. Every one of those capabilities has a direct equivalent on our
stack (see the mapping table), and we've built them.

---

## The AWS-ask → what we actually have

| Capability (AWS name) | What it means | Mindy's equivalent | Status |
|---|---|---|---|
| **MFA** | Strong login, no shared secrets | Email + 2FA (TOTP-style 6-digit codes), per-user admin | ✅ Live |
| **CloudTrail** | Audit log: who did what, when | `audit_log` table + queryable admin API | ✅ Live |
| **GuardDuty** | Threat/abuse monitoring + alerts | Login-abuse detection → real-time Slack alerts | ✅ Live |
| **VPC Flow Logs** | Network/access boundary + logs | Supabase Row-Level Security + Vercel/Supabase access logs | ✅ RLS live (all tables) |

---

## What's shipped (with evidence)

### 1. Authentication & access
- **Two-factor authentication** — email + a 6-digit code (10-min TTL, max 5 attempts,
  60-sec resend throttle). Sessions are HMAC-signed with a 30-day TTL.
- **Per-user admin accountability** — admin actions are tied to a specific person's
  authenticated identity (via `MI_ADMIN_EMAILS` allowlist + 2FA), not an anonymous
  shared login. *(commit cc67af4f — verified live in prod: admin actions record the
  real actor email.)*
- **Least-privilege service keys** — the database service key is server-side only;
  never shipped to the browser. *(verified: 0 client-side references.)*

### 2. Audit logging ("who did what, when")
- Every sensitive admin action (grant/revoke access, etc.) writes a queryable
  `audit_log` row: actor, action, target, source IP, timestamp, and detail.
  *(commit 6d70c82c — table live, verified end-to-end.)*
- **Secrets are never logged** — e.g. access tokens are recorded by a 6-char prefix
  only, never in full. *(verified via an automated leak check.)*
- Failed admin-auth attempts are recorded too.

### 3. Threat monitoring & abuse prevention
- **Automated login-abuse detection** — repeated failed logins on one account
  (≥5 / 15 min) or one IP failing across many accounts (≥12 / 15 min) fire a
  **real-time Slack alert** to our ops channel, de-duplicated to one alert per
  window. *(commit 29982e6f — verified live, including a real Slack post.)*
- **Rate limiting** on every sensitive endpoint (per-email, per-IP, and admin
  windows), backed by Upstash.
- **Abuse flagging** — lifetime per-account usage tracking with escalating
  review/flag thresholds.

### 4. Payments
- **Signature-verified Stripe webhooks** — every payment event is cryptographically
  verified against the Stripe signing secret before it's trusted (`constructEvent`),
  with idempotency handling. *(src/app/api/stripe-webhook/route.ts.)*
- We never store raw card data — Stripe (PCI-DSS Level 1) handles all card details.

### 5. Secrets & infrastructure
- **Secrets in environment config, not code** — no credentials committed to the
  repository. *(An earlier exposure was found, the credential was rotated, and 5
  scripts were fixed to read from the environment — commit ee590a9a. We now scan for
  this.)*
- **SOC-2-certified providers** — Vercel (hosting/compute), Supabase (Postgres/auth),
  Upstash (cache), Stripe (payments). Data is encrypted in transit (TLS) and at rest
  by these providers by default.
- **Automated pre-deploy gate** — every deploy runs a typecheck, an auth-header audit
  (blocks unauthenticated access to gated endpoints), and unit tests before shipping.

---

### Data isolation (RLS) — ✅ live
- **Row-Level Security enabled + forced on all 127 public tables** (2026-07-10), with a
  service-role-only policy and anon/authenticated grants revoked. Closed a finding where
  the public anon key could read every table. Verified: anon-readable 127→0, app (service-
  role) reads intact. Migration: `migrations/20260710_enable_rls_all_public.sql`.

## In progress / planned (be honest about these)

- 🔲 **Per-user admin fan-out** *(in progress)* — the identity mechanism is live; we're
  extending it across all admin endpoints.
- 🔲 **Formal compliance attestation (SOC-2 / etc.)** *(not yet)* — we inherit SOC-2
  from our infrastructure providers but do not yet hold our own formal attestation.
  Don't claim we're "SOC-2 certified."

## Claims to NEVER make
- ❌ "We're SOC-2 / ISO-27001 certified" (we inherit provider certs; we don't hold our own).
- ❌ "We run on AWS / have GuardDuty/CloudTrail" (we have the equivalents on Vercel/Supabase).
- ❌ "Fully penetration-tested" / "unhackable" — never.
- ❌ Any specific control not in the "shipped" list above.
