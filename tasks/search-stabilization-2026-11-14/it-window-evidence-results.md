# IT window evidence (A, C) and combined with the long-list guard: results (2026-11-15)

Agent 3. All development only: nothing is tagged, deployed or flagged.

| branch | head | contents |
|---|---|---|
| agent3/it-window-evidence | A df15df2d7, C 3158a994e (+ timing harness) | A and C as separate commits |
| agent3/long-list-family-guard | 38cd537ad | guard only |
| agent3/rc3-guard-window | this branch | RC3 preview + A + C + guard |

## What each change does

- **A — code-recall sub-window.**
  - Applies to product presets only, and only when the 500-row deadline window is full.
  - Draws the preset's own coded notices separately: same plan, same stage, AND `psc_code IN` the codes, capped at 200.
    These rows are appended after the window.
  - They are already in the matched set, so matched sets and counts are unchanged. A failed sub-query falls back to
    today's window.
- **C — DLA computer-hardware nouns in the strict IT vocabulary.**
  - Adds disk drive, display unit, interface unit, panel pc, drive assy.
  - Each noun appears in ≤12 open titles. DIRECT still requires a 7x PSC.
  - The vocabulary also retrieves by title, so IT matched sets grow by 11 (544 → 555, 1,584 → 1,595). No other business
    changes.

## Fidelity

- **Route parity** (route-parity.mts: the real findOpportunities, same snapshot, fake client): 28/28 identical on count,
  window (including the code sub-window rows), top-20 order and classes, for A, A+C and the combined branch.
- **Runner:** runner 1.1.0 still reproduces RC1 and RC2 against the published matched sets (28/28) and RC3 unchanged.

## Effect on candidates (Nov 14 snapshot)

Product phrasings whose 500-row window was full, with the code sub-window rows A added:

| phrasing | rows A added |
|---|---|
| ithardware #1 | 58 |
| ithardware #0 | 9 |
| electrical #0 / #1 | 145 / 142 |
| valves #0 / #1 | 75 / 157 |
| aircraft #1 | 58 |
| medical #1 | 42 |
| fasteners #1 | 21 |

The remaining 19 phrasings get no sub-query.

DIRECT matches in the top 20:

| phrasing | RC3 | A | A+C |
|---|---|---|---|
| IT long | 1 | 11 | **20** |
| IT short | 8 | 11 | **20** |
| medical long | 11 | 17 | 17 |

IT long top 20 under A+C:
- 20 hardware rows in 7x codes: servers, keyboards, computers (digital, tablet), panel PCs, disk drives, a monitor, rugged
  laptops, interface units.
- One row ("NRP,KEYBOARD,DATA E") is labelled NO by both reviewers in Agent 3's labels.
- "INTERFACE UNIT" rows may be avionics data units. They need Agent 4's v7 labels.

## Agent 3's labels (v4–v6; directional only)

Many new rows are unlabelled. Agent 4's v7 labels decide.

- Full table, RC2 / RC3 / guard / A+C / combined, raw and distinct: `score-all` below.
- Labelled-relevant drops under A on valves long (15 → 10), aircraft long (2 → 1) and medical long (10 → 9) are
  coverage, not demonstrated losses:
  - **valves long:** every top-20 row is still a valve item (DIRECT). A brought in 14 distinct DLA "PARTS KIT,BALL VALV"
    solicitations, mostly unlabelled.
  - **aircraft long:** A alone lets hydraulic dispensing units and a PBL notice in. The combined branch (with the guard)
    removes them: back to 3/4 labelled relevant.
- **Diversity note:** in valves long the "PARTS KIT,BALL VALV" title appears 14× (distinct solicitation numbers, same
  item), which raises a question for the top-20 rule (distinct solicitations vs distinct items).

## Cost of A on a live surface

- **Extra database work:** one more SELECT, only for product-preset searches whose deadline window is full. That was 9
  of the 28 benchmark phrasings.
  - The query is the same plan with `psc_code IN (≤20 codes)`, ordered by deadline, LIMIT 200.
  - No count, and no extra query for any other search.
- **Extra rows:** up to 200 more candidates are labelled and ranked in memory, for 700 at most instead of 500.
- **Latency, measured 2026-11-15** on production `sam_opportunities`: read-only SELECTs, sequential, median of 3,
  `harness/code-window-timing.mts`.
  - The earlier "Invalid API key" was the `.env.local` gotcha (values quoted, ending in a literal `\\n`). The key was
    never rotated.

  | phrasing | main window query (count + 500 rows) | code sub-window query |
  |---|---|---|
  | electrical #0 | 2,160 ms | **+842 ms** (200 rows) |
  | valves #0 | 1,883 ms | **+935 ms** (200 rows) |
  | valves #1 | 7,732 ms | **+1,098 ms** (200 rows) |
  | aircraft #0 | 2,294 ms | **+725 ms** (200 rows) |
  | IT short | 3,878 ms | **+642 ms** (77 rows) |
  | fasteners #0, medical #0 | 5,541 / 4,276 ms | window not full live (400 / 134 rows), so no sub-query |
  | long: fasteners, electrical, aircraft, medical, IT | statement timeout (8 s) | not reached: the main query fails first and FIND returns `search_too_long` |

- **Reading the timing:**
  - When it fires, A adds **0.6–1.1 s** of sequential DB time to a FIND Open call.
  - On today's production, the long product phrasings that most need A already time out on the main query. A cannot
    help them until long queries are served (the cached open retrieval, flag off).
  - The live corpus has moved since the Nov 14 snapshot, so which phrasings trigger A differs slightly.
- **Cheaper variant (not built):** the sub-query re-applies the whole text plan, and the text OR is the expensive part.
  The structural filters plus `psc_code IN codes`, without the text OR, select the same rows, because preset-code recall
  is already a branch of that OR. That should cost a fraction. It needs its own parity proof before use.

## score-all (raw lo-hi/labelled; dist relevant/labelled of distinct, top 20)

```text
phrasing       rc2-1                         rc3                           ll-clean                      AC                            combo                         
janitorial#0   raw 10-10/10 dist 9/9of16     raw 9-9/9 dist 9/9of20        raw 9-9/9 dist 9/9of20        raw 9-9/9 dist 9/9of20        raw 9-9/9 dist 9/9of20        
janitorial#1   raw 5-5/6 dist 3/4of11        raw 7-7/8 dist 7/8of20        raw 8-8/8 dist 8/8of20        raw 7-7/8 dist 7/8of20        raw 8-8/8 dist 8/8of20        
nursing#0      raw 0-0/0 dist 0/0of14        raw 1-1/1 dist 1/1of20        raw 1-1/1 dist 1/1of20        raw 1-1/1 dist 1/1of20        raw 1-1/1 dist 1/1of20        
nursing#1      raw 2-2/4 dist 1/2of15        raw 0-0/8 dist 0/8of20        raw 0-0/8 dist 0/8of20        raw 0-0/8 dist 0/8of20        raw 0-0/8 dist 0/8of20        
hvac#0         raw 1-1/1 dist 1/1of15        raw 1-1/1 dist 1/1of20        raw 1-1/1 dist 1/1of20        raw 1-1/1 dist 1/1of20        raw 1-1/1 dist 1/1of20        
hvac#1         raw 7-8/9 dist 7/8of17        raw 6-7/9 dist 7/9of20        raw 6-7/9 dist 7/9of20        raw 6-7/9 dist 7/9of20        raw 6-7/9 dist 7/9of20        
guards#0       raw 7-9/10 dist 5/6of15       raw 3-5/7 dist 5/7of20        raw 3-5/7 dist 5/7of20        raw 3-5/7 dist 5/7of20        raw 3-5/7 dist 5/7of20        
guards#1       raw 8-10/17 dist 6/11of14     raw 4-6/17 dist 6/17of20      raw 4-6/17 dist 6/17of20      raw 4-6/17 dist 6/17of20      raw 4-6/17 dist 6/17of20      
steelbldg#0    raw 1-1/1 dist 1/1of18        raw 6-6/10 dist 6/10of20      raw 6-6/10 dist 6/10of20      raw 6-6/10 dist 6/10of20      raw 6-6/10 dist 6/10of20      
steelbldg#1    raw 1-2/2 dist 1/1of16        raw 3-3/3 dist 3/3of20        raw 4-5/10 dist 5/10of20      raw 3-3/3 dist 3/3of20        raw 4-5/10 dist 5/10of20      
grounds#0      raw 17-17/20 dist 13/15of15   raw 16-17/20 dist 17/20of20   raw 16-17/20 dist 17/20of20   raw 16-17/20 dist 17/20of20   raw 16-17/20 dist 17/20of20   
grounds#1      raw 16-19/19 dist 11/11of12   raw 14-17/19 dist 17/19of20   raw 14-17/19 dist 17/19of20   raw 14-17/19 dist 17/19of20   raw 14-17/19 dist 17/19of20   
paving#0       raw 15-17/20 dist 13/15of15   raw 14-15/17 dist 15/17of20   raw 14-15/17 dist 15/17of20   raw 14-15/17 dist 15/17of20   raw 14-15/17 dist 15/17of20   
paving#1       raw 10-10/10 dist 7/7of16     raw 7-7/7 dist 7/7of20        raw 9-10/10 dist 10/10of20    raw 7-7/7 dist 7/7of20        raw 9-10/10 dist 10/10of20    
parts#0        raw 7-8/20 dist 6/13of13      raw 5-6/15 dist 6/15of20      raw 5-6/15 dist 6/15of20      raw 5-6/15 dist 6/15of20      raw 5-6/15 dist 6/15of20      
parts#1        raw 0-0/1 dist 0/1of13        raw 6-6/7 dist 6/7of20        raw 15-15/17 dist 15/17of20   raw 6-6/7 dist 6/7of20        raw 15-15/17 dist 15/17of20   
fasteners#0    raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   
fasteners#1    raw 10-10/10 dist 10/10of20   raw 10-10/10 dist 10/10of20   raw 10-10/10 dist 10/10of20   raw 15-15/15 dist 15/15of20   raw 15-15/15 dist 15/15of20   
electrical#0   raw 8-8/9 dist 7/8of19        raw 7-7/8 dist 7/8of20        raw 7-7/8 dist 7/8of20        raw 8-8/9 dist 8/9of20        raw 8-8/9 dist 8/9of20        
electrical#1   raw 9-9/9 dist 8/8of19        raw 8-8/8 dist 8/8of20        raw 8-8/8 dist 8/8of20        raw 8-8/8 dist 8/8of20        raw 8-8/8 dist 8/8of20        
valves#0       raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   raw 17-17/17 dist 17/17of20   
valves#1       raw 14-16/18 dist 13/15of16   raw 14-15/17 dist 15/17of20   raw 14-15/17 dist 15/17of20   raw 10-10/10 dist 10/10of20   raw 10-10/10 dist 10/10of20   
aircraft#0     raw 4-4/5 dist 4/5of20        raw 4-4/5 dist 4/5of20        raw 4-4/5 dist 4/5of20        raw 4-4/5 dist 4/5of20        raw 4-4/5 dist 4/5of20        
aircraft#1     raw 3-3/4 dist 2/3of19        raw 2-2/3 dist 2/3of20        raw 3-3/4 dist 3/4of20        raw 1-1/2 dist 1/2of20        raw 3-3/4 dist 3/4of20        
medical#0      raw 10-15/15 dist 13/13of18   raw 10-15/15 dist 15/15of20   raw 10-15/15 dist 15/15of20   raw 10-15/15 dist 15/15of20   raw 10-15/15 dist 15/15of20   
medical#1      raw 7-8/8 dist 8/8of17        raw 7-10/10 dist 10/10of20    raw 8-11/12 dist 11/12of20    raw 9-9/9 dist 9/9of20        raw 10-11/11 dist 11/11of20   
ithardware#0   raw 0-1/3 dist 0/1of13        raw 3-4/5 dist 4/5of20        raw 3-4/5 dist 4/5of20        raw 2-3/4 dist 3/4of20        raw 2-3/4 dist 3/4of20        
ithardware#1   raw 0-1/2 dist 1/2of17        raw 1-1/3 dist 1/3of20        raw 1-1/3 dist 1/3of20        raw 2-3/4 dist 3/4of20        raw 2-3/4 dist 3/4of20        
```
