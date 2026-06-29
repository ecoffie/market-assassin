# Construction Division Target Map (CSI MasterFormat 01–10)

**Status:** ACTIVE — June 28, 2026  
**Purpose:** Expand industry-traction targets by **trade**, not just general contractor leagues.  
**Registry:** [`MASTER-REGISTRY.csv`](MASTER-REGISTRY.csv) — **1,635 chapter rows**, all **51 states/DC**, Div **01–10 + multi**.  
**Weekly cadence:** [`CHAPTER-BLAST-RADIUS.md`](CHAPTER-BLAST-RADIUS.md) — nationwide wide net; 5–10 meetings/week.

---

## GTM segments (do not merge pitches)

| Track | `registry_segment` | Who | Motion |
|-------|-------------------|-----|--------|
| **Government intel partners** | `gov_intel` | EDC, APEX, state HUB/OSD divisions | Funder reporting, cohort outcomes, CTA attribution |
| **NMSDC councils** | `nmsdc_council` | Each regional MBE council **on its own row** — FSMSDC, CRMSDC, etc. | Enterprise license; **never** lumped into APEX or construction pitch |
| **Chambers** | `chamber` | USHCC, ethnic/regional chambers of commerce | **Acquired rights** — USHCC playbook ($18K cohort model) |
| **Industry traction** | `industry_traction` | CSI division trade associations, unions, fraternal, professional societies | **Acquired rights** — included with membership |
| **Minority operators** | `minority_operator` | Surviving MBDA-adjacent operators (own name) | Eval license; verify funding |
| **Direct government** | `direct_gov` | DoD / AF buyers | $15K commercial pilot — not Coach Mode |

**Eric's rule:** Combine **EDC + APEX** in the gov-intel track. Keep **Florida MSDC councils** (and every NMSDC council) as **separate rows** in `nmsdc_council`. Route **USHCC and chambers** in `chamber` — not industry_traction. Route **NACC / division trades / unions / Legion-VFW / ACEC-SAME** in `industry_traction`.

---

## Division → national trade associations

| Div | MasterFormat scope | National associations (registry rows) | Unions (separate rows) |
|-----|-------------------|--------------------------------------|--------------------------|
| **01** | General requirements, GC/sub coordination | AGC, ABC, ASA, CMAA | — |
| **02** | Existing conditions, demolition, abatement | NDA | — |
| **03** | Concrete, rebar, formwork | ACI, NRMCA, ACPA | OPCMIA |
| **04** | Masonry, stone, tile (structural) | MCAA | IUBAC (Bricklayers) |
| **05** | Structural steel, metal decking, misc metals | AISC | Iron Workers |
| **06** | Rough carpentry, millwork, plastics/composites | AWC, AWI, NAHB (residential) | UBC (Carpenters) |
| **07** | Roofing, waterproofing, insulation, siding | NRCA, SMACNA (sheet metal/envelope) | Roofers (UIR) — seed |
| **08** | Doors, windows, glazing, hardware | WDMA, DHI | Glaziers (IUPAT) — seed |
| **09** | Drywall, ceilings, paint, flooring, tile finish | AWCI, NTCA, PCA, FCICA | Painters (IUPAT), Floor Layers — seed |
| **10** | Specialties (signage, specs, partitions) | ISA, CSI | — |

**Cross-division (still industry_traction, `csi_division=multi`):**

| Org | Why |
|-----|-----|
| NECA | Electrical — federal installs (often Div 26; high federal NAICS) |
| PHCC | Plumbing / mechanical — federal facilities |
| NACC (verify) | User-referenced — **separate row**; confirm on call vs AGC chapter |
| WMC, NAM | Manufacturing-adjacent — not CSI division-specific |

**Nationwide chapters:** Every state + DC has seed rows per division (`org_level=chapter`). Filter `priority=P1` for first outreach wave (646 rows); P2/P3 = same wide net, later rotation. **Do not limit to four states** — federal work is in all 51. See [`CHAPTER-BLAST-RADIUS.md`](CHAPTER-BLAST-RADIUS.md).

---

## Pitch angle by division

Use [`FEDERAL-MARKET-SNAPSHOT-SPEC.md`](FEDERAL-MARKET-SNAPSHOT-SPEC.md) with division-specific NAICS/PSC:

| Div | Snapshot hook |
|-----|---------------|
| 03 | Concrete / vertical construction — MILCON, USACE |
| 05 | Steel — Navy pier, hangar, industrial |
| 07 | Roofing — sustainment, renovation IDIQs |
| 08 | Openings — blast-resistant, secure facilities |
| 09 | Finishes — tenant improvement, medical, admin |

**Mantra:** *"Your association acquires the rights; your [roofers / masons / subs] get the federal wins."*

---

## Routing reminders

1. **Do not** pitch GT APEX as an EDC cohort — `gov_intel`, channel `apex`.
2. **Do not** merge FSMSDC with CRMSDC or pitch as one "Florida MSDC network."
3. **Do not** sell NACC and AGC in one email — separate rows; NACC may be a name Eric knows locally.
4. **Do** let SBDC & chamber advisor own `chamber` and `industry_traction` intros (separate pitch decks).

---

*See [`ROUTING-RULES.md`](ROUTING-RULES.md) Rule 9 and [`CHANNEL-TAXONOMY.md`](CHANNEL-TAXONOMY.md) GTM segments.*
