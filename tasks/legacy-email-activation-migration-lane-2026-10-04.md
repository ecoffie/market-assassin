# Legacy email-activated products — migration lane (opened 2026-10-04)

**Status: OPEN, separate lane.** Not part of R1, which is closed: `tasks/auth-r1-closeout-2026-10-04.md`.

## Why this is its own lane

Mindy's own surfaces now identify callers only from verified authentication (R1). The older one-time-purchase tools still identify buyers by the email they purchased with:
- Content Reaper
- Federal Market Assassin
- Recompete Tracker
- Opportunity Hunter Pro

Their pages have no Mindy session. Applying R1's rule to them directly would silently cut paying legacy customers off. Mindy does not remove paid access without a path for the customer.

## Rule (Eric, 2026-10-04)

| Kind of access | Requirement |
|---|---|
| A customer's private data, or any change to it | Verified identity |
| Paid content | Verified identity **and** the entitlement |
| Public content | May stay public, but an email address never grants authority |

## Required order

1. **Inventory:** each legacy product's surfaces, which of the three kinds each one serves, and who still uses them (measure before changing anything).
2. **Authenticated transition** for those customers, e.g. the secure sign-in link pattern proven for `/briefings` in #1801, so each buyer reaches their product through a verified session.
3. **Only then:** move each legacy gate to the rule above, product by product, each with production acceptance.
4. **Retire** products already discontinued rather than hardening them (see the legacy retirement sequence).

The detailed surface inventory is kept private until each gate has been migrated.
