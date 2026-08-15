# The homepage is stateful

**Decided by Eric, 2026-08-15.** The behavioral model for `/today`. Read this before adding
anything to the page — it is the rule that keeps the bottom half from becoming a wall of
empty panels as personalization grows.

> - Anonymous users see **Discovery**.
> - Authenticated users see **Momentum**.
> - Expired sessions see **Recovery**.
>
> The page should always help the user move forward, never explain why it has nothing to show.

## The three states

The **top half is identical in all three** — story, lens (map), featured opportunities. It is
public data and it is the proof that the market is alive. Only the bottom half is stateful.

| State | Trigger | Bottom half | Goal |
|---|---|---|---|
| **1 — First visit** | no token | **Explore by Market** — real active-opportunity counts per industry | Help them discover the market |
| **2 — Returning** | valid token | **Your Market** — Since your last visit · Pick Up Where You Left Off · Your Work · Recommended | Continue yesterday's work |
| **3 — Session expired** | token present but expired | **Recovery** — "Welcome back. Sign in to resume your saved markets, pursuits, and recommendations." + today's activity | Restore access without pretending they're new |

State 3 is NOT state 1. A user with a year of pursuits who sees the first-visit tiles is being
told they are new. Acknowledge the history; just say it isn't available until they authenticate.

## ⚠️ Gate on the TOKEN, not the decoded email

Two different questions that must never drive the same UI decision:

- **Authentication state** — *can we trust this session?* → `tk` present + not expired
- **Profile completeness** — *do we know who this user is?* → the decoded email

`_uemail()` decodes the wrong JWT segment and returns `''` even for a genuinely signed-in user
(`src/app/opportunity-map/route.ts:5399`, real bug — Eric: *"this says sign in but we are already
logged in"*). Gating the split on the email would show a signed-in person the anonymous half.

```js
if (!tk)              → State 1 (discovery)
else if (expired(tk)) → State 3 (recovery)
else                  → State 2 (momentum)
```

## The rule: never render an empty personalized section

If personalization has nothing meaningful to show, **fall back to the next-best experience** —
do not render the heading with nothing under it, and never print an apology.

```
1. Your Market (personalized)          ← needs a valid session AND real rows
2. Explore by Market (behavior unavailable)
3. Featured Opportunities (always available)
```

So a signed-in user with zero history does NOT get "Nothing tracked yet" — they fall through to
Explore by Market, which is genuinely useful and always populated. The page cannot terminate in
an empty state by construction, and `today-page-states.unit.test.ts` enforces it.

## Every number is a live count

Market tiles show real active-opportunity counts per NAICS family, from
`src/lib/industry-presets.ts` (the SAME taxonomy the map's industry picker uses, so the tile and
the map it links to can never disagree). Measured 2026-08-15 — note how far intuition was off:

| Industry | Active opportunities |
|---|---|
| Manufacturing | 16,389 |
| Construction | 3,690 |
| Facilities | 1,149 |
| Professional Services | 1,002 |
| Healthcare | 714 |
| Information Technology | 605 |
| **All active** | **34,827** |

An early mockup guessed "Construction 14,200" — off by ~4×, and Manufacturing (the actual
leader) was absent entirely. Count before you publish a number; never hand-write these.
