# Team Memo — Association & Chapter Outreach Program

**To:** Public Sector Partnerships & Outreach Team  
**From:** Eric Coffie  
**Date:** June 28, 2026  
**Re:** Nationwide chapter outreach — how we hit 5–10 partner meetings per week

---

Team,

We are launching a structured outreach program to trade associations, construction division chapters, and related member organizations. The goal is **5–10 qualified partner meetings per week** — not retail signups, but **org-level deals** where the association acquires Mindy usage rights and extends access to members as a membership benefit.

This memo is your operating guide. Read it once, bookmark the files below, and start pulling from the registry this week.

---

## 1. What we're selling (one sentence)

**The association buys the rights; their members get the wins — included with membership, not another subscription.**

We are **not** pitching individual contractors to sign up at getmindy.ai. We are pitching EVPs, chapter executives, and membership directors on an **org license** ($18K–$50K/yr depending on segment) with a coach dashboard and quarterly board report.

**Mantra to use on every call:** *"You acquire the rights; your members get the federal wins."*

---

## 2. Your primary tool — the Master Registry

**File:** `projects/public-sector-targets/MASTER-REGISTRY.csv`  
**Size:** 1,713 organizations · **1,635 chapter-level targets** · all **51 states + DC**

Open in Google Sheets or Excel. Each row is one organization. **One row = one outreach thread. Do not merge rows.**

### Columns you will use daily

| Column | What it means |
|--------|----------------|
| `org_name` | Who you're contacting |
| `registry_segment` | Which playbook (see Section 3) |
| `org_level` | **`chapter`** = your daily queue; `national` = air cover only |
| `parent_org` | National body (AGC, NRCA, NECA, etc.) |
| `csi_division` | Construction trade (01=GC, 07=roofing, 03=concrete, etc.) |
| `state` | Geography — **any state is valid**; do not limit to four states |
| `priority` | **P1** = outreach this week; P2/P3 = next waves |
| `contact_name` / `contact_email` / `contact_phone` | Fill in as you research |
| `pipeline_stage` | Research → Outreach → Meeting → Eval → Closed |
| `research_status` | `seed` = name pattern, verify on call · `verified` = use as-is |
| `next_action` | Your task for this row |

### Your daily filter

```
org_level = chapter
priority = P1
pipeline_stage = Research (or Outreach)
```

That gives you **646 P1 chapters** nationwide. Rotate `csi_division` by day so pitches stay fresh (Monday = Div 07 roofing, Tuesday = Div 01 GC, etc.).

---

## 3. Five tracks — never mix them in one email

Each org belongs to **exactly one track**. Wrong track = wasted meeting or double-pitch conflict.

| Track | `registry_segment` | Who | Price anchor | Email template |
|-------|---------------------|-----|--------------|----------------|
| **Government partners** | `gov_intel` | EDC, APEX, state HUB programs | $35K–$200K | Outreach §1 (EDC) — Eric leads P1 |
| **NMSDC councils** | `nmsdc_council` | Each MBE council **separate row** | $35K–$50K | Minority advisor — never lump councils |
| **Chambers** | `chamber` | USHCC, ethnic/regional chambers | $18K | USHCC playbook |
| **Industry / construction** | `industry_traction` | **Your main queue** — all 10 CSI divisions | $25K–$50K | Outreach §2 (construction) |
| **Direct government** | `direct_gov` | DoD / Air Force buyers | $15K pilot | Eric only — not your lane |

**Your lane:** `industry_traction` chapter rows + `chamber` rows (when assigned).

**Hard rules:**
- Do **not** pitch an APEX center as an EDC cohort.
- Do **not** combine FSMSDC + CRMSDC + DFW into one "Florida/Texas MSDC" email.
- Do **not** pitch NACC and AGC in the same thread — separate rows.
- Same **state**, different tracks = OK to work in parallel, but **separate emails**.

Full rules: `projects/public-sector-targets/ROUTING-RULES.md`

---

## 4. Weekly cadence — how we hit 5–10 meetings

| Day | Team action | Target |
|-----|-------------|--------|
| **Monday** | Each rep pulls **8–10 P1 chapter rows** from the registry; assign owner in `owner` column | 8–10 new outreach emails sent |
| **Tue–Thu** | Follow up; book **15-min EVP intro calls** | 1–2 booked calls per rep per day |
| **Friday** | Update CSV: `contact_name`, `pipeline_stage`, `next_action`, `research_status` | Pipeline clean for next week |

**Math:** 10 emails → ~30% reply → ~3 calls booked → 2 reps = **5–10 meetings/week**.

### Division rotation (avoid sounding repetitive)

| Day | Filter `csi_division` | Pitch hook |
|-----|----------------------|------------|
| Mon | `07` | Roof sustainment, federal renovation IDIQs |
| Tue | `01` | GC/sub federal intel, complement Federal Construction 101 |
| Wed | `03` | Concrete / MILCON / USACE |
| Thu | `09` or `multi` | Finishes or electrical/mechanical |
| Fri | `04`–`06` or `10` | Rotate masonry, wood, specialties |

---

## 5. Outreach copy — do not rewrite from scratch

**Templates:** `projects/public-sector-targets/outreach-templates-associations.md`

| Target | Use section |
|--------|-------------|
| Trade / manufacturing assoc | §1 |
| Construction chapter (AGC, ABC, NECA, NRCA, etc.) | §2 |
| Chamber / USHCC | §3 (or USHCC proposal) |
| Veteran fraternal (Legion, VFW) | §4 |

**Lead magnet on every first touch:** Offer a free **Federal Market Snapshot** for their trade + state (15-min walkthrough). Spec: `FEDERAL-MARKET-SNAPSHOT-SPEC.md`

**Send from:** Eric Coffie or hello@govconedu.com (unless I assign you a dedicated alias).

---

## 6. Seed rows — what to expect

Most chapter rows are **`research_status=seed`**. The org name follows a standard pattern (e.g. `ACI — Nebraska Chapter`, `NRCA State Affiliate — Ohio`). The local chapter may use a different legal name (e.g. FRSA in Florida, RCAT in Texas).

**On every first contact:**
1. Confirm the real chapter name and EVP on their website or LinkedIn.
2. Update the CSV: `contact_name`, `contact_email`, `contact_phone`, `source_url`.
3. Change `research_status` to `verified` once confirmed.

**Start with these verified rows** (real contacts already on file):

| Chapter | Contact | Phone / email |
|---------|---------|---------------|
| ABC Florida Gulf Coast | Steve Cona III | 813-876-1970 |
| ABC Florida East Coast | Peter Dyga | 954-984-4905 |
| ABC Greater Houston | Mylene Pham | m.pham@abchouston.org |
| ABC Central Texas | Crystal Smith | csmith@abccentraltexas.org |
| ABC North Florida | DeeDee Rasmussen | rasmussen@abcnorthflorida.org |
| ABC Florida First Coast | Karin Tucker Hoffman | abcflorida.com/contact |

---

## 7. Call structure (15 minutes)

1. **Their world:** What do members ask about federal work? Training gaps?
2. **Our model:** Org acquires rights → members get daily intel + matching → board gets quarterly report.
3. **Lead magnet:** Walk Federal Market Snapshot for their division + state (or schedule Part 2).
4. **Close:** Offer **60-day director eval** — up to 20 member firms, no cost — before any license talk.

**Do not** demo features we haven't shipped. **Do** demo Market Analytics, opportunity matching, and coach dashboard only.

Proposal template (after interest): `docs/proposals/Association-Mindy-Proposal-Template.html`

---

## 8. What to log after every touch

Update the registry row same day:

| Field | Values |
|-------|--------|
| `pipeline_stage` | Research → **Outreach** → Meeting → Eval → Won / Lost |
| `owner` | Your name |
| `next_action` | e.g. "Follow up Tue", "Send snapshot", "Schedule eval kickoff" |
| `contact_name` | Real EVP name |
| `notes` | Date + one-line outcome |

If a row is a duplicate of a verified chapter, mark duplicate `pipeline_stage=Disqualified` and note which row to use instead.

Eric reviews pipeline every **Friday EOD**.

---

## 9. Reference library (read order)

| # | File | Purpose |
|---|------|---------|
| 1 | `MASTER-REGISTRY.csv` | Source of truth — your daily queue |
| 2 | `CHAPTER-BLAST-RADIUS.md` | Cadence, filters, division counts |
| 3 | `outreach-templates-associations.md` | Copy-paste emails |
| 4 | `ROUTING-RULES.md` | What not to pitch together |
| 5 | `CONSTRUCTION-DIVISIONS.md` | Div 01–10 → parent org map |
| 6 | `ASSOCIATION-MEMBER-VALUE.md` | Why "acquired rights" positioning |
| 7 | `FEDERAL-MARKET-SNAPSHOT-SPEC.md` | Lead magnet content |
| 8 | `ASSOCIATION-OUTCOMES-SCORECARD.md` | Board metrics for close |

All paths under: **`projects/public-sector-targets/`**

---

## 10. Escalate to Eric immediately

- Any org badged **MBDA Business Center** (funding moratorium — verify before pitching)
- **NACC** row — I need to confirm identity on first contact; copy me on reply
- **`direct_gov`** rows (DISA, Army, Navy) — not your lane
- **`gov_intel`** P1 EDC rows (Prince George's, etc.) — I close until FT hire starts
- Deal size **$75K+** or multi-state rollup
- Legal, pricing exception, or custom contract ask

---

## 11. Success metrics (what I am tracking)

| Metric | Weekly target |
|--------|---------------|
| Outreach emails sent (new P1 chapters) | 20–40 (team total) |
| Replies / positive responses | 6–12 |
| **Partner meetings booked** | **5–10** |
| Registry rows moved to `Meeting` or `Eval` | 3–5 |
| Contacts verified (`seed` → `verified`) | 10+ |

---

## 12. This week's assignment

1. Open `MASTER-REGISTRY.csv` in Sheets.
2. Filter: `org_level=chapter`, `priority=P1`, `registry_segment=industry_traction`, `pipeline_stage=Research`.
3. Claim 10 rows each — put your name in `owner`.
4. Send §2 construction template (personalize division + state).
5. Report booked meetings in Slack/email by **Friday 5 PM ET**.

Questions → Eric (reply to this memo). Do not improvise new pitch tracks without checking `ROUTING-RULES.md` first.

Let's fill the calendar.

**Eric Coffie**  
Founder, GovCon Giants / Mindy  
hello@govconedu.com | getmindy.ai

---

*Internal only. Registry and templates live in the `market-assassin` repo under `projects/public-sector-targets/`.*
