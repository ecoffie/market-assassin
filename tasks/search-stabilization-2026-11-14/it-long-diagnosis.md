# IT hardware long phrasing: why the top 20 is weak (diagnosis only, 2026-11-15)

Agent 3. Requested by Agent 5. No code change.

**Method:** holdout runner on the long-list guard branch (38cd537ad; RC3 behaves the same for IT), using the Nov 14
snapshot (9,701 notices).

**Labels:** Agent 3's v4–v6 labels. Most rows are unlabelled, so the counts below are structural, not precision scores.

Phrasing (public, queries_v4.json): "We are an IT hardware reseller. We sell laptops, desktops, servers, monitors,
networking equipment, storage and peripherals, including installation and warranty support."

## Root cause: the candidate window is starved before ranking

| | short phrasing | long phrasing |
|---|---|---|
| notices matched | 544 | **1,584** |
| 500-row deadline window closes at | 2026-12-23 | **2026-11-20** (5 days of deadlines) |
| IT-coded notices matched (preset PSCs 7B20…7K20) | 77 | 77 |
| IT-coded notices inside the window | 68 | **19** |
| IT-coded notices cut before ranking | 9 | **58** |

FIND draws its 500 candidates by response deadline and ranks after that. On the long phrasing, 481 of the 500 candidates
are not IT. 58 of 77 IT-coded notices never reach the classifier. Of those 58, 16 have an item noun in the title
("KEYBOARD,DATA ENTRY", "COMPUTER,DIGITAL", "COMPUTER,TABLET", "SERVER,AUTOMATIC DA"), and several others are plainly
hardware ("DISK DRIVE UNIT", "PANEL PC", "TERMINAL,DATA PROCE").

The top 20 is therefore filled from what remains: RELATED product-code rows among the 19, plus description-only noise.
That includes the engine manuals filed under 7E20.

## Where the extra 1,040 matches come from (long phrasing, by query alternative)

| alternative | rows it matches | rows ONLY it matches | cause |
|---|---|---|---|
| `monitors` | 989 | **492** | Fully inflected, so it matches the verb "monitor / monitoring / monitored" in requirement text. All 492 sole-admit rows contain the word only as monitoring / monitored, never the noun. |
| `information technology \| hardware \| reseller \| sell \| laptops` (ANY) | 907 | 238 | "hardware" hits 525 rows (DLA item boilerplate: "mounting hardware", "attaching hardware"). "information technology" hits 425 (clause text in descriptions). |
| `including \| warranty \| installation` (ALL) | 312 | 38 | Warranty / installation clauses. |
| `servers` / `desktops` / `networking equipment` / `storage peripherals` | 91 / 36 / 44 / 28 | 16 / 4 / 0 / 0 | Mostly genuine. |

The short phrasing ("We sell computer hardware and IT equipment.") has no list words and none of these. That explains
why IT short went 2–4 → 13–15 in RC3 while long stayed below 40%.

## Secondary: weak product-code fill inside the IT families

The 7x PSC families also carry non-hardware:
- "Rolls Royce Engine Manuals" under 7E20 (miscoded);
- WAN/LAN services under 7G21;
- LYRASIS library services under 7H20;
- genomics software under 7B22;
- a training target under 7J20.

DLA hardware nouns that are missing from the preset vocabulary also sit at the same product-code tier: INTERFACE UNIT,
CONVERTER, DISK DRIVE UNIT, DISPLAY UNIT, TERMINAL, PANEL PC. The tier therefore mixes real hardware with miscoded rows.

DLA "SERVER / KEYBOARD … IN REPAIR/MODIFICATION OF" notices are correctly NOT RELEVANT for a reseller (Eric's
parts-vs-repair rule).

## Options (not built; each needs measurement on the runner + Agent 4's labels)

**A. Window by evidence, not only deadline (largest effect).**
- Union a separately capped code-recall sub-window (the preset's own PSCs) into the 500 candidates, so every preset-coded
  notice reaches ranking.
- Production already unions a second candidate set for company-anchored searches (`basePlan` + `unionRows`).
- Code-recall sets are small (IT: 77).
- Applies to every product preset, so the regression check must cover valves, fasteners, electrical, aircraft and
  medical.
- No row leaves the matched set; only the window changes.

**B. Noun forms for list nouns in paragraphs.**
- A plural noun from a list ("monitors", "servers") should match noun forms (monitor, monitors), not -ing / -ed.
- Alone, this removes the 492 sole-admit "monitoring" rows from the IT long matched set.
- This is a retrieval change, so recall must be measured. It also widens the IT long window, but is weaker than A.

**C. Item vocabulary for DLA hardware nouns.**
- Add disk drive, display unit, interface unit, terminal, panel pc, tablet computer; strict IT families only.
- This moves those rows from product-code RELATED to DIRECT.

**D. Description-only boilerplate.**
- "hardware" and "information technology" in a product notice's description are already treated as boilerplate for
  product searches. Its effect here is only on retrieval volume, so it is covered by A or B.

**Recommended order:** A, then C, then B (B only if A does not bring IT long above 40%).
