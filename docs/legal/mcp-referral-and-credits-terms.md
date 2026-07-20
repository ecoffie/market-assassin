# Mindy MCP — Referral Program Terms & Credits Terms

> The two net-new legal artifacts for the credit product (GOS-aligned; see the exit-readiness
> note below). These are **Program Terms referenced from the master Terms of Service** — NOT a
> separate privacy policy. The master Privacy Policy + ToS still govern data. Draft for review by
> counsel before publishing; the language below is written to be diligence-safe (no cash
> liability, clear revocation rights).

---

## A. Referral Program Terms

**Eligibility.** Any Mindy account holder may refer others using their personal referral link.
The program is for genuine referrals of new users only.

**The reward.** When a person you refer creates a Mindy account and completes their **first
verified sign-in** (via OAuth — Google/Microsoft/Apple — or multi-factor authentication),
**you and your referred friend each receive 100 Mindy MCP credits.**

**How to qualify — the rules that protect everyone:**
- The reward is granted only after the referred user completes a **verified authenticated
  session**. Signing up with an unverified email alone does not qualify.
- A given referred person can generate **only one** referral reward, ever (first referrer to
  bring them wins).
- **Self-referral is not permitted** — you cannot refer your own additional accounts, and
  referrer and referred must be different verified identities.
- Each referrer may earn rewards for up to **25 referred users**. (Configurable; current cap 25.)

**No cash value.** Referral credits, like all Mindy credits, **have no cash value, are
non-transferable, are not redeemable for money**, and may expire per the Credits Terms below.

**Fraud & revocation.** Mindy may **withhold, reverse, or revoke** referral credits and suspend
participation where it detects fraud, abuse, self-dealing, fake or duplicate accounts, automated
signups, or any attempt to circumvent these rules. Mindy may modify or end the program, or change
the reward amount or cap, at any time, with prospective effect.

---

## B. Credits Terms (clause for the master ToS)

**What credits are.** Mindy MCP credits are a **prepaid unit of access** used to run metered
tools. They are debited only when a tool call succeeds.

**No cash value.** Credits **have no cash value, are non-transferable and non-refundable except
as required by law**, cannot be redeemed for money, and confer no ownership or property right.

**Grants & expiry.** Credits may be granted by purchase, subscription allowance, promotion, or
referral. Free, promotional, and referral credits may **expire** and may be **revoked for abuse**.
Purchased credits are governed by the applicable plan and refund terms.

**Balance & billing.** A tool call that would exceed the available balance is declined before it
runs; you are never charged into a negative balance. Subscription and top-up charges are handled
by our payment processor (Stripe).

**Changes.** Mindy may adjust per-tool credit prices, allowances, and these terms prospectively;
material changes will be communicated.

---

## C. Exit-readiness note (why this structure, not per-feature policies)

Large SaaS do **not** write a privacy policy per feature — a single master Privacy Policy + ToS
cover the product, with short **Program Terms** (like §A) for value-granting programs. An
acquirer's diligence checks: (1) the Privacy Policy + ToS actually cover what the product does;
(2) **data provenance** — Mindy's core data is **public record** (SAM.gov / USASpending), so it is
cleanly resellable (a green flag); (3) **PII + LLM handling** — Mindy sends sensitive vault data
only to a **no-training allow-list** of model providers (document this); (4) **no cash liability**
in credit/referral programs — handled by §A/§B above.

**Still needed for the enterprise / data-feed motion (separate track):** a **Data Processing
Agreement (DPA)** and a **subprocessor list** — current subprocessors: Stripe (payments),
Supabase (database), Resend (email), OpenAI / Anthropic / Groq (LLM, no-training for sensitive),
Google BigQuery (analytics data warehouse). Inventory + DPA when courting feed buyers.
