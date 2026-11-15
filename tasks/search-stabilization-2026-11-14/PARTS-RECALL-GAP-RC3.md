# Parts: remaining recall gap at RC3 (diagnostic)

Written 2026-11-15 by Agent 3. Development data only (Nov 14 snapshot, 9,701 open notices). Nothing from the sealed holdout.
RC3 = `5c5098165` (`agent3/rc3-candidate`, to be tagged `search-rc3-2026-11-15`). This note changes no code.

> **Correction.** An earlier report cited "25 missed replacement-parts notices". That figure was wrong; it does not appear in Agent 4's data. The measured figures are below.

## The finding

Parts notices **not retrieved** at `5c5098165` that **both AI reviewers called relevant**:

| query | not retrieved (notices) | distinct solicitations | matched-set size |
|---|---|---|---|
| short — "We supply industrial and defense replacement parts." | **29** | 29 | 1,265 |
| long — the NSN / spare-parts sentence | **20** | 18 | 1,759 |

The two lists do not overlap (49 notices in total).

**AI labels; diagnostic only.** These counts use the two AI reviewers' labels, not human labels. They are not a holdout score.

## What is and isn't a gap

- The labelled pool holds **88** relevant parts notices, more than the 20 top-20 slots. Some relevant notices fall outside the top 20 only because there are 20 slots. That is **not** a recall gap and is not counted here.
- The gap is only the notices above: relevant, but **never retrieved** (outside the matched set), so ranking never saw them.

## What the missed notices look like (observation, not a fix)

- Mostly DLA catalog buys named by the item alone: `PARTS KIT,BALL VALV`, `STEM,FLUID VALVE`, `CIRCUIT CARD ASSEMB`, `GOVERNOR,MOTOR`. Only 5 of 29 short titles and 8 of 20 long titles contain the word "part".
- They spread across many FSC groups: 48 valves, 53 hardware, 25 vehicle parts, 16 aircraft parts, 59 electronics, 61 electrical, and others. The `parts` preset has no code floor (`queries_v4.json`: `psc: []`), so retrieval relies on text, and these titles don't carry the text.
- Several missed short-query notices (the ball-valve kits) are identical items under separate solicitations. They count separately under the distinct-solicitation rule; see the duplicate-item concentration reporting.

Any fix (for example an FSC floor for "replacement parts") is out of scope for RC3 and would go on a new branch with Eric's approval. RC3 and the other frozen versions stay as they are.

## Source

- IDs: Agent 4, counted fresh against `5c5098165` (Nov 14 dev fixture), file `parts_not_retrieved_rc3.json`.
- Titles, PSC and solicitation numbers: joined by Agent 3 from the same Nov 14 snapshot (all 49 found).

## Short query: 29 not retrieved

| notice_id | solicitation | PSC | title |
|---|---|---|---|
| `fe965536149443c8bd48a403a062c486` | SPE4A727R0018-Synopsis | 1440 | LINEAR ELECTRO-MECHANICAL ACTUATOR / 01F, LGM-30 MINUTEMAN III MISSILE |
| `b27a887dab6c49a9b2ece51216a02f54` | 70Z03827QH0000001 | 1620 | Procurement of Gearbox Assemblies for HC-130J Aircraft |
| `e9593fe32ac74724ad5780fe7d2a55fc` | SPRPA127QUA01 | 1660 | 16--CYLINDER AND VALVE |
| `9a779cde2b6d4a3798540a7b1a4e6fcb` | SPRPA126QUB80 | 1660 | 16--CYLINDER ASSEMBLY,O |
| `2a0c7ef1616146218d5f47645251f673` | SPE7L327T1945 | 25 | 25--DOOR,HATCH,VEHICLE |
| `85c770493ba14feb98f04a0e554387b4` | SPE7L327T2424 | 25 | 25--TURRET,COMBAT VEHICLE |
| `60e1e09344be4c6899f6efb8a9ab3737` | SPE7L327T1785 | 25 | 25--WINCH,DRUM,VEHICLE MOU |
| `fa2582e7e2bc4ea395e92850134a791a` | SPE7L127R0028 | 2541 | ARMOR,TRANSPARENT,VEHICULAR WINDOW |
| `e552b5583bcb45df94e1c4cbc57babc2` | N0010426QNE10 | 2915 | VALVE,PRESS REDUCIN |
| `3c462fb17ce14ad199a7565c9555aaf0` | N0010426QFG27 | 3655 | 36--CANISTER |
| `1a15df6e93a542338e599374feab54a2` | N0010427RBA33 | 4720 | 47--HOSE ASSEMBLY,METAL |
| `a9c0266b04a34de697def0965a69d467` | N0010427RBB93 | 4820 | 48--VALVE, BUTTERFLY |
| `91cce0f6f08e4a1eb7199523f6c7d6d6` | N0010426QNF04 | 4820 | CAP,VALVE |
| `1f05ff1cadc34328a761cb215f176e25` | N0010426QNE11 | 4820 | DISK,VALVE |
| `002f6c74feb54d31abd3b598f4b40e82` | N0010426QNE86 | 4820 | PARTS KIT,BALL VALV |
| `1982d0e91da74a809a7d05d345fc20ef` | N0010426QND25 | 4820 | PARTS KIT,BALL VALV |
| `7eea07e258df4a119d6495ad668a7705` | N0010426QNE95 | 4820 | PARTS KIT,BALL VALV |
| `8667dddeab5f403497277ff9ea38e819` | N0010426QNE93 | 4820 | PARTS KIT,BALL VALV |
| `dce53b7fd4354a5884c060fea3bb7ee4` | N0010426QNE24 | 4820 | PARTS KIT,BALL VALV |
| `1e275772db4c46798ec37879cfff315f` | N0010426QNE89 | 4820 | STEM,FLUID VALVE |
| `fb1ce0d2c53046fda91b8f663033676f` | N0010426QNE46 | 4820 | STEM,FLUID VALVE |
| `cce02139fdb54c57b2d536917b709682` | N0010426QNE88 | 4820 | TAILPIECE,VALVE |
| `8be91e001f7b4084b0148dd4415d7321` | SPMYM327Q1106 | 5305 | Assorted Cap Screws |
| `6136400fae7943b285c23d28a37b0132` | N0010426QFF94 | 5315 | 53--KEY |
| `c583486e68354a108768085b37f806ae` | SPE7M226R0019 | 5330 | RETAINER, RING, AIRCRAFT |
| `45944e605f994242b53c78215f31a40b` | N6660426Q0430 | 5340 | TAHEF 542 System Components |
| `1e960c05b9714e3aa252d65cb866b86d` | N0010426QFF78 | 5360 | 53--HELICAL SPRING |
| `f8a26aa65b304a9b82e5ef5086f0d825` | N0016427SNC13 | 5845 | N0016422DGP73 P00009 - Sole Source - TR-333 Hydrophone Audio Transformers |
| `aadc7027bb054a49b9d49a53be636308` | SPE4A627R0074 | 6150 | 6150-01-657-8209; YJN; VIRGINIA CLASS SUBMARINE |

## Long query: 20 not retrieved

| notice_id | solicitation | PSC | title |
|---|---|---|---|
| `1f0839f181e24073b5876d97a491fd36` | SPRMM126QHF34 | 1005 | SAFETY MANUAL SWITC |
| `fab0a3b5df3a4b0c898ce325e1fe8508` | SPRMM126QHE15 | 2835 | BLADE,TURBINE ENGIN |
| `6635408bf7984f729108c506c4593309` | IHSSS11132026_HVACRefrigerationPartsEquipmentRefrigerant | 4130 | IHSSS11132026_HVAC/Refrigeration Parts, Equipment & Refrigerant |
| `be74378ed7c645ada955db81c5c9c2c3` | SPRMM127QMA07 | 4320 | PUMP UNIT,ROTARY |
| `a073947a29ed4095bbd038e5c4986d64` | SPRMM126QRA26 | 4810 | 48--ACTUATOR,ELECTRO-ME - AND OTHER REPLACEMENT PARTS |
| `4531250b2a034990b4150ba4352da286` | N0010427QYA54 | 4810 | 48--ACTUATOR,HYDRAULIC-- AND SIMILAR REPLACEMENT PARTS |
| `f4aa5841eb4b425a9bf168f7cb00b164` | N0010427QYA54 | 4810 | 48--ACTUATOR,HYDRAULIC-- AND SIMILAR REPLACEMENT PARTS |
| `797d65459def4a05a6105e77b1747baf` | N0038326QPD07 | 4920 | 16--FIBER OPTIC ADAPTER - AND OTHER REPLACEMENT PARTS |
| `f9f1c4c5a0294638a82653c3969a3fd8` | N0038326QPD07 | 4920 | 16--FIBER OPTIC ADAPTER - AND OTHER REPLACEMENT PARTS |
| `93801680a3964897b19ca75cb80b9555` | N5523627R0009 | 5340 | USS PINCKNEY (DDG-91) Helo Hanger Door Replacement Parts |
| `8fb401257dbe449eba93343847b53aec` | N0038327QPA02 | 5355 | 53--KNOB - AND OTHER REPLACEMENT PARTS |
| `3fb51869f101477bb2b565f6c57ba14c` | N0010427QDA12 | 5821 | AMLCD,19 INCH |
| `e05f5113aa1a4fdba8a31b04586b4467` | SPRMM127QGA23 | 5998 | 59--ISBC VME120 |
| `e8c00a673bbf4358a2ef70acdb73c1f6` | SPRMM126QKG72 | 5998 | CIRCUIT CARD ASSEMB |
| `5e24e766d5a84c5cbda615ed36d0400e` | SPRMM126QHC38 | 5998 | KIT,CCA,CONROLLER |
| `82b866498b4640cc911a7500d2c2b48d` | SPRMM126QGF65 | 5998 | WIRING BD ASSY |
| `24d10129db394d1080f37edd7bead70f` | SPRMM126QKG38 | 6110 | GOVERNOR,MOTOR |
| `2b7b63be931144c8b4d954592d444a80` | SPRMM127QMA01 | 6125 | CHARGER,BATTERY |
| `97b96000143b40d9ab9cbb273813a190` | N0010426QNF23 | 6320 | XMITTER,PRECSIONTRM |
| `8c252d58ec3542e0b56dfbfa2b25ed42` | N0010426QND88 | 6685 | TRANSMITTER,PRESSUR |
