# Decision Maker identity — runbook (Workstream B)

**Added:** 2026-09-20 · Migration `20260920_decision_maker_identity.sql` ·
Reader `src/lib/decision-makers/identity.ts`

## Gate: was traversal mature enough to build this?

**Yes — proven, not assumed.**

`decision_makers_sync_state.backfill.pass_completed_at = 2026-09-20T22:00:28Z`
after scanning **214,113 notices**. The hours of zero inserts before that are the
correct post-completion steady state, not a stall — the `refresh` lane reports
293,567 unchanged.

⚠️ The job row alone could not have told us this: every `sync-decision-makers`
run records `status='dispatched'`, `http_status=NULL` and never resolves. The
cursor is the oracle.

## The three concepts

| | What it is | Where |
|---|---|---|
| **Observation** | one POC slot on one notice | `federal_contacts` — **untouched** |
| **Identity** | a person, keyed on normalized email | `decision_maker_identities` (view) |
| **Role** | where an identity acts | `decision_maker_roles` (view) |

Views, not tables: no backfill, no data mutation, droppable with zero loss.

## Measured state (production, 2026-09-20)

| identity_kind | identities | observations |
|---|---|---|
| `person` | **17,605** | 161,395 |
| `unknown` | **5,414 (23%)** | 48,651 |
| `role_mailbox` | 182 | 2,366 |
| **total** | **23,201** | 212,415 |

## Why email, and why not name

212,415 observations resolve to 23,201 addresses (~9.2 per person). Email is the
only stable source-native handle.

**Name is not a key.** Real stored values:
- `Telephone: 7176053992`
- `Natalya RadykDSN312-850-4033`
- an entire paragraph of DIBBS filing instructions

Matching on those would merge strangers and split individuals.

## Why volume is not evidence

The busiest address, `natalya.radyk@dla.mil`, has **3,807 observations and is a
real person** — a DLA contracting officer. A volume-based classifier would have
deleted her. Classification reads **address shape only**.

Verified anchors: `mrr-procurement@uscg.mil`, `dla-kme-quotations@dla.mil`,
`usarmy.jbsa.acc-micc.mbx.tsc-div1@army.mil`, `d05-smb-lrs-procurement@uscg.mil`
→ `role_mailbox`. `natalya.radyk@dla.mil`, `zachary.r.morrill.civ@us.navy.mil`
→ `person`. **No role mailbox is classified as a person.**

## Why 23% is `unknown` and stays that way

`stephen.1.weaver@dla.mil` (a real person, digit-infix shape) and
`dibbsbsm@dla.mil` (a role mailbox, no shape signal) both land in `unknown`.
Neither is promoted. The safety property that matters is the one that holds: a
role mailbox is never called a person.

## Vendor POCs are out of scope, deliberately

All **82,017** `vendor_entity_poc` rows have **no email** (measured: 0). They
cannot use this key at all and use `<uei>::<slot>`. An identity layer that
silently produced zero vendor identities would look complete while covering
nothing, so they are excluded explicitly.

## The 79.8% is NOT coverage debt

`held_population / upstream_population` = 212,415 / 266,113 = **79.8%**, and it
will read that forever, because `decision_makers_upstream_slots()` counts every
POC slot **including the ones the drain's quality filter deliberately rejects**.

Measured: of **53,698** unheld slots, **45,924 (85.5%)** are the single DIBBS
role mailbox `dibbsbsm@dla.mil`. All 53,698 resolve to just **501 distinct
addresses**, of which **396 are already held** from other notices. Only **105
addresses** are absent from the corpus entirely — and those are dominated by role
mailboxes plus Navy contacts whose name field is literally a phone number.

**Person-level coverage is therefore ~99.5%, not 79.8%.**

`decision_makers_slot_coverage()` reports the split. **The existing metric is NOT
redefined** — changing a control-plane denominator has two defensible answers
(redefine it to what the pipeline targets, or keep it and document the gap) and
that is Eric's call, not a silent migration.

## Post-merge runbook

1. Apply the migration:
   `npm run migrate` (dry-run) → `npm run migrate -- --go`
2. Verify the objects exist through **PostgREST**, not just psql:
   `npm run db:check -- decision_maker_identities identity_kind`
   `npm run db:check -- decision_maker_roles identity_email`
3. Reconcile the identity count against observations:
   `npm run db -- decision_maker_identities --count` → expect ~23,201
4. Spot-check the two anchors:
   `npm run db -- decision_maker_identities --eq identity_email=natalya.radyk@dla.mil --select identity_kind,observation_count`
   → `person`, ~3,807
   `npm run db -- decision_maker_identities --eq identity_email=mrr-procurement@uscg.mil --select identity_kind`
   → `role_mailbox`
5. `select * from decision_makers_slot_coverage();` → unheld ≈ 53,698 over ≈ 501 addresses.

**No data mutation. No backfill. Rollback is `DROP VIEW` / `DROP FUNCTION`.**

## Known limitations

- 23% `unknown` is real ambiguity, not a bug to tune away. Narrowing it needs
  evidence (an agency directory), not a looser regex.
- `dibbsbsm@dla.mil` is a role mailbox that classifies `unknown`. Safe (not a
  person) but not precise.
- Vendor identity is unsolved and needs a different key.
- Nothing consumes these views yet — this is the substrate, not a surface.
