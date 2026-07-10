# Security at Mindy

We take the security of your data seriously. Mindy is built on SOC-2-certified cloud
infrastructure and hardened at the application layer. Here's what that means in plain
terms.

## Infrastructure

Mindy runs on enterprise-grade, SOC-2-certified providers:

- **Hosting & compute:** Vercel
- **Database & authentication:** Supabase (PostgreSQL)
- **Payments:** Stripe (PCI-DSS Level 1)

Your data is **encrypted in transit** (TLS/HTTPS) and **encrypted at rest** by these
providers by default.

## Authentication

- **Two-factor authentication (2FA).** Logins are protected with one-time email
  verification codes, with automatic limits on attempts and expiring codes.
- **Individual admin accounts.** Administrative access is tied to specific,
  authenticated team members — not a shared login — so every privileged action is
  attributable to a person.

## Monitoring & threat detection

- **Real-time abuse alerts.** Suspicious login activity — such as repeated failed
  attempts against an account, or a single source attacking many accounts — triggers an
  immediate alert to our operations team.
- **Rate limiting.** Sensitive endpoints are rate-limited to prevent abuse and
  automated attacks.

## Audit trail

- **Full activity logging.** Sensitive administrative actions are recorded in a
  queryable audit log capturing who performed the action, what changed, the source, and
  when — supporting accountability and investigation.
- **Secrets are never exposed.** Access tokens and credentials are never written to
  logs in full.

## Payments

- **Verified, secure payments.** All payment events are cryptographically verified
  before being processed. We never store your raw card details — those are handled
  entirely by Stripe.

## Secure development

- Credentials are stored in secure environment configuration, never in our source code.
- Every deployment passes an automated security gate — including checks that gated
  endpoints cannot be accessed without authentication — before going live.

## On the roadmap

We continuously improve our security posture. Currently in progress: **database-level
row isolation (Row-Level Security)** for defense-in-depth beyond the application layer.

---

**Questions?** For security inquiries, security questionnaires, or to report a concern,
contact us at **hello@govconedu.com** and we'll respond promptly.
