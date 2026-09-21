# PRD: Newcomer Clarity — "What Is Mindy?" Across Public Surfaces

> A student asked Eric "what is Mindy?" — meaning our public/shared pages don't
> consistently tell a first-timer what the product is or what to do. Every
> external entry point should: (1) preview well when shared, and (2) explain
> Mindy + offer a free signup. This is the top of the growth funnel.

**Status:** Draft / scoping — 2026-06-05. Highest-traffic pages first.
**Trigger:** Eric: "A student asked me what was Mindy? Are there other places we
should add metadata so external users know what to do?"
**Related:** the share-opportunity dynamic preview (shipped 2026-06-05) is the
first instance of this pattern.

---

## 1. The problem

Mindy has **dozens of public, logged-out pages** — SEO landers (contractors,
agencies, awards, contracts, compare, blog…) and shared links (/shared/opp).
People reach them via Google, a shared link, or word of mouth. Two gaps:

1. **Inconsistent share previews (OG):** some pages have OpenGraph metadata
   (contractors, blog), many don't (agency, awards, access, the root /shared).
   A bare preview = low click-through; a generic one = "what is this?".
2. **No newcomer explainer:** a logged-out visitor on a data page sees federal
   data with no "this is Mindy, here's what it does, sign up free" path. The
   product doesn't introduce itself — hence the student's question.

This is leaky top-of-funnel: traffic arrives, doesn't understand the product,
bounces.

---

## 2. The two fixes (apply to every public page)

### A. Consistent, specific OpenGraph previews
Every public page exports `generateMetadata` with a title/description/image that
says what THIS page is + that it's Mindy. Dynamic where the page is about a
specific entity (an opportunity, a contractor, an agency) — like the shipped
/shared/opp preview ("Eric shared a $4.2M Roofing contract via Mindy").
- Reuse the dynamic-OG-image pattern from `shared/opp/[shareId]/
  opengraph-image.tsx`.

### B. "New here? Meet Mindy" strip + free CTA
A consistent, dismissible component on logged-out public pages:
> **Mindy** is your 24/7 federal market intelligence analyst — it scans 24,000+
> opportunities daily, scores your fit, and tells you what to bid on.
> **[Try Mindy free →]**
- Shows only when logged out. One shared component, dropped into each public
  page's layout. Links to the getmindy.ai signup.

---

## 3. Priority order (highest-traffic / highest-intent first)

| # | Surface | Why | Status |
|---|---|---|---|
| 1 | `/shared/opp/[id]` | the viral share entry | ✅ OG done; add the "Meet Mindy" strip |
| 2 | `/contractors`, `/contractors/[slug]` | big SEO surface (317K firms) | has OG; add strip + verify |
| 3 | `/agency`, `/agencies` | agency landers | needs OG + strip |
| 4 | `/awards`, `/contracts/[piid]` | award/contract pages | needs OG + strip |
| 5 | `/compare`, product pages | comparison/intent pages | audit |
| 6 | `/blog/[slug]` | SEO content | has OG; ensure CTA |
| 7 | root `/` (getmindy.ai) | already the landing page | OG good; baseline |

Do 1-4 first; they're where shared links + organic search land.

---

## 4. Scope

- **In:** `generateMetadata` (+ dynamic OG image where entity-specific) on each
  public page; one shared "Meet Mindy" strip component (logged-out only);
  wire the free-signup CTA to getmindy.ai.
- **Out:** redesigning the pages themselves; gating data differently; the app's
  authed surface (this is about LOGGED-OUT/external visitors).
- **Reuse:** the `/shared/opp` OG pattern; the root layout's brand copy.

---

## 5. Success criteria

- Every public page has a specific, branded share preview (no bare/generic
  cards). Verify with the Facebook/LinkedIn/iMessage debuggers.
- A logged-out visitor on any public page sees, in one glance, what Mindy is +
  a free-signup CTA.
- Measurable: shared-link → signup conversion, and organic-page → signup, both
  tracked. No more "what is Mindy?" from people who landed on a page.

---

## 6. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Public pages must self-introduce Mindy (student "what is Mindy?" signal). Scope as PRD, fix highest-traffic first; OG previews + a logged-out "Meet Mindy" strip. shared-opp OG already done. | Eric |
