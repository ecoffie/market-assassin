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

## Data isolation

- **Row-Level Security (RLS) enabled on every database table.** Access is enforced at
  the database layer, not just in application code — so customer data is protected by
  defense-in-depth. Database credentials are restricted to our server-side services;
  the public application key cannot read your data directly.

## Secure development

- Credentials are stored in secure environment configuration, never in our source code.
- Every deployment passes an automated security gate — including checks that gated
  endpoints cannot be accessed without authentication — before going live.

## On the roadmap

We continuously improve our security posture — expanding per-user access controls and
monitoring coverage as we grow.

---

**Questions?** For security inquiries, security questionnaires, or to report a concern,
contact us at **hello@govconedu.com** and we'll respond promptly.
