# DLA DIBBS — Apify residential proxy spike (2026-10-10)

Follow-up to `tasks/apify-cost-audit-2026-10-10.md`. **Nonproduction.** I made no writes to any
table, didn't touch the 08:00 UTC cron, didn't disable the actor, didn't change the plan or cap, and
didn't print any credential (the proxy password was read from the Apify API at runtime, in memory
only). The spike script was throwaway and has been removed from the repo (copy in session scratchpad).

## Verdict: **BUILD**, with the existing actor kept as fallback

| | |
|---|---|
| Direct fetch (no proxy, this Mac's residential IP) | ✅ 200, `text/plain`, 448,294 B, 3,157 rows. **But this is not Vercel:** from Vercel's egress the same path is firewall-blocked about 75% of days (audit: 8 of 33 days succeeded). |
| **Proxy fetch** (Apify RESIDENTIAL, US, new session each run) | ✅ **6/6 succeeded**, 6 different US residential exit IPs, 0 firewall blocks |
| **Complete file retrieved** | **YES.** Byte-identical to the direct download (`cmp`). Every line is exactly 140 chars, and line count equals rows parsed. |
| Rows parsed (Oct 7 file) | **3,157** |
| Unique RFQs (Oct 7 file) | **3,015** (actor: 2,389, because it stopped at 2,500 rows) |
| Comparison vs. actor | Exact match on uncapped files. On the capped file, the proxy has every RFQ the actor has **plus 626** it cut off. |
| Actual proxy cost | **$0.02753** for all 6 proxy fetches, as metered by Apify: 0.00367 GB × $7.50/GB, about $0.005 per daily file |
| Full file beyond the 2,500 cap? | **YES.** The 2,500 cap is the actor's billing knob, not a property of the file. We download the whole file and parse every line. |
| Estimated monthly proxy cost | **~$0.15–$0.50/mo** (26 files/mo × ~$0.005, with headroom for retries) |

## Method

1. **The exact request** (`src/lib/dibbs/direct.ts`, same code on `main`):
   `GET https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in<YYMMDD>.txt`.
   Puppeteer loads it, gets the DoD consent page, clicks `input[name=butAgree]`, then calls
   `fetch()` inside the page so the F5 firewall cookies are sent. Parsing uses the production
   `parseIndexFile` (fixed-width, 140-char records).
2. Spike = the same steps in a standalone script, with an optional `--proxy-server=http://proxy.apify.com:8000`
   and `page.authenticate({ username: 'groups-RESIDENTIAL,country-US,session-<tag>' })`.
   Images, fonts and CSS were blocked to save proxy bytes. Wire bytes were counted through Chrome DevTools, and the exit IP checked through ipify.
3. Bounded: 1 direct + 6 proxy fetches, run **one at a time** (~70 s each, ~8 min total),
   plus 2 free direct probes for missing dates. No bursts.

## Results

| Run | Path | File (source date) | Exit IP | HTTP | Content-Type | Bytes | Rows | 140-char lines | Unique RFQs | Firewall-blocked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | direct | in261007 (Wed 10-07) | Mac | 200 | text/plain | 448,294 | 3,157 | 3,157 | 3,015 | no |
| 2 | proxy `a` | in261007 | (resid.) | 200 | text/plain | 448,294 | 3,157 | 3,157 | 3,015 | no, **byte-identical to run 1** |
| 3 | proxy `b` | in261004 (**Sun** 10-04) | 108.16.221.81 | 200 | text/plain | 201,072 | 1,416 | 1,416 | 951 | no |
| 4 | proxy `c` | in261006 (Tue) | 99.115.64.48 | 200 | text/plain | 354,006 | 2,493 | 2,493 | 2,347 | no |
| 5 | proxy `d` | in261008 (Thu) | 172.56.166.196 | 200 | text/plain | 251,198 | 1,769 | 1,769 | 1,597 | no |
| 6 | proxy `e` | in261009 (Fri) | 172.56.64.31 | 200 | text/plain | 45,298 | 319 | 319 | 300 | no |
| 7 | proxy `f` | in261007 (repeat) | 75.65.132.92 | 200 | text/plain | 448,294 | 3,157 | 3,157 | 3,015 | no |
| 8 | direct | in261003 (**Sat**) | Mac | 200 | **text/html** | 9,152 | 0 | — | — | HTML (no file published) |
| 9 | direct | in261010 (Sat, today) | Mac | 200 | **text/html** | 4,900 | 0 | — | — | HTML (not published yet) |

**Comparison with the actor for the same source date** (actor dataset from the run the next
morning; IDs compared with dashes stripped, see failure mode F3):

| File | Actor rows billed | Actor unique | Proxy unique | In both | Actor only | Proxy only |
|---|---|---|---|---|---|---|
| in261004 | 1,416 ($20.31) | 951 | 951 | 951 | **0** | 0 |
| in261006 | 2,493 ($35.75) | 2,347 | 2,347 | 2,347 | **0** | 0 |
| in261007 | 2,500 ($35.85, **capped**) | 2,389 | 3,015 | 2,389 | **0** | **+626** |

So the proxy fetch is **never worse than the actor** and is **strictly more complete** on busy
days. For in261007 the actor billed $35.85 and missed 21% of the day's RFQs. The same file cost $0.005 through the proxy.

**Timing:** firewall navigation 1.7–3.0 s; consent step **60.1 s on every run** (F1); file fetch 1.0–3.3 s.

## Failure modes found

| # | Failure mode | Severity | Already in prod? | Fix in the build |
|---|---|---|---|---|
| F1 | **The consent click waits the full 60 s.** `page.waitForNavigation({timeout:60_000})` never fires because the consent page doesn't navigate the way it expects; the `.catch(()=>{})` swallows the timeout. Every run burns 60 s of the route's 120 s `maxDuration`. | High (half the time budget) | **Yes** | Wait for the firewall cookie or a short `waitForResponse` (~10 s cap). Expected run time ~70 s → ~10 s. |
| F2 | **Sunday files are skipped.** `isBusinessDay()` excludes Sat+Sun, but DLA publishes **Sun–Fri** (in261004 = Sunday, 1,416 rows; the actor ingested Sunday files 09-13, 09-27, 10-04). Saturday has no file. | Medium (coverage) | **Yes**, on days the direct path wins | Calendar = Sun–Fri. |
| F3 | **IDs ending in a letter aren't given dashes.** `formatSolicitationNumber` requires 4 trailing **digits**, so `SPE2DS26T213Q` stays undashed while the actor stores `SPE2DS-26-T-213Q`. That's 118–145 per file, about 5%. **Prod already has 13,011 undashed rows; in a 1,000-row sample, 110 also exist dashed** (the same RFQ stored twice). | Medium (duplicates, split records) | **Yes** | Regex suffix `\d{4}` → `[A-Z0-9]{4}`; verified to produce the actor's shape. Cleaning existing rows is a **separate, approved** data write (not part of this). |
| F4 | **A missing file looks the same as a firewall block.** Both return HTTP 200 + HTML (Saturday = 9,152 B, unpublished today = 4,900 B). | Medium (alarm accuracy) | Yes | Same session: if file X returns HTML but a known-good previous file returns data, X = "not published", not "blocked". |
| F5 | Direct-path rows have no `buyerCode` or `scrapedAt` (the actor reads extra columns). | Low | Yes | Parse the buyer code from the unparsed columns 26–62 if present; out of scope for cost. |
| F6 | **Not yet tested from Vercel:** serverless Chromium (`@sparticuz/chromium`) with `--proxy-server` + `page.authenticate`. Proxy egress doesn't depend on where Chrome runs, so the firewall result should carry over, but the Chromium/auth wiring needs a preview-deploy check. | Unknown → must verify | n/a | A dry-run route on a preview deploy (no upsert) before the flag goes on. |
| F7 | Small sample: 6 proxy fetches, one afternoon. Firewall behaviour over weeks is unknown, and a residential IP could be flagged. | Medium | n/a | New session per attempt, ≤2 proxy attempts, and the **actor stays as fallback**. |

## Estimated monthly cost after the build

| Item | $/mo |
|---|---|
| Residential proxy (~26 files × ~0.6 MB metered, ×2 for retries) | ~$0.15–$0.50 |
| Actor fallback (only on days both free paths fail; expected ~0–2 days) | ~$0–$70 |
| Apify plan | $199 (Scale) now → **$39 Starter** after one clean cycle (separate decision; check Starter allows residential proxy + its usage cap) |
| **Expected total** | **~$40–$110/mo** vs ~$416 today |

## Proposed feature-flagged implementation (not built; awaiting approval)

**Flag:** `DIBBS_PROXY_MODE` = `off` (default, today's behaviour) | `primary`.

**Credential:** no new secret is needed. `APIFY_TOKEN` is already in prod, and the proxy password
can be read at runtime from `GET /v2/users/me` (`data.proxy.password`), cached in memory and never
logged. If you'd rather keep a separate secret, you'd create `APIFY_PROXY_PASSWORD` yourself
(`printf '…' | vercel env add`); I won't handle the value.

**Order when `primary`** (in `ingestDibbs`):
1. `proxy`: `fetchDibbsDirect({ proxy: true })`. Fresh residential session; one retry with a new session. Free.
2. `direct`: today's direct fetch from Vercel egress. Free.
3. `apify`: **existing actor, unchanged**, only if both free paths produced nothing. Same 2,500 cap and build pin.

**Changes:**
- `direct.ts`: `launchBrowser({ proxy })` adds `--proxy-server` and `page.authenticate`. Fix F1 (consent wait), F2 (Sun–Fri), F3 (ID regex), F4 (known-good file check). No 2,500 cap on the free paths (cap ~10,000 as a sanity limit only).
- `ingest.ts`: new `DibbsPath = 'proxy'`. `attempts[]` records it (execution truth). Log proxy bytes.
- `sync-dibbs` route: `?dryRun=1` (fetch + parse + report, **no upsert**) for the preview check. The cron row stays as it is.
- Unit tests: parser regex (letter-suffix IDs), Sun–Fri calendar, path ordering with the flag on and off, and "missing vs. blocked".

**Rollout:**
1. PR → preview deploy → `GET …/sync-dibbs?dryRun=1` with the flag on in **Preview env only** → must show `proxy:rows(~N)` and full row counts.
2. Merge with the flag `off` (no behaviour change).
3. Set `DIBBS_PROXY_MODE=primary` in prod and redeploy. Over the next 7 runs, watch `cron_job_runs` (`path: proxy:rows`) and Apify `PAID_ACTORS_PER_EVENT` (should stay flat), and check `dibbs_rfqs` row growth is ≥ before.
4. **Rollback:** set the flag to `off` and redeploy. The actor path is untouched throughout.
5. After one clean billing cycle → decide on the Starter downgrade (separate approval).

**Not included, needs separate approval:** deduping the 13,011 undashed prod rows (F3 cleanup), and the plan downgrade.
