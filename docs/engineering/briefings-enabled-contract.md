# The `briefings_enabled` contract

**Status:** established 2026-09-04 (TASK-STRIPE-DUP-004, scope item 10);
**corrected 2026-09-05** (TASK-STRIPE-DUP-005) after review found the decision
rule could not actually distinguish the states it claimed to.
**Question it answers:** may an entitlement repair write
`user_notification_settings.briefings_enabled`, or must it preserve the user's value?

The scope required this be **proven before the flag is touched**, because the
evidence genuinely pointed both ways and shipping a repair that flips it without
resolving the question is a verification failure.

---

## Verdict

`briefings_enabled` is **MIXED-PURPOSE state**: it is provisioning state by
default *and* a genuine user preference when the user has expressed one. It is
not purely either, and the repair must therefore never treat the raw value
`false` as self-explanatory — `false` has at least three different origins.

Concretely, for the repair operation:

| situation | what repair does | reported as |
|---|---|---|
| entitled, `is_active = true`, flag false | **enable it** — unprovisioned | — (`changed`) |
| entitled, `is_active = false` | **preserve the stored value** — explicit opt-out outranks entitlement | `opted_out` |
| entitled, **`is_active = NULL`** | **preserve the stored value** — the state is UNKNOWN; fail closed | `opt_out_unknown` |
| entitled, no settings row | **do not create one** | `no_settings_row` |
| not entitled | leave the flag alone; clear the *entitlement*, not the preference | — |

In all four skip cases the **entitlement is still fully repaired**
(`access_briefings` + KV). Only *delivery* is left alone, and always visibly.

---

## The evidence

### For "provisioning state"

1. **Profile creation writes it `false` as a default, not a user choice.**
   `src/app/api/app/profile/route.ts:241` sets `briefings_enabled: false`
   **only inside `baseInsert`** (the row-creation payload) and **never in the
   update payload**. Saving your profile a thousand times never writes this
   field. The same false-default appears in `lib/mindy/free-profile.ts` and
   `cron/bootcamp-rollout`.

   ⚠️ This is an **application-level** default and it disagrees with the
   database. The schema
   (`src/lib/supabase/unified-notifications-schema.sql:50`) declares
   `briefings_enabled BOOLEAN DEFAULT TRUE`, and
   `lib/onboarding/ensure-notification-settings.ts` inserts it `true`. So the
   stored `false` on an affected account tells you which code path created the
   row — not what the user wanted. An earlier version of this document said the
   field "defaults to FALSE on profile creation" without that qualification,
   which reads as a property of the column and is not one.
2. **It gates delivery, and grant paths are expected to set it.**
   `precompute-briefings` and the weekly/pursuit precomputes all filter
   `.eq('briefings_enabled', true)`, so entitlement alone delivers nothing.
   `enableBriefingsDelivery()` exists precisely so that **grant** paths flip it,
   and `cron/watch-key-accounts` + `check-briefing-health` treat
   `access_briefings=true` with `briefings_enabled=false` as **drift to be
   repaired** — not as a preference to be respected.
3. **Every automatic provisioning path writes it true**:
   `lib/onboarding/ensure-notification-settings.ts`, `admin/mi-onboarding`,
   `admin/backfill-alerts`, `lib/mindy/apply-partner-referral`.

### For "user preference"

4. **TWO authenticated user-facing writers exist**, not one — the second was
   missed when this contract was first written, and it is the one that makes
   the field mixed-purpose rather than provisioning-with-an-exception:

   - **the UPDATE writer** — `src/app/api/alerts/preferences/route.ts:247`
     (`record.briefings_enabled = Boolean(briefingsEnabled)`), guarded by
     `if (briefingsEnabled !== undefined)` so it fires **only** when the caller
     explicitly supplied the field. A `false` written here is a real, deliberate
     user choice.
   - **the INSERT writer** — `src/app/api/alerts/preferences/route.ts:406`
     (`record.briefings_enabled = record.briefings_enabled ?? true`), on the
     row-creation branch of the same authenticated route. It defaults new rows
     to **TRUE**, and it also sets `record.is_active = record.is_active ?? true`
     (line 410).

   So the same authenticated endpoint both *creates* rows (defaulting delivery
   ON) and *records an explicit preference*. A stored value cannot be attributed
   to one or the other after the fact — which is precisely why the repair keys
   its decision on `is_active` rather than on `briefings_enabled` itself.
5. `src/lib/mcp/entitlements.ts` calls it "an EMAIL-DELIVERY PREFERENCE" and
   documents (2026-08-05) that 14 paying accounts held the entitlement with the
   flag false — **$7,202** of purchases — which is why *entitlement* checks must
   never be gated on it.

### Reconciling them

`src/lib/briefings/entitlement-gap.ts` states the model the codebase actually
operates on: `access_briefings` = the **entitlement**, `briefings_enabled` = the
**delivery preference**, `customer_classifications.briefings_access` = the **gate
the sender enforces**.

So the flag is a *delivery* switch that provisioning is expected to manage — but
a user who deliberately turned delivery off has expressed a real choice. Its
default is **not uniformly off**: the column defaults `TRUE`, the preferences
INSERT writer defaults `true`, and only the `app/profile` creation path defaults
`false`. Both purposes are live on the same column, which is what makes it
mixed-purpose rather than provisioning-with-an-exception.

Because the value alone cannot say which purpose wrote it, the contract keys on
a *different* column. The codebase already encodes exactly where that line falls:
`enableBriefingsDelivery()` **refuses to re-enable when `is_active = false`**,
treating that as an explicit opt-out an entitlement must not override. That is the
distinction this contract adopts, rather than inventing a new one — extended only
by making the NULL case explicit, which that function did not previously handle.

---

## What durable evidence separates an opt-out from an unprovisioned row

This is the load-bearing question, and the honest answer is: **`briefings_enabled`
alone cannot answer it.** The column stores a boolean, not a provenance. A stored
`false` could have come from

- `app/profile` row creation (`baseInsert`, a system default), or
- the authenticated preferences UPDATE writer, where the user genuinely turned
  delivery off, or
- a row created before a given backfill ran.

Nothing in the row records which. There is no `briefings_enabled_updated_at`, no
source column, and `updated_at` moves for any field on the row, so it cannot
attribute the change either.

**The durable evidence is therefore `is_active`, not `briefings_enabled`.**
`is_active` is written by exactly one user-facing path and only on explicit input:
`src/app/api/alerts/preferences/route.ts:281-282`

```ts
// Master switch
if (isActive !== undefined) {
  record.is_active = Boolean(isActive);
}
```

`isActive` is destructured from the request body (line 179), so
`is_active = false` can only have been produced by a caller who deliberately sent
it. Every provisioning path writes it `true`
(`ensure-notification-settings.ts:93,123`; preferences insert line 410). That is
what makes it a usable opt-out signal, and it is the signal
`enableBriefingsDelivery()` already honoured before this repair existed — the
contract adopts the codebase's own line rather than inventing one.

### The limit of this evidence — `is_active = false` is not *only* a user choice

`is_active = false` is genuinely reachable as a deliberate user action: the
"Paused" option in both settings surfaces
(`src/app/alerts/preferences/page.tsx:188` and
`src/components/briefings/SettingsPanel.tsx:228` — in both, the save handler's
`isActive: frequency !== 'paused'` field, reachable from the `'paused'` option
labelled *"Keep settings but pause emails"*) POSTs `isActive: false` to the
authenticated route above.

> Line numbers here are a convenience, not the evidence. Locate these by the
> `isActive: frequency !== 'paused'` expression in each file's save handler —
> ordinary edits above it shift the number without changing the behaviour the
> contract rests on. (The citation for the preferences surface read `:189`
> until 2026-09-05; that line is the closing `}),` of the POST body, and the
> field itself is on `:188`.)

But it is **not exclusively** that. `scripts/deactivate-bulk-enroll-rows.ts:194`
set `is_active = false` on **7,862 rows** in one administrative run on
2026-08-04 (its own header records the system-wide count falling 10,176 → 2,319).
So in production a stored `false` may mean *"this person paused their email"* or
*"an operator deactivated a never-engaged bulk-enrolled row."*

This does **not** change the repair's behaviour — preserving `false` is the safe
action under either reading, and that script deliberately excluded accounts with
commercial ties (its header calls out a live paying customer inside the
never-engaged set). But it bounds what the signal proves, and it has a real
consequence worth stating plainly: **a bulk-deactivated row that later becomes a
legitimate payer will be reported `opted_out` and left undelivered, and there is
no automatic repair path for that today.** The operator sees the skip reason and
decides; the repair does not decide for them.

## Fail-closed when the distinction is ambiguous

`is_active` is **nullable**: the schema declares
`is_active BOOLEAN DEFAULT TRUE` with **no `NOT NULL`**
(`unified-notifications-schema.sql:71`). A `NULL` is therefore a real state that
a row can hold, and in that state an explicit opt-out and an unprovisioned row
are **genuinely indistinguishable**.

The repair fails **closed**: it preserves the stored `briefings_enabled` value,
writes nothing, and reports `deliverySkipped: 'opt_out_unknown'`.

Two coercions were rejected, both of which look like ordinary null-handling:

| coercion | resolves NULL to | failure |
|---|---|---|
| `is_active !== false` | active | **fail-open** — mails someone who may have opted out |
| `is_active ?? false` | opted out | fail-closed but *lies* — strands a payer as a permanent opt-out |

Neither is knowledge. Both are the `count ?? 0` pattern in a different costume:
turning *unknown* into a definite value and destroying the only signal that
distinguishes them (Bug Prevention Rule #11, and the "no source ≠ zero" rule in
the silent-failure registry). The engine's dependency type therefore keeps
`is_active: boolean | null` — the third value must survive as far as the
decision, or the decision cannot be made honestly.

**Why closed is the right direction here, and why it is not symmetric.**
Wrongly enabling delivery emails a person who asked not to be emailed: a trust
and CAN-SPAM problem that is invisible to us and cannot be undone. Wrongly
skipping delivery produces a reported `opt_out_unknown` that an operator can see
and resolve. And the asymmetry is bounded, because **the entitlement is repaired
either way** — `access_briefings` and the KV key are both written. A customer in
this state is never left unpaid-for; they are left undelivered *and visibly so*.

A skip that nobody can see would itself be a silent failure, so every skip
reason is returned in the result, recorded in the audit metadata
(`delivery_skipped`), and logged by the admin grant path
(`admin/grant-briefings/route.ts`).

## Why the repair does not simply force the flag

Two failure modes, both already observed in this codebase:

- **Forcing it** would override a genuine opt-out — and `is_active = false` is the
  signal the existing code already honours.
- **Never touching it** would leave a repaired customer entitled but undelivered:
  the exact 2026-08-05 population (27 accounts, 14 of them paying).

The repair therefore enables *provisioning*, preserves *choice*, and reports which
of the two happened (`deliverySkipped: 'opted_out' | 'no_settings_row'`) instead of
silently doing nothing.

## A caveat worth keeping

Setting `briefings_enabled = true` **alone does not guarantee delivery.** The
sender also enforces `customer_classifications.briefings_access`. On 2026-08-14 a
monitor advised flipping the flag on 18 accounts; 17 were blocked at the
classification gate and the 18th had no targeting, so all 18 would have delivered
nothing. Repairing the entitlement is not the same as proving a briefing arrives —
do not report delivery as fixed on the strength of this flag.

## No regression to symmetric revocation

Delivery ambiguity must never leak into the entitlement decision. `is_active`
and `briefings_enabled` describe **delivery**; `access_briefings` + the KV key
describe **entitlement**. When the final qualifying subscription ends, both
entitlement sides are cleared together regardless of what the delivery row says
— an unknown or opted-out delivery state must not strand `access_briefings`
true. Equally, when one duplicate subscription ends while another qualifying one
survives, access is preserved on both sides.

This is asserted directly, including for the ambiguous case:
`does not regress symmetric revocation: a NULL is_active never blocks REVOKING
entitlement`.

## Tests

`tests/unit/entitlement-repair.test.ts` → `describe('briefings_enabled contract')`:

| test | binds |
|---|---|
| enables delivery when the account is merely unprovisioned | the provisioning half |
| PRESERVES an explicit opt-out (`is_active=false`) | the preference half |
| preserves an explicit opt-out even when delivery was already ON | no write in either direction |
| does not fabricate a settings row when none exists | `no_settings_row` |
| **FAILS CLOSED when `is_active` is NULL** | the ambiguity rule |
| an ambiguous row is preserved in the ON direction too | no write on unknown |
| reports `opt_out_unknown` distinctly from `opted_out` and `no_settings_row` | the three causes never collapse |
| DRY-RUN reports the ambiguity and writes nothing | dry-run honesty |
| a NULL `is_active` never blocks REVOKING entitlement | symmetric revocation |

Verified by injection: reverting the engine to the old fail-open behaviour
(`is_active !== false` at the adapter, no `opt_out_unknown` branch) turns **four**
of these red; restoring it returns 30/30 green. A test that cannot fail proves
nothing, so the failure was observed, not assumed.
