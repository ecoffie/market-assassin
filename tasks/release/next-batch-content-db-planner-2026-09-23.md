# Next contained batch — Content Reaper, Contractor Database, Action Planner inside Mindy

**Prepared 2026-09-23, not started.** Separate from #1671 (which stays frozen). One PR per tool, in
the order below. Each PR keeps the legacy entry point live until its own acceptance passes, then
redirects it the same way #1671 does. Nothing purchased is deleted.

## The ownership rule (applies to all three)

> **Entitlement may be checked by the verified Mindy identity. Saved work is authorized ONLY by an
> ownership key bound to an authenticated account — never by matching an email string.**

- **Identity** is the server-verified Mindy session: the HMAC `x-mi-auth-token` resolved to a Supabase
  auth user. Nothing else counts: no `?email=`, no body `email` / `userEmail`, no `ma_access_email`
  cookie, no localStorage.
- **Entitlement** (`contentgen:`, `dbaccess:`, Pro) answers "may this person use the tool". It is keyed by
  the purchase email and checked against the verified session email. This is how #1671 already treats `ma:`.
- **Ownership** answers "may this person see THESE saved rows". It must be the auth user ID, or an explicit
  link created by proving control of the legacy account. An email match alone never opens saved work, even
  when the session email is verified. A legacy row carrying the same email string is not proof it belongs
  to this account.
- **Every read and write is scoped server-side** by the ownership key. Tests prove cross-account denial,
  not just the happy path.

## 1. Contractor Database (first — a paying buyer is unserved today)

| | |
|---|---|
| Purchased | ~3,500 primes with SBLO name / email / phone, subcontracting-plan and supplier-portal filters, CSV export |
| Mindy today | Contractors panel (`search-bq`, 317K firms). The row type declares `sblo_name/email/phone`, but **`search-bq` returns no SBLO fields** |
| Saved work | **None.** Generate-on-demand; the legacy tool stores nothing per user |
| Ownership | N/A (no saved work). Entitlement = `dbaccess:` **or** Pro, checked against the verified session email |

**Build**
- Server-side join of the existing `src/data/prime-contractors-database.json` + `sblo-roster-2026-06.json` into `search-bq` results: by UEI, then normalized name. Contact fields are returned **only** when the verified session is entitled; others get `has_contact: true` without the values.
- Add plan and portal filter chips.
- CSV export of the current filtered rows, server-generated, entitlement-checked. The row cap is stated in the UI.
- After acceptance: `/contractor-database`, `/database.html` and `/database-locked` → `/app?panel=contractors`. This also removes the dead buy button left by manifest S2.

**Acceptance**
- An entitled fixture sees SBLO email/phone; a non-entitled one does not (API and UI).
- `?email=` or a cookie cannot unlock contacts.
- CSV row count equals the filtered count.
- A buyer holding only `dbaccess:` sees contacts.

## 2. Content Reaper

| | |
|---|---|
| Purchased | LinkedIn post generator (≤30/click, templates), .docx/.zip/PDF export, saved library; Full Fix: graphics/carousels, 30-day calendar |
| Mindy today | Nothing. The Library panel reads `user_generated_archive` |
| Saved work | **`content_library`: 126 posts, 13 owners** (read-only count, 2026-09-23), keyed by **`user_id` = Supabase auth user ID**. All 13 match `auth.users` and `user_profiles`. There is **no `user_email` column** in production |
| ⚠️ Found | `/api/content-generator/library` filters `user_email`, which does not exist. GET/POST/DELETE all error (**prod returns 500**). The legacy library is **broken in production today**, not exposed. It is also unauthenticated and CORS `*`, so it must not be "fixed" by adding the column |

**Build**
- A `content` panel in `/app` hosting the existing `public/content-generator` UI (`API_BASE=''`). Gate: `contentgen:` or Pro.
- A new `/api/app/content-library`, identity from the verified session → `auth.users.id` → `content_library.user_id = <that id>`. This matches the existing key exactly, so no email matching and no data move. The 13 owners see their posts the first time they sign in to Mindy.
- The old email-parameter library route is replaced by the session route and then deleted, never patched.
- Exports move with the hosted UI. Carousel and calendar call APIs that are already missing: they are hidden with a stated notice, repaired separately.

**Acceptance**
- Fixture A sees exactly A's rows. B's session gets none of A's rows.
- A request carrying `email=A` with B's session gets B's rows.
- An unauthenticated request → 401.
- Generate → save → reload shows the post under the same `user_id`.

## 3. Action Planner

| | |
|---|---|
| Purchased | 36-task, 5-phase plan with notes, due dates, progress, gamification, PDF export, lessons/resources |
| Mindy today | Nothing |
| Saved work | `user_plans` + `planner_gamification` in a **separate Supabase project** (`NEXT_PUBLIC_PLANNER_SUPABASE_URL` is set in production). Keyed by the **planner project's auth UID**, with RLS `auth.uid() = user_id`. Row counts not measured (a different project). |
| Access today | The planner's own login, gated by a shared `PLANNER_ACCESS_CODE` |

**Ownership: explicit link, proven by the planner credential.**
- A Mindy auth UID and a planner auth UID are different identities, and emails can differ. So the link is created only by signing into the planner account once from inside Mindy, with the planner's own password or planner magic link.
- That stores `(mindy_user_id, planner_user_id, linked_at)` in the Mindy DB. Reads use the planner service client **scoped to the linked `planner_user_id`**.
- An unlinked Mindy user sees a "Connect your Action Planner" step, never someone's plan and never an empty plan presented as theirs.
- No cross-project data copy.

**Build**
- `/app?panel=planner` reusing the `src/app/planner` components.
- The link table plus a migration: idempotent, applied with `npm run migrate`, verified through PostgREST.
- After acceptance: `/planner/login` → `/app?panel=planner`. The shared `PLANNER_ACCESS_CODE` is retired in the same way as #1677: no indefinite exception.

**Acceptance**
- Link requires a valid planner credential; a wrong one → refused.
- Linked A sees A's plan; B cannot read A's plan by any parameter.
- Unlinking removes access.
- Progress and PDF export are unchanged.

## Order, size, gates

1. Contractor DB.
2. Content Reaper.
3. Planner.

Each PR ships with:
- Hermetic ownership tests, including cross-account denial and parameter tampering.
- A production-build acceptance run in the #1671 harness style.
- A mutation proof that the ownership check is load-bearing (remove it → the tests go red).

None of them changes billing or grants.
