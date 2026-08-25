# End-to-end chain run #2 — North Star Government Services, MCP surface, 2026-08-25

**Adversarial fixture.** A known-wrong answer from a live session: Mindy had the SABER
evidence, called it *"an Air Force SABER,"* and moved on — missing that **FA4610 =
Vandenberg Space Force Base / Space Launch Delta 30**, which changes the strategy.

**The chain was run BLIND.** No mention of Space Force, Vandenberg, or SABER was given —
only the company and the objective. The question was whether grounded evidence leads there.

## Ground truth (our own data, before asking any tool)

| | |
|---|---|
| entity | `FCJCDUZV7RM3` NORTH STAR GOVERNMENT SERVICES · **Active** · CA · synced today |
| certifications | **8(a), HUBZone, WOSB** |
| NAICS | 12 codes: 236210/236220/237110/237210/237990/238210/238220/238390/238910/238990/561210/562910 |
| SABER task order | `FA461025F0190` · NAICS 236220 · $565,887 · ends 2026-09-08 |
| other award | `N4019225F0154` · $3,298,978 · ends 2027-06-24 |
| FA4610 rows we hold | **103** in `recompete_opportunities`, **72** in `sam_opportunities` |
| `dodaac_directory` FA4610 | **"30 CONS PK"** · 9,064 awards · **$1.51B** obligated |

## Findings

### NS-0 ✅ CHAIN-1's fix proved itself on a second company

`lookup_sam_entity({name:'North Star Government Services'})` hit the empty-success path.
Before #1350 this company would ALSO have been reported as not existing. It reconciled:
`grounded=true, source=local_registry`.

### NS-1 ❌ P1 — the local fallback DISCARDS data the mirror holds

The fallback returned:

    status = "Unknown"    NAICS = (none)    8a/HUBZone/WOSB = undefined

The mirror row actually holds:

    status = "Active"     NAICS = 12 codes  certifications = ["8(a)","HUBZone","WOSB"]

`entity-local-fallback.ts` maps only a subset of columns onto `SAMEntity`, so the
reconciled answer is **strictly worse than the row we stored**. This is not cosmetic:
**8(a) + HUBZone are the two facts that most determine what this company should pursue**,
and a downstream tool asking "is it 8(a)?" gets `undefined` — which is not "no", but will
be read as one.

⚠️ `registrationStatus:'Unknown'` is deliberate in that module (never present cached data as
a live check). Fine for status. **Not fine for NAICS and certifications**, which do not
decay the way a registration date does.

### NS-2 ❌ P1 — the SABER never surfaces as a vehicle

`get_expiring_contracts(236220, 18mo)` returned 50 rows. **Zero were FA4610**, though we
hold 103 FA4610 rows and North Star's own SABER task order is one of them. The chain never
had the chance to reason about the vehicle, because retrieval never surfaced it.

### NS-3 ❌ P0-adjacent — the customer is unknowable from the fields Mindy reads

This is the root of the original wrong answer. For every FA4610 notice:

| field | value |
|---|---|
| `department` | DEPT OF DEFENSE |
| `sub_tier` | **DEPT OF THE AIR FORCE** |
| `office` | **null** |
| `office_address.city` | **VANDENBERG SFB** ← the answer |
| `pop_city` | Lompoc, CA |
| `dodaac_directory.office_name` | **30 CONS PK** (30th Contracting Squadron) |

**Measured: 0 of 72 FA4610 notices mention "SPACE" in department/sub_tier/office.
63 carry pop_city = Lompoc.**

So Mindy calling it "an Air Force SABER" was not a reasoning failure — **it was reading the
only fields it looks at, and those fields say Air Force.** The Space Force identity lives in
`office_address.city` and in the DoDAAC's office name, neither of which the agency-matching
path consults. `dodaac_directory` itself labels FA4610 `sub_agency: Department of the Air
Force` with no Space Force mapping anywhere in 4,825 rows.

⚠️ This is a *correct* legacy artifact — Space Launch Delta 30 was the 30th Space Wing under
the Air Force until USSF stood up — which is exactly why it is dangerous: the data is not
wrong, it is **stale in a way that inverts strategy**.

## Answers to the frozen questions

| question | answer |
|---|---|
| Does Mindy identify the SABER? | **No** — it never surfaced in vehicles or recompetes |
| Does it identify the customer/installation? | **No** — reads `sub_tier` = Air Force |
| Does it treat the vehicle as strategically different? | **No** — never retrieved |
| Does Space Force survive into market/adjacency? | **No** — 0 of 72 notices say SPACE |
| Does the recommendation use the evidence? | **No** — no recommendation exists (CHAIN-3) |
| Does it separate demonstrated from potential? | **No** — no such distinction is modelled |

## Cross-run synthesis — the two fixtures say different things

**Fluidyne:** evidence retrieved, then IGNORED by the decision layer (hop 5 never consumed
hops 2-4; it re-derived the market from free-text keywords).

**North Star:** evidence NEVER RETRIEVED, and where retrieved, **mis-attributed** by fields
that are literally correct but strategically stale.

Together they say CHAIN-3 is not one defect:

1. the decision layer must CONSUME structured upstream evidence (Fluidyne), and
2. the evidence itself must carry the RIGHT CUSTOMER IDENTITY before it is consumed
   (North Star) — otherwise hop 5 will faithfully consume "Air Force" and confidently
   recommend the wrong strategy.

**Fixing #1 without #2 produces a decision layer that is grounded and still wrong.**
