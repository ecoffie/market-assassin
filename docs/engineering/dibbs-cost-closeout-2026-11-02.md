# DIBBS — Apify cost closeout (2026-11-02)

**Status:** DIBBS feed **PARKED**. `cron_jobs.sync-dibbs` disabled 2026-11-02 14:01 UTC
(`enabled=false`, note records why). Not to be re-enabled without a free, authorized source.

**Rule this produced (now a permanent engineering constraint):**

> **A free source that fails STOPS and REPORTS. It never silently spends money.**
> A paid path runs only on an explicit, per-call opt-in, and a live/scheduled path can never
> opt in. A routing rule is not a budget.

---

## 1. Cost exposure (Apify `GET /v2/users/me/usage/monthly`, read-only)

| Billing cycle | Usage | Note |
|---|---|---|
| Jun 8 – Jul 7 | $0.68 | pilot |
| Jul 8 – Aug 7 | **$500.00** | at cap |
| Aug 8 – Sep 7 | **$321.96** | |
| Sep 8 – Oct 7 | **$415.81** | |
| Oct 8 – Nov 7 | **$299.99** | at the $300 cap since Oct 29 |
| **Total usage** | **≈ $1,538** | ~100% `PAID_ACTORS_PER_EVENT` (the DIBBS actor) |

Plus the subscription: the account is on **SCALE ($199/mo base)** today. Earlier-cycle plan tiers
are not readable from the usage endpoint; check the Apify invoices for the exact fee history.
Daily runs in the Oct cycle billed **$12–$36 each** (actor `parseforge~dibbs-rfq-scraper`).

## 2. Why the "minimal cost" estimate was wrong

- **The "$4/month / $0.12 per run" figure was the VENDOR's cost, not ours.** It came from the
  actor author's own scheduled run (`src/lib/dibbs/direct.ts` header). We pay the actor's
  **PAY_PER_EVENT price: ~$0.0143 per result item** (measured: 2,500 → $35.85, 228 → $3.27).
- **Volume makes the bill structural, not accidental.** DLA posts ~400–800 RFQs per weekday and the
  actor returns ~22% duplicates. Even a lean daily delta is ~$7–$12/day ≈ **$200–$300/month in usage
  alone**, before the plan fee. Hitting the cap every cycle was the expected outcome, not bad luck.

## 3. Why the cost guard did not limit cost

The "cost guard" (#793) routed requests over 800 items to the free direct fetcher, then:

```
direct failed → "cost control must never become data loss" → re-run the SAME 2,500-item request on the actor
```

From Vercel egress the DLA F5 WAF serves the DoD consent page for every archive URL (verified
2026-08-24, #1343), so the direct path failed on **every** run in ~7s and the actor ran every day.
The guard had no dollar limit of its own; the only real limit was the vendor's monthly cap, which it
hit four cycles in a row. Requests **under** 800 items went to the actor as the *primary* path.

The proxy chain (`DIBBS_PROXY_MODE=primary`, never enabled in prod) had the same final step:
"unresolved after proxy+direct → the existing actor still runs (data loss is worse than $)".

## 4. Why monitoring did not catch it

1. **Every alert was built for DATA loss, none for SPEND.** `starved`/`truncated` fire when too few
   rows arrive. Expensive runs delivered rows, so they were "healthy" by every check.
2. **Cost was computed and thrown away.** `estimatedCostUsd` and an `EXPENSIVE RUN` warning existed
   but only went to a Vercel function log. Nothing persisted, summed or alerted on them.
3. **The cron history reads as success.** The dispatcher stops waiting after ~12s, so most
   `cron_job_runs` rows are `status=success, http_status=null` regardless of what happened.
4. **The one hard stop was the vendor's.** The $300 Apify cap stopped spend only after it was spent.

## 5. What changed (this PR)

- `ingestDibbs` (`src/lib/dibbs/ingest.ts`): direct fetcher always first; if it produces nothing the
  run **stops** and records `apify:skipped` with `fail-closed` in `attempts[]`. The actor runs only
  with `allowApify: true`. `forceApify` is ignored without it. The <800-item "actor first" path and
  the `APIFY_MAX_ITEMS_BEFORE_DIRECT` threshold are removed.
- Proxy chain: the final actor step now also requires `allowApify` (dry run or live).
- `sync-dibbs` route: the LIVE call passes neither flag (pinned by a unit test). Paid actor is only
  reachable from `?dryRun=1&allowApify=1`. The `APIFY_TOKEN` 503 gate is removed (the free path does
  not need it). The ops alert now says **"FAILED CLOSED — nothing spent"** when the actor was skipped,
  and a skipped attempt no longer counts as "Apify was reached".
- Tests: the old invariant "DATA LOSS IS WORSE THAN COST" is replaced by fail-closed tests; a
  paid-by-default regression turns 3 tests red (proven, then reverted).

**Still able to spend (explicit, manual only):** `scripts/dibbs-full-current-drain.ts` and
`scripts/test-dibbs-pilot.ts` call the actor directly with an inline `APIFY_TOKEN`; the drain script
has its own pre-run budget check. Once the Apify plan is cancelled and the token revoked, these stop.

## 6. Authorized low-cost DLA access options (evaluation only — nothing built or bought)

| Option | Cost | Authorized? | Fit |
|---|---|---|---|
| **Ask DLA** (dibbsbsm@dla.mil) for a sanctioned bulk path or allowlisting for the public daily RFQ files | $0 | Yes, by definition | Best first step; slow, may be declined |
| **Run the existing direct fetcher from a US non-datacenter machine we control** (scheduled job, pushes files to `dibbs_rfqs`) | ~$0 | Public data, behind the standard DoD consent banner; confirm with DLA before automating | Proven to work from a residential IP (2026-08-02); one machine = single point of failure |
| **SAM.gov** (DLA buys above the posting threshold are synopsized there; already in `sam_opportunities`) | $0 | Yes | Partial: misses the sub-threshold small buys that make DIBBS distinct |
| **Licensed commercial feed** (e.g. HigherGov / CLEATUS DIBBS API) | flat subscription | Yes (vendor-licensed) | Predictable flat price; still a vendor dependency |
| **EDI 840 via an approved VAN** (Mil-Pac, ALI) | VAN fees | Yes, for registered vendors (CAGE + trading-partner agreement) | Built for quoting suppliers, not aggregators; poor fit |

Recommendation: ask DLA first; do not adopt any per-item metered source again.

Sources: [DLA EDI 840 / EProcurement notice](https://www.dla.mil/Portals/104/Documents/InformationOperations/EBS%20Supplier%20Information/EDI%20840%20Functionality%20Changes%20for%20EProcurement%20Solicitations.docx) ·
[DLA: Accessing DIBBS](https://www.dla.mil/Portals/104/Documents/SmallBusiness/Accessing%20the%20DLA%20Internet%20Bid%20Board%20(DIBBS)%20and%20the%20Collaboration%20Folders%20(cFolders)%20(003).pdf) ·
[DIBBS training deck](https://business.utah.gov/wp-content/uploads/dibbs-training-012424.pdf) ·
[HigherGov DIBBS](https://www.highergov.com/alt/dibbs/) ·
[Mil-Pac VAN](https://milpac.com/?p=232)
