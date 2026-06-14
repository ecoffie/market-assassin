# EDC / MBDA Partnerships — Execution Runbook

**Status:** ACTIVE — Eric executing (FT hire + advisors recruiting in parallel)  
**Start:** June 14, 2026  
**PRD:** `PRD-edc-mbda-partnerships.md`  
**Research:** `landscape-research-phase2.md` (living doc)

---

## This week's focus (Jun 14–20)

| # | Action | Time | Done |
|---|--------|------|------|
| 1 | **Send PGC EDC outreach** — Kimberlee Andrews (`kbandrews@co.pg.md.us`) | 30 min | [ ] |
| 2 | **Post FT hire JD** — LinkedIn + GovCon Slack groups | 30 min | [ ] |
| 3 | **Post 3 advisor role briefs** — `advisor-recruitment-brief.md` | 45 min | [ ] |
| 4 | **Complete EDC top-10 rows** in `landscape-research-phase2.md` (GA, TX, FL, VA, CA) | 2 hr | [x] — 10 verified rows, all priority states; APEX-overlap flagged |
| 5 | **Draft PGC EDC one-pager proposal** (adapt USHCC HTML → EDC cohort angle) | 2 hr | [ ] |
| 6 | **Grant NOFO tracker** — seed 5 rows in `grant-nofo-tracker.md` | 1 hr | [x] — 7 verified rows. ★ DoD SBIR 26.3 (Jun 24–Jul 22) + MBDA Rural Business Ctr (closes Jun 29) |
| 7 | **★ Book NAPEX booth** (Aug 16–20, Orlando — $1,500 govt exhibitor, first-come) — email headquarters@napex.us for deadline + apply | 30 min | [ ] |
| 8 | **Request ASBDC prospectus** (Sept 29–Oct 1, Atlanta) — booth $ + deadline (nationaltraining.americassbdc.org) | 15 min | [ ] |
| 9 | **Confirm NMSDC exhibit eligibility** (Oct 25–28, LA) — email events@nmsdc.org BEFORE budgeting (gated to certified MBE/member/gov) | 15 min | [ ] |

**Events note:** Booths put you in the room with every buyer at once (§8 of research doc). NAPEX = cheapest + most on-target (APEX directors) + before year-end → highest-ROI action in the whole plan. MED Week is DEAD (don't budget). Oct 25–28 = NMSDC (LA) vs IEDC (New Orleans) date collision — pick one.

**Do not wait for FT hire** to start PGC outreach or advisor posts. Hire closes; Eric opens.

---

## Pipeline tracker

| Stage | Org | Contact | Next step | Target close |
|-------|-----|---------|-----------|--------------|
| **Outreach** | PGC EDC (MD) | Kimberlee Andrews — kbandrews@co.pg.md.us, 301-583-4609 | Send email (`outreach-templates.md` §1) | Eval by Jul 15 |
| **Research** | GA MBDA center (closed) → **GA Dept of Economic Development** | TBD — Phase 2 research | State operator path | Q3 |
| **Research** | NC HUB Office (MBDA coop terminated; HUB open) | ncmbda@doa.nc.gov | State minority division pitch | Q3 |
| **Research** | NMSDC — **CRMSDC** (Sharon Pinder, 301-593-5860) runs a 12-wk GovCon Incubator; **GMSDC** (Stacey Key, 404-589-4929) | Minority-business advisor warm intro | Enterprise + member alerts; ex-MBDA councils (CRMSDC/FSMSDC/DFW) = MBEs lost fed support | Post-NAPEX |
| **Parallel** | APEX Illinois | See `projects/apex-sbdc-funding-strategy/` | CTA demo + re-warm | Pre-NAPEX |
| **Parallel** | USHCC Atlanta | See `tasks/USHCC-Atlanta-pilot-runbook.md` | Close chamber pilot | Jul |

---

## P1 target: Prince George's County EDC

**Why first:** Active Procurement 360 series (bi-monthly, 100+ at kickoff Jul 2025), federal + DoD panel themes, MBE focus, MD = dense GovCon market.

**Program lead:** Kimberlee Andrews — Business Development Manager, Government Sector  
**Email:** kbandrews@co.pg.md.us | **Phone:** 301-583-4609  
**Program:** [pgcedc.com/procurement360](https://www.pgcedc.com/procurement360)  
**Next event:** Feb 10, 2026 (series ongoing)

**Pitch angle (EDC-specific, not chamber $18K):**

> Procurement 360 gets businesses in the room with buyers. Mindy is what happens **after** — daily federal opportunity briefings, 317K prime/teaming search, DoD Critical Tech Area filters, and a coach dashboard that rolls up who pursued what so PGCEDC can report contract outcomes to county funders.

**Offer:** 60-day director eval (free) → **EDC Cohort Standard $50K/yr** (30 member seats + quarterly outcome report). Optional **Cohort Plus $75K–$100K** if they want GovCon Giants bootcamp delivery bundled.

**After yes on eval:**

1. Replace `{{DIRECTOR_EMAIL}}` in `scripts/provision-edc-pilot-org.sql`
2. Run in Supabase SQL editor
3. Director signs up at getmindy.ai/app if needed
4. Add first Procurement 360 cohort firm under My Clients

---

## Advisor recruitment (3 roles — replaces Ryan/Zach/Randie)

See `advisor-recruitment-brief.md` for LinkedIn post copy.

| Role | First ask | Comp (draft) |
|------|-----------|--------------|
| APEX partnership advisor | 3 warm APEX director intros before NAPEX | $500/qualified intro + 5% Y1 license |
| SBDC & chamber advisor | 2 cohort pilot intros | Same |
| Minority-business advisor | 2 NMSDC or state HUB intros | Same |

**Eric approves comp structure** before any advisor signs.

---

## Product demo checklist (EDC/MBDA calls)

Walk this order — 15 minutes max:

1. **Coach Mode** — director dashboard, client switcher
2. **Capability paste → profile seed** — NAICS, keywords, target agencies
3. **Source Feed + CTA chips** — "35% mandate alignment"
4. **Contractor search** — prime by NAICS + set-aside + state (317K)
5. **Teaming / Find Partners** — MBE ↔ prime in same lane
6. **Quarterly report mockup** — screenshot of funder rollup (Phase 2 export — honest that PDF is coming)

**Do not demo:** EDMIS export (not built), UEI win attribution (NAPEX build — say "eval includes this when live").

---

## 4-week rhythm (until NAPEX)

| Week | Partnerships | Research | Product dependency |
|------|--------------|----------|-------------------|
| **Jun 14–20** | PGC email + advisor posts + JD live | EDC top-10 in Phase 2 doc | CTA filters polished |
| **Jun 21–27** | PGC follow-up call; 1 NMSDC council contact | MBDA status matrix (10 centers) | NAPEX demo laptop dry run |
| **Jun 28 – Jul 4** | APEX director outreach (parallel track) | State commerce target (1 state) | UEI roster spec locked |
| **Jul 5–11** | PGC eval signed OR second EDC target | Grant NOFO tracker populated | UEI roster build starts |

---

## Files in this folder

| File | Purpose |
|------|---------|
| `ONE-PAGER.md` | **Glance version** — the whole plan on one page (quick Slack/email drop) |
| `TEAM-BRIEF.md` | **Share-with-team onboarding** — mission, who to hire, targets, plan (start new folks here) |
| `PRD-edc-mbda-partnerships.md` | Strategy + pricing + KPIs |
| `JD-head-public-sector-partnerships-funding.md` | FT hire posting |
| `EXECUTION-RUNBOOK.md` | **This doc** — weekly actions |
| `landscape-research-phase2.md` | Target inventory (living) |
| `outreach-templates.md` | Copy-paste emails |
| `advisor-recruitment-brief.md` | 3 advisor role posts |
| `grant-nofo-tracker.md` | SBIR / EDA / state calendar (live deadlines) |
| `FUNDING-STRATEGY.md` | **Which funding Mindy can actually win + apply/skip calls** (DoD SBIR, civilian, state; nonprofit + prior TX/FL contract assets) |
| `../../scripts/provision-edc-pilot-org.sql` | Supabase org setup for EDC eval |

---

## Success this month

- [ ] PGC EDC eval call booked
- [ ] FT hire JD posted + 5+ applicants
- [ ] 1 advisor role filled or strong pipeline
- [x] Phase 2 research doc **COMPLETE**: §1 EDCs + §2 MBDA matrix + §3 NMSDC + §4 state divisions + §6 NOFO calendar + §8 events (all verified). ⛔ MBDA centers not viable → route to surviving operators + state divisions (TX HUB/MD GOSBA/CA DGS) + NMSDC (best: CRMSDC). 💡 State-cert = LEAD channel (uncrowded). ★ Book NAPEX booth Aug 16–20 Orlando ($1,500) — top action.
- [x] Grant tracker: **7 NOFOs with verified deadlines** logged. Near-term: DoD SBIR 26.3 (Jun 24–Jul 22) + MBDA Rural Business Ctr (Jun 29)

---

*Updated: June 14, 2026*
