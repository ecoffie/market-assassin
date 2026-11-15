# DLA NSN parts (Eric-approved, development only) — 2026-11-15

Eric: "you can build the dla stock number parts we are just not displaying dla bids on our maps." The DLA hiding is
**Maps display only**. Search / FIND keep DLA. This branch does not touch Maps.

Branch `agent3/dla-nsn-parts`, on top of `agent3/expert-misses` (RC3 + H1). No tag.

**Change:**
1. A `replacement_parts` product preset fires on "replacement / spare / repair parts". It has no codes. Its vocabulary
   ("replacement parts", "spare parts", "repair parts", "NSN", "national stock number") retrieves over title AND description.
2. **DIRECT rule** (`nsnHardwareItem`): for that preset only, a notice under a **hardware FSC (groups 10–59)** with a National
   Stock Number in its title or description is DIRECT. Medical (65), food (89), fuel (91) and IT (70/7x) never qualify.
   Repair and service notices stay excluded (Eric's S30 ruling).
3. The evidence classifier sees the **literal** interpretation it saw before (`classifierView`), so non-NSN parts rows keep
   their old labels. The existing long-list and parts tests pass unchanged (898 tests).

**Measured on the Nov 14 fixture:**

| | RC3 + H1 | + DLA NSN parts |
|---|---|---|
| Parts short: matched / top 20 | 1,265 / 13–15 Direct | 5,534 / **20 of 20 DIRECT by rule** (20 unlabelled) |
| Parts long: matched / top 20 | 1,759 / 19–19 | 5,812 / **20 of 20 DIRECT by rule** (18 unlabelled) |
| The other 26 phrasings | — | unchanged, apart from the H1 HVAC matched +3 / +2 |
| `check_expert` Eric-Direct not retrieved | 7 | **2** (only the inactive nursing notice) |
| Eric-Direct in top 20 | 10 | 9 (KNOB leaves the short top 20) |
| Eric Not-relevant in top 20 | 0 | 0 |

**Product concern, for Eric:** with about 5,500 matched notices, the 500-row deadline window spans **only Nov 15–16**. A
parts customer sees the soonest-closing NSN buys, i.e. those closing within a day. Eric's three parts notices are retrieved
but sit beyond the window. If that is not what he wants, the next lever is the window, not the label. Options (none built):
- a per-FSC cap;
- a later-deadline sample;
- a minimum lead time.
