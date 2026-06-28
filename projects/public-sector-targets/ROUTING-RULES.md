# Target Routing Rules

**Purpose:** Prevent double-pitching, channel conflict, and wasted outreach.  
**Apply before:** Every email, booth conversation, or advisor intro.

---

## Rule 1 — One channel per org

Each organization gets **one row** in [`MASTER-REGISTRY.csv`](MASTER-REGISTRY.csv) with a single `channel` value. If an org fits multiple types, use the **highest-priority channel** below.

**Priority order (first match wins):**

1. `direct_dod` / `direct_af` — if they are a government buyer, not a partner
2. `apex` — if they **are** an APEX Accelerator (even if hosted by a university)
3. `sbdc` — if they are an SBDC lead center
4. `nmsdc` — if they are an NMSDC regional council
5. `trade_501c6` / `labor_union` / `fraternal_veteran` / `professional_assoc` — association acquired-rights
6. `chamber` — if primary identity is chamber of commerce (not industry trade assoc)
7. `edc` — county/regional EDC with GovCon academy
8. `state_division` — state HUB/GOSBA/OSDS office
9. `mbda_adjacent` — surviving operator of a defunct MBDA center (not badged "MBDA center")
10. `wioa` — workforce board (defer)

---

## Rule 2 — APEX vs EDC split

| Situation | Route to | Do NOT |
|-----------|----------|--------|
| GT APEX, UH APEX, FL APEX@USF, VA APEX@GMU, LA County APEX | `apex` | Pitch as `edc` |
| County vendor academy (Hillsborough, Loudoun) | `edc` | Pitch as `apex` |
| EDC that **refers** to local APEX for counseling | `edc` | Compete with APEX counseling dollars |

**Mantra:** Partner with APEX for 1:1 counseling; Mindy is reporting + matching + member intelligence.

---

## Rule 3 — MBDA center moratorium

**Do not pitch** multi-year licenses to anything still badged "MBDA Business Center" unless they confirm cooperative agreement funded past Aug 31, 2026.

| MBDA status | Route instead |
|-------------|---------------|
| TERMINATED (San Antonio, El Paso, Sacramento, NC) | Surviving operator or `state_division` |
| UNVERIFIED | Phone-verify first; pitch operator under **own name** |
| Surviving NMSDC operator (CRMSDC, DFW, FSMSDC) | `nmsdc` — not `mbda_adjacent` |

**Qualifying phone question:** *"Is your MBDA cooperative agreement currently funded, and is it being renewed past Aug 31, 2026?"*

---

## Rule 4 — NMSDC vs minority contractor assoc

| Org | Channel |
|-----|---------|
| NMSDC regional council (certifies MBEs) | `nmsdc` |
| Independent minority contractor association (not NMSDC affiliate) | `trade_501c6` or `chamber` |
| State Black/Hispanic chamber with cohort | `chamber` |

One **minority-business advisor** owns NMSDC + state_division intros. Do not duplicate.

---

## Rule 5 — Association vs chamber

| Signal | Channel |
|--------|---------|
| 501(c)(6) business league; industry-vertical members (manufacturers, contractors, electricians) | `trade_501c6` |
| Local/regional chamber; mixed business membership | `chamber` |
| USHCC / ethnic chamber with federal training cohort | `chamber` (USHCC playbook) |
| Union / apprenticeship program | `labor_union` |
| Veteran fraternal (Legion, VFW) | `fraternal_veteran` |
| Professional society (AIA, ACEC, SAME) | `professional_assoc` |

---

## Rule 6 — Direct government is separate motion

DISA, Navy OSBP, Army ACC-Orlando, AFICC → `direct_dod` or `direct_af`.

- **Do not** sell Coach Mode org licenses
- **Do** sell $15K commercial-item pilots
- See [`../edc-mbda-partnerships/GOVT-GTM-STRATEGY.md`](../edc-mbda-partnerships/GOVT-GTM-STRATEGY.md)

---

## Rule 7 — Advisor handoff

| Advisor role | Opens channels | FT hire closes |
|--------------|----------------|----------------|
| APEX partnership advisor | `apex` | All |
| SBDC & chamber advisor | `sbdc`, `chamber`, `trade_501c6`, `professional_assoc` | All |
| Minority-business advisor | `nmsdc`, `state_division`, `mbda_adjacent` | All |

Eric closes `direct_dod`, `direct_af`, and P1 `edc` until FT hire starts.

---

## Rule 8 — Disqualify list

Do not add to registry or pursue:

- Community Business Partnership (Springfield VA) — operations concluded
- CPUC GO 156 (CA utility supplier diversity) — not government contracting
- Pure social clubs with no business members
- MBDA centers with confirmed termination and no surviving operator

---

*Last updated: June 28, 2026*
