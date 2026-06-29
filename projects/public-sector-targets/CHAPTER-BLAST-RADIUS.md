# Chapter Blast Radius — 5–10 Meetings / Week

**Status:** ACTIVE — June 28, 2026  
**Goal:** Eric — **5–10 partner meetings per week** via **nationwide chapter outreach** (not national-only).  
**Registry:** [`MASTER-REGISTRY.csv`](MASTER-REGISTRY.csv) — **1,635 chapter rows** across **all 51 states/DC** and **Div 01–10 + multi**.

---

## Wide net — no state cap

Earlier seeds focused on FL/TX/VA/MD for speed. **That was a starting constraint, not the strategy.**

Federal construction is **nationwide**: USACE districts, VA medical centers, GSA buildings, MilCon in every state. The registry now backfills **every state** for every division template so you never run out of outreach targets.

| Metric | Count |
|--------|-------|
| Total registry rows | **1,713** |
| Chapter rows (`org_level=chapter`) | **1,635** |
| States + DC covered | **51 / 51** |
| P1 chapters (outreach queue first) | **646** |
| P2 + P3 chapters (same net, later waves) | **989** |

**Priority (P1/P2/P3) = outreach order, not exclusion.** Every state is in the net.

---

## Chapters by division

| Div | Scope | Chapter rows |
|-----|--------|--------------|
| **01** | GC / subs (AGC, ABC, ASA) | 171 |
| **02** | Demolition (NDA regional) | 51 |
| **03** | Concrete (ACI, NRMCA, OPCMIA, ACPA) | 204 |
| **04** | Masonry (MCAA, IUBAC) | 105 |
| **05** | Steel (AISC, Iron Workers) | 104 |
| **06** | Wood / builders (NAHB HBA, AWI, UBC) | 155 |
| **07** | Roofing / envelope (NRCA affiliate, SMACNA, Roofers) | 161 |
| **08** | Openings (WDMA, DHI, IUPAT glaziers) | 153 |
| **09** | Finishes (AWCI, NTCA, PCA, FCICA, IUPAT painters) | 258 |
| **10** | Specialties (ISA, CSI) | 102 |
| **multi** | Electrical / mechanical (NECA, PHCC, IBEW) | 163 |

Each row = **one meeting slot**. Rotate division + state weekly so pitches stay fresh.

---

## Registry columns

| Column | Use |
|--------|-----|
| `org_level` | `chapter` for outreach queue |
| `parent_org` | National body — pitch "member benefit via [AGC/NRCA/etc.]" |
| `csi_division` | Filter pitch hook (roofing vs concrete vs GC) |
| `state` | Geo filter — **any state**, not a fixed four |
| `priority` | P1 this week → P2 next → P3 after |

**Seed rows** use pattern names (e.g. `ACI — Montana Chapter`) with `research_status=seed` — **verify local chapter name + EVP on first contact**, then update CSV.

---

## Weekly cadence (5–10 meetings)

| Day | Activity |
|-----|----------|
| **Mon** | Pick **10 P1 chapter rows** — rotate: Mon=Div 07, Tue=Div 01, Wed=Div 03, etc. |
| **Tue–Thu** | Send outreach + book **2–3 calls/day** |
| **Fri** | Update `contact_name`, `pipeline_stage`; pull next 10 from queue |

**Math:** 10 emails × 30% reply × 30% book rate ≈ **3 calls/day** → **5–10 meetings/week** at steady state.

### Sample week (any states — rotate)

| Meeting | Row filter example |
|---------|-------------------|
| 1 | `csi_division=07` + `state=CO` + `P1` |
| 2 | `csi_division=01` + `state=NC` + `P1` |
| 3 | `csi_division=03` + `state=WA` + `P1` |
| 4 | `csi_division=09` + `state=OH` + `P1` |
| 5 | `csi_division=multi` + `state=GA` + NECA + `P1` |

---

## Spreadsheet filters (Google Sheets / Excel)

```
org_level = chapter
priority = P1
csi_division = 07        ← change daily
state = [any]            ← do NOT lock to FL/TX/VA/MD
research_status = seed   ← verify EVP, then mark verified
```

---

## Verified contacts (use first — override seed rows)

| Chapter | Contact | Phone / email |
|---------|---------|---------------|
| ABC Florida Gulf Coast | Steve Cona III | 813-876-1970 |
| ABC Florida East Coast | Peter Dyga | 954-984-4905 |
| ABC Greater Houston | Mylene Pham | m.pham@abchouston.org |
| ABC Central Texas | Crystal Smith | csmith@abccentraltexas.org |
| ABC North Florida | DeeDee Rasmussen | rasmussen@abcnorthflorida.org |
| ABC Florida First Coast | Karin Tucker Hoffman | abcflorida.com/contact |

When a seed row duplicates a verified chapter (e.g. two ABC FL rows), **use the verified row** and mark the duplicate `pipeline_stage=Disqualified` after merge.

---

## Pair with gov_intel (same state, separate email)

Same **state**, different motion — never one combined pitch:

| State example | Chapter | Gov_intel (separate track) |
|---------------|---------|----------------------------|
| TX | NECA — Texas Chapter | UH APEX, TX HUB |
| MD | AGC of Maryland | MD GOSBA, CRMSDC |
| FL | NRCA State Affiliate — FL (FRSA) | FSMSDC, FL OSD |

---

*See [`CONSTRUCTION-DIVISIONS.md`](CONSTRUCTION-DIVISIONS.md) for division → parent org map.*
