# PRD: Navy Gold Coast — Live Demo

**Status:** ☐ PRD only — do NOT execute yet · ☐ Approved to build
**Owner:** Eric / Claude
**Event:** Department of the Navy Gold Coast Premier Procurement Expo — **Aug 17–20, 2026**, San Diego Convention Center (38th annual, NDIA-run)
**Written:** 2026-08-17
**Parent:** `docs/strategy/MINDY-STAGE-STRATEGY.md` (Gold Coast = **Tier 2 — home-court conversion**)
**Reuses:** `MINDY-DAY-LIVE-DEMO-MOMENT.md`, `MINDY-DAY-LIVE-DEMO-PREP.md`, `MINDY-DAY-CUSTOMER-HERO-BRIEF.md`, `scripts/demo-prep.ts`

---

## ⚠️ Read this first — the event is TODAY

Gold Coast 2026 runs **Aug 17–20**. This PRD is dated **Aug 17**. Two consequences that
change what this document is for:

1. **Industry registration closed Jul 28, 2026 (5pm PST).** If we are not already
   registered, the booth/stage path for *this year* is closed. **Open question #1 —
   Eric must confirm our registration status before any build work starts.**
2. **A build PRD is the wrong artifact for a same-week event.** Anything requiring a
   deploy, a migration, or a data backfill cannot land credibly mid-conference.

So this PRD is deliberately split into two tracks. Pick one:

| Track | When it applies | What it is |
|---|---|---|
| **Track A — Floor Kit** | We're registered / attending this week | Zero-code. A vetted Navy demo script + pre-staged account + printed leave-behind. Executable in hours. |
| **Track B — Gold Coast 2027** | We're not attending, or want it done right | The real build: Navy-sliced demo surface, booked speaking slot, customer hero. 12-month runway. |

**Recommendation: Track A now (if registered), Track B as the actual roadmap item.**
Track B is where the leverage is — Gold Coast is annual, and the stage strategy already
targets it. Track A is salvage.

---

## 1. Problem statement

**Who has this problem?** Navy-focused small businesses — the ~3,000+ attendees who walk
the Gold Coast floor specifically to find Navy work and meet Navy buyers.

**What's the pain?** They learn about Navy opportunities *after* the solicitation drops,
when the incumbent has already shaped it. They have no view of which Navy contracts are
coming up for recompete, who holds them now, or which Navy offices actually buy their
NAICS. Gold Coast itself is their once-a-year attempt to solve this by hand — walking a
floor and collecting business cards.

**How they solve it today:** Matchmaking sessions at the event; manual SAM.gov searching;
paying for Deltek/GovWin (per-seat, enterprise-priced, out of reach for this room).

**Evidence this is real:**
- ✅ **Our own event catalog rates it "Very High — Direct Navy buyer access, matchmaking"**
  (`src/data/federal-events-sources.json`) — the highest value rating we assign.
- ✅ **The stage strategy already names Gold Coast a Tier-2 target** and step 4 of the
  6-month sequence is literally "book Tier-2 home-court stages (SAME Nov, Navy Gold Coast Aug)."
- ✅ **We already unblocked the data for it** — `DATA-QUALITY-AUDIT.md` records the
  `sub_tier` backfill as done *specifically* to enable Navy slicing: "Navy Gold Coast demo unblocked."
- ⚠️ Not yet validated: no Navy-specific customer interview or Gold Coast attendee
  feedback on file. The demand signal is our own strategy docs, not the room's words.

## 2. Solution

**One sentence:** Show a Navy small business, live, the Navy contracts expiring in their
NAICS — with the incumbent named — before the solicitation exists.

**Where it lives:** Existing Mindy app (`/app/opportunities` + recompete surface). Track A
adds **no new UI**; it's a scripted path through what already ships.

**The demo flow (30 seconds, mirroring the vetted Mindy Day cold-open):**
1. Ask the person their NAICS and "Navy or Marine Corps?"
2. Filter the recompete list to Navy + their NAICS, live.
3. Open one row → incumbent name, ceiling value, estimated recompete date, likelihood.
4. The line: *"That contract is held right now. It comes up in [N] months. Your competitors
   find out when the solicitation drops. You just found out today."*
5. The honest edge (say it — this room is government-savvy): *"That date is estimated from
   award data. It's a signal, not a guarantee the solicitation drops that day."*

## 3. The Navy data — measured, not assumed (2026-08-17)

All figures pulled live from Supabase today. **These are the only Navy numbers cleared for
use on the floor.**

| Metric | Real number | Query basis |
|---|---:|---|
| Navy SAM opportunities (all) | **20,042** | `sam_opportunities`, `sub_tier = 'DEPT OF THE NAVY'` |
| Navy opportunities still open | **4,746** | + `response_deadline > NOW()` |
| **Navy recompetes, future-dated** | **2,282** | `recompete_opportunities`, Navy agency, `estimated_recompete_date > NOW()` |
| Navy recompetes in California | **301** | + `place_of_performance_state = 'CA'` |
| Navy contacts | **10,947** (10,937 emailable) | `federal_contacts`, Navy sub_tier |

**The headline claim for the floor:**
> "We're tracking **2,282 Navy contracts** coming up for recompete — **301 of them right
> here in California** — with the incumbent named on each one."

Both numbers are true as of today and independently re-runnable.

### ⚠️ Set-aside data is INCOMPLETE — do not quote it as a count
Of the 2,282 Navy recompetes, only **773 have `set_aside_type` populated at all**
(609 Full & Open, 139 SB-Total, 20 8(a), 4 WOSB, 1 SDVOSB). The remaining **1,509 are NULL
— meaning unknown, NOT "unrestricted."**

Per the existing house rule (`project_mindy_setaside_eligibility`: *NULL = unknown, not
ineligible*), **never say "164 small-business Navy recompetes"** — that's a floor derived
from 34% coverage, and a room full of small businesses is exactly where that understates
us. Say *"including small-business set-asides"* qualitatively, or don't raise it.

### Vetted demo rows (clean values, eyeballed — the corruption guard from `MINDY-DAY-LIVE-DEMO-MOMENT.md` applied)

San Diego / California relevance, right-sized for a small-biz room:

| Incumbent | Value | Recompete | NAICS | Work |
|---|---:|---|---|---|
| **ARETE ASSOCIATES** ⭐ | $12,999,980 | 2026-12-08 | 541715 | Navy R&D — **SB-Total set-aside** |
| ENGINEERING SERVICES NETWORK INC | $26,229,060 | 2026-09-30 | 541330 | Engineering/technical support |
| HERMAN CONSTRUCTION GROUP | $12,908,355 | 2027-01-24 | 236220 | Building repair/alteration |
| RSI REMEDIATION, LLC | $12,921,288 | 2026-08-26 | 562910 | Environmental remediation |
| KERN TECHNOLOGY GROUP LLC | $3,831,402 | 2026-08-23 | 541330 | Engineering — **SDVOSB set-aside** |

⭐ **Arete is the recommended lead example**: a real small-business set-aside, a clean
non-round number, CA place-of-performance, and a December recompete — close enough to feel
urgent, far enough that acting on it is still possible.

**Avoid:** anything ≥$100M, exactly-round values, and the `R.A. BURCH` rows (same incumbent
repeated — reads as a data artifact even though it's legitimate).

## 4. What ALREADY exists (don't rebuild)

The Mindy Day work is directly reusable. **Nothing in Track A is net-new code.**

| Asset | Path | Reuse as-is? |
|---|---|---|
| Cold-open demo structure + corruption guard | `docs/strategy/MINDY-DAY-LIVE-DEMO-MOMENT.md` | ✅ Swap the vehicle for a Navy row above |
| Demo-account prep + GREEN/YELLOW/RED verdict | `scripts/demo-prep.ts` | ✅ Run against the Navy persona |
| Demo persona seeding | `scripts/seed-demo-vault.ts <email>` | ✅ Seed a Navy-flavored persona |
| Prototype-tab gating | `MINDY_PROTOTYPE_EMAILS` env | ✅ Default clean Pro view is what we want |
| Customer-hero outreach playbook | `MINDY-DAY-CUSTOMER-HERO-BRIEF.md` | ✅ Track B only |
| Navy `sub_tier` slicing | Backfilled — 99,095/99,260 rows | ✅ **Already done** |
| Recompete surface w/ sub-agency on card | commit `90987ad0` (#1003) | ✅ Ships today |

**The one real gap:** no saved "Navy" view. Track A works around it with a live filter
(2 clicks) rather than building one.

## 5. Scope

### Track A — Floor Kit (zero-code, hours)
**In scope:**
- [ ] Confirm registration status ← **blocking, Eric only**
- [ ] Pre-stage + verify a Navy demo account (`npx tsx scripts/demo-prep.ts <email>` → GREEN)
- [ ] Re-verify the 5 vetted rows still render clean **the morning you walk the floor** (data syncs nightly)
- [ ] One-page leave-behind: the 2,282 / 301 headline + 3 example rows + a QR to signup
- [ ] Lead capture that tags `source=navy-gold-coast` (GHL tag — the funnels `/api/lead` path already supports tagging)

**Out of scope (Track A):** any deploy, any migration, a Navy saved view, a booked
speaking slot, a customer hero on stage.

### Track B — Gold Coast 2027 (the real one)
**In scope:**
- [ ] **Book the stage by ~Feb 2027** — Tier-2 slot, per the stage-strategy sequence
- [ ] The 90-second demo reel, Navy-cut (the strategy calls this the single
      highest-leverage asset, and it still doesn't exist)
- [ ] A Navy customer hero — see the honesty caveat below
- [ ] A **saved "Navy" view** in-app so the demo is 1 click, not a live filter
- [ ] Post-event: the 10,937 emailable Navy contacts become a follow-up motion, not a static list

**Dependencies:** registration (opens ~spring 2027); NDIA speaker application; one Navy
customer willing to be named.

**Honest constraint on the customer hero:** per `MINDY-POWER-USERS.md`, **only 1 win is
logged in the entire system** (and it's internal). We have activity heroes, not
dollar-win heroes. The root fix — one-tap "I won this" + prompt for award $ — is already
identified there and is a **prerequisite** for a credible 2027 hero story. Do not script
a dollar figure we can't source.

## 6. Acceptance criteria

**Track A:**
- `demo-prep.ts` returns **GREEN** for the demo account on the morning of the demo
- All 5 vetted rows render with clean values, named incumbents, future recompete dates
- The 2,282 / 301 figures re-verify the morning of (single query, re-runnable)
- Every floor lead lands in GHL tagged `navy-gold-coast`, count reconciles to the badge scans

**Track B:**
- Speaking slot confirmed in writing
- Demo reel exists, ≤90s, real Navy data end-to-end
- ≥1 Navy customer confirmed on camera
- Navy saved view is 1 click from the app home

## 7. Estimated effort

| Track | Phase | Effort |
|---|---|---|
| A | Registration check | Eric, 5 min — **blocking** |
| A | Demo account + row re-verify | ~1 hr |
| A | Leave-behind one-pager | ~2 hrs |
| A | Lead-capture tag | ~30 min (reuses `/api/lead`) |
| B | Reel + hero + saved view + slot | 2–3 months, starting ~Q1 2027 |

## 8. Risks + open questions

| # | Risk / question | Owner |
|---|---|---|
| **1** | **Are we registered for Aug 17–20?** Industry registration closed Jul 28. If no → Track A is moot, go straight to Track B. | **Eric — blocking** |
| 2 | Value-corruption on stage (the Carahsoft "$2.8 TRILLION" class of row). Mitigated by the vetted list, but **re-verify the morning of** — data syncs nightly. | Claude |
| 3 | Set-aside NULLs (66% unpopulated) invite an accidental undercount claim to a small-biz room. **Don't quote the number.** | Eric on the floor |
| 4 | No Navy customer hero exists, and win-tracking is too thin to produce one. Blocks the strongest Track-B beat. | Product |
| 5 | Recompete dates are *estimates*. A KO in this room will test that. Say it first — credibility gain, not loss. | Eric on the floor |
| 6 | Track B slips silently because nothing schedules it. Recommend a calendar hold ~Jan 2027. | Eric |

## 9. Decision log

- **2026-08-17** — PRD opened. Discovered event is Aug 17–20 (today); registration closed Jul 28. Split into Track A (salvage, zero-code) / Track B (2027, the real build).
- **2026-08-17** — Navy data measured live: 2,282 future recompetes, 301 CA, 20,042 SAM opps, 10,947 contacts. Cleared for use.
- **2026-08-17** — Set-aside counts **excluded** from floor claims: only 773/2,282 populated; NULL = unknown per existing house rule.
- **2026-08-17** — Chose to reuse the Mindy Day demo apparatus wholesale rather than build a Gold Coast variant. Track A is deliberately zero-code.
- **2026-08-17** — Arete Associates ($12,999,980, 541715, SB-Total, Dec 2026) selected as lead demo row: real set-aside + clean value + CA + urgent-but-actionable date.

---

**Status:** ☑ **PRD only — do NOT execute yet** · ☐ Approved to build

*Blocking on open question #1 (registration status) before any Track A work begins.*
