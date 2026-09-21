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

- **Row-Level Security (RLS) enforced on every table holding customer data.** Access is
  enforced at the database layer, not just in application code — so your data is
  protected by defense-in-depth. On the most sensitive tables (your private vault) RLS
  is additionally set to FORCE, which applies the restriction even to the table's owner.
  The handful of tables without RLS contain only public federal reference data —
  agency budgets, forecasts, and award-derived statistics that are public record.
  Database credentials are restricted to our server-side services; the public
  application key cannot read your data directly.

## Secure development

- Credentials are stored in secure environment configuration, never in our source code.
- Every deployment passes an automated security gate — including checks that gated
  endpoints cannot be accessed without authentication — before going live.

## If your security team asks for AWS controls

Security questionnaires often list AWS product names — MFA, CloudTrail, GuardDuty, VPC
Flow Logs. Those are names for capabilities, not the capabilities themselves. Mindy
doesn't run on AWS; it runs on Vercel and Supabase. Every one of those controls has a
direct equivalent on our stack, and we've built them:

| What your team is asking for | What it means | What Mindy has |
|---|---|---|
| **MFA** | Strong login, no shared secrets | Two-factor authentication — email + a 6-digit one-time code, with attempt limits and expiring codes. Admin access is tied to named individuals, not a shared login |
| **CloudTrail** | An audit trail: who did what, when | Every sensitive administrative action writes a queryable audit record — actor, action, target, source IP, timestamp. Secrets are never written to it |
| **GuardDuty** | Threat and abuse monitoring with alerting | Automated login-abuse detection watching two independent signals — repeated failures against one account, and one address failing across many accounts — firing real-time alerts to our team |
| **VPC Flow Logs** | An enforced access boundary, with logs | Row-Level Security at the database layer (see *Data isolation* above), plus infrastructure access logging from Vercel and Supabase |

We're glad to walk a security reviewer through any of these in detail.

## On the roadmap

We continuously improve our security posture — expanding per-user access controls and
monitoring coverage as we grow.

---

**Questions?** For security inquiries, security questionnaires, or to report a concern,
contact us at **hello@govconedu.com** and we'll respond promptly.
