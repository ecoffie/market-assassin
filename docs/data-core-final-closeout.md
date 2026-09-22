# Data Core — final closeout

**Date:** 2026-09-21 · Measured against live production. Integrity work **stops here**.

---

## 1. What shipped and is verified live

| PR | Change | Merge SHA | Verified |
|---|---|---|---|
| **#1579** | strategic-claim provenance boundary | `735a6dd0` | `fundingAmount` null on the public path · `claimProvenance` emitted |
| **#1582** | Decision Makers identity/role views | `d4496632` | 17,605 person · 5,414 unknown · 182 role_mailbox |
| **#1583** | specialty-source advancement + registration | `a425aa57` | 6 instances · per-source clocks live |
| **#1584** | reconciliation record | `1119cac4` | docs |
| **#1585** | `sam_opportunities` registration | `b059d075` | 215,066 rows · 34,684 active · `current` |
| **#1586** | GAO attribution evidence view | `f7cfb5b5` | 148 / 64 / 211 / 22 |
| **#1590** | **Option C quarantine** | `c744ace2` | **212 rows unreachable from agency reads · base 445 intact** |
| **#1591** | **park DARPA + NSF** | `ef6d0bbb` | both crons disabled · **NIH still enabled** · 6 DARPA rows preserved |
| **#1593** | long-job completion reporting | `f59e9fd6` | 4 routes wired |
| **#1595** | **remove inline cron credential** | `221a7f5e` | 3 routes stripped · **NIH authenticates 200 via dispatcher bearer, 401 without** |
| **#1596** | **legislation PARKED** | `fb1674e0` | `upstream_quiet` / `blocked` / `credential_renewal` · 29 rows intact |

Plus migration fixes #1587, #1588. **All 7 migrations applied; ledger clean, nothing pending.**

---

## 2. Control plane — 23 instances

| Dataset | Instances | current | quiet | stale | unreachable | unmeasured | blocked |
|---|---:|---:|---:|---:|---:|---:|---:|
| `forecast_intelligence` | 12 | 5 | 0 | 2 | 3 | 2 | 0 |
| `research_multisite` | 4 | 0 | 0 | 2 | 1 | 1 | **2** |
| `decision_makers` | 2 | 1 | 0 | 0 | 0 | 1 | 0 |
| `strategic_intelligence` | 2 | 1 | **1** | 0 | 0 | 0 | **1** |
| `sam_opportunities` · `dibbs_rfqs` · `grants_gov` | 3 | 3 | 0 | 0 | 0 | 0 | 0 |

---

## 3. OPERATIONAL INTEGRITY — the closeout question

| Domain | Status |
|---|---|
| Forecast | **OPERATIONALLY SET** — 7 sources need a human, all truthfully registered |
| Decision Makers | **OPERATIONALLY SET** — traversal complete; vendor identity blocked and marked |
| `sam_opportunities` | **OPERATIONALLY SET** |
| DIBBS | **OPERATIONALLY SET** — advancing, 13% job error rate monitored |
| Grants | **OPERATIONALLY SET** |
| Institute — GAO live | **OPERATIONALLY SET** — 25/25 feed items held |
| Institute — historical GAO | **OPERATIONALLY SET** — 212 unsupported rows quarantined from agency reads |
| Research / Lab | **OPERATIONALLY SET** — no false-green producer running |
| Institute — legislation | **PARKED / BLOCKED_CONTROLLED** — blocked on `CONGRESS_API_KEY`, reaches no surface |
| SBIR | **OPERATIONALLY SET as represented** |

**No known silent fabricated claim. No known false-green producer still running.**

Every remaining gap is **registered, truthfully stated, and misleading nobody.**

---

## 4. 🔑 The one thing NOT done — credential rotation

Step 3 of the closeout was "rotate `ADMIN_PASSWORD` + update govcon-funnels consumers."
**I did not execute it, for two evidenced reasons.**

### 4a. The premise does not hold — these are TWO different secrets

| Exposure | Secret | Owner | Status |
|---|---|---|---|
| 3 × `snapshot-multisite` routes | **`ADMIN_PASSWORD`** | market-assassin | **stripped** (#1595) |
| 5 × `mindy-*` routes | **`PURCHASES_ADMIN_PASSWORD`** | **govcon-funnels** | still inline |

`govcon-funnels/src/lib/admin-auth.ts` resolves
`PURCHASES_ADMIN_PASSWORD || ADMIN_PASSWORD`, and its production environment has
**`PURCHASES_ADMIN_PASSWORD` and no `ADMIN_PASSWORD`**. So the five cross-app
routes carry a *govcon-funnels* credential.

**Rotating market-assassin's `ADMIN_PASSWORD` would not have addressed them.**

### 4b. A rotation cannot be safely completed inside an agent transcript

Whatever new value is generated must reach the operator. Printing it re-exposes
it in exactly the medium that leaked the last one; not printing it leaves a
secret nobody can use. **Rotation is an operator action, not an agent action.**

### The rotation runbook

**A — market-assassin `ADMIN_PASSWORD`** (exposed in the DB column, dispatcher
logs, and the audit transcript):
1. Generate a new value locally (do not paste it into any transcript).
2. `vercel env rm ADMIN_PASSWORD production` → `vercel env add ADMIN_PASSWORD production` — use `printf`, **never `echo`** (a trailing `\n` breaks fixed-length compares).
3. Redeploy — an env var binds only on a build *after* the change.
4. Re-check an admin endpoint: `curl ".../api/admin/platform-health?password=<new>"`.
5. **227 files** reference `ADMIN_PASSWORD`; the 3 stripped cron routes no longer need it.

**B — govcon-funnels `PURCHASES_ADMIN_PASSWORD`** (exposed in 5 `cron_jobs.route` values):
1. Rotate it in the govcon-funnels project, redeploy.
2. **Better: drop `?password=` from those 5 routes entirely.** Its route already
   accepts `Authorization: Bearer <CRON_SECRET>` — the mechanism the dispatcher
   already sends. This requires confirming the two projects share `CRON_SECRET`
   (both have one configured; values not compared, to avoid handling secrets).
3. Then delete the 5 entries from `tests/fixtures/cron-route-credential-baseline.json`
   and the gate goes clean at zero exceptions.

---

## 5. FUTURE PRODUCT EXPANSION — not integrity debt

Known, truthfully represented, controlled, misleading nobody:

| Item | State |
|---|---|
| SBIR coverage (1 of ~11 agencies) | registered; 42 rows accurate |
| Army-proper / Air Force forecasts | absent, not faked; Air Force awaits FCO |
| Manual Gateway slices | `content_stale` + `required` |
| Priority source recovery (2,500 claims) | typed `LEGACY_MANUAL`, dollar-sanitized |
| Vendor person identity (82,017) | `unmeasured`; no email exists, so no key is possible |
| Legislation beyond NDAA | scope stated, not implied |
| DARPA / NSF recovery | **parked, not retired**; registrations and rows preserved |

---

## 6. Remaining integrity debt (carried, not resolved)

1. **Credential rotation A + B** — §4. The only item that touches a live secret.
2. **212 GAO rows remain mis-attributed in the record** — unreachable from agency
   reads, but not corrected. Correction is a separate destructive decision.
3. **5 cross-app routes still carry an inline credential** — fixable only in govcon-funnels.
4. **~8 long jobs still unconfirmed** (`sync-recompete-contracts` 719 runs,
   `backfill-recipient-certs` 709, `enrich-recompete-detail` 709, …). #1593 wires
   four; the same one-line change extends to the rest.
5. **DIBBS 13% job error rate** — advancing, so monitored rather than repaired.
6. **Both integrity gates key on `path:line`**, so any insertion manufactures a
   false NEW finding — it happened twice in batch 2. Keying on a content hash
   would remove a recurring push toward reflexive re-baselining.

---

## 7. Stop condition

Data Core **integrity** work stops here. What remains is either an operator
action (§4), a product decision (§5), or bounded debt that is registered and
visible (§6). Nothing on those lists is a silent or misleading claim.
