# Canonical Discovery — Phase B: MCP `find_opportunities` on the seam (2026-09-22)

**Scope:** MCP only. Maps, saved searches, daily alerts and client behaviour are untouched.
Phase A record: `tasks/canonical-discovery-phase-a-2026-09-22.md`.

> Discovery determines meaning/eligibility → surface policy determines eligible horizons/scope → ranking determines order.

## 1. What changed in MCP

`src/lib/opportunities/find-opportunities.ts` no longer interprets queries. Its ~500 lines of
per-horizon query construction (search brain, openCandidateOrExpr, keywordOrExpr, substring
agencyOrExpr, inline recompete/forecast interpretation) are replaced by:

```
FindOpportunitiesInput → mcpDiscoveryInput() + mcpDiscoveryPolicy() → buildDiscoveryPlan()
  → applyOpenPlan / applyRecompetePlan / applyForecastPlan → MCP surface layer
```

**MCP surface policy PRESERVED (explicit, not semantics):** Open fetch cap (500, deadline-ordered
window); recompete soonest-ending first with the related-market 200-row window; forecast
soonest-award ordering; evidence classes DIRECT_MATCH / RELATED_MARKET_CANDIDATE and the cyber
physical-security exclusion; forecast publisher coverage → `unavailable`, never zero; handoffs,
host rules, presentation, `_next`.

**Ranking:** evidence tier (MCP) → canonical breadth (eligible concepts matched) → score → the
surface's date order.

**New on the result:** `_meta.discovery` (plan version, status, eligibility) and, for a request that
cannot define a market (exclusion-only / nothing searchable), `needs_positive_scope` /
`needs_refinement` on every horizon with `_meta.billing_outcome = nonbillable_invalid_input`
(the #1631 hook) — never charged, never presented as zero.

## 2. Three regressions the replay caught — fixed structurally, not labelled away

| found | measured | fix |
|---|---|---|
| Buyer-only / NAICS-only / set-aside-only queries labelled WEAK_NON_MARKET ("does not establish this market") | "veterans affairs" 280 DIRECT → 0 | A plan with no text concept: every admitted row IS the market → DIRECT. Non-cyber text query satisfied in VISIBLE text → DIRECT. Cyber labelling unchanged. |
| "cyber" stopped matching "cybersecurity" under word boundaries | 249 open notices say cybersecurity, 25 say cyber | `cybersecurity` concept (forms cybersecurity / cyber security / cyber) — mirrors MCP's own CYBER_DIRECT_RE |
| IT / AI acronyms matched the pronoun "it" | VA forecast descriptions: `\mit\M` 118 vs `\mIT\M` 68 | Explicit acronyms (IT, AI, ML, HR, QA) match case-sensitively (PostgREST `match`); words/phrases stay `imatch`; exclusion NULL-safe over both |

## 3. Old MCP vs canonical MCP — full fixture replay (shipped library, no hosted credits)

Old = the production `find-opportunities.ts` (verified byte-identical to origin/main) on a detached
worktree. New = this branch. `scripts/mcp-find-replay.ts` (normalized identities, ordered top-10,
evidence) → `scripts/mcp-find-replay-diff.ts` (**exits 1 on any unclassified change**). One transient
DB failure in the first old run was re-captured (retry built into the replay); both final snapshots
have 0 `query_failed` horizons.

**Result: 28 fixtures · 18 bug corrections · 7 intentional canonical changes · 3 unchanged ·
0 unexplained · 0 unexpected regressions.**

| fixture | class | changes (status/matched, top-10 identity overlap, evidence) | evidence for the class |
|---|---|---|---|
| 5413 | bug_correction | open_now grounded/162→grounded/162 top-10 shared 10 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":162,"RELATED_MARKET_CANDIDATE":0} | Evidence labels only: structured NAICS rows were labelled WEAK_NON_MARKET; now DIRECT (162/162). Same rows, same order. |
| 541320 | unchanged | — | — |
| pam | bug_correction | open_now grounded/37→grounded/11 top-10 shared 2<br>coming_back grounded/5→empty/0 top-5 shared 0 · ev {"DIRECT_MATCH":5,"RELATED_MARKET_CANDIDATE":0}→null<br>coming_soon grounded/21→grounded/10 top-10 shared 7 | Old %pam% substring (Pamunkey, Pamela, IPAM, camera specs). 26 dropped Open rows: none contain the word PAM. |
| ai governance | bug_correction | open_now grounded/5067→grounded/10 top-10 shared 0 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":2,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon grounded/3→grounded/13 top-10 shared 3 | Old %ai% substring (m-ai-ntenance, rep-ai-r) → 5,067 Open. Canonical: AI ∧ governance, word-bounded → 10. |
| artificial intelligence governance | bug_correction | open_now grounded/157→grounded/10 top-10 shared 2 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":2,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon empty/0→grounded/13 top-10 shared 0 | Old token-OR matched "intelligence"/"governance" boilerplate; now identical to "ai governance". Forecast 0→13 (old phrase ILIKE missed "AI Governance"). |
| cybersecurity | bug_correction | open_now grounded/361→grounded/417 top-10 shared 2 · ev {"DIRECT_MATCH":270,"RELATED_MARKET_CANDIDATE":9}→{"DIRECT_MATCH":287,"RELATED_MARKET_CANDIDATE":9}<br>coming_back grounded/16234→grounded/15688 top-10 shared 10 · ev {"DIRECT_MATCH":48,"RELATED_MARKET_CANDIDATE":149}→{"DIRECT_MATCH":50,"RELATED_MARKET_CANDIDATE":149}<br>coming_soon grounded/170→grounded/286 top-10 shared 5 | Recompete −546 = MCP SIEM→SIEMENS substring removed. Open +56 / Forecast +116 = "cyber"/"cyber security" forms of the one cyber concept (MCP CYBER_DIRECT_RE). 0 old Open rows dropped. |
| janitorial | intentional_canonical_change | open_now grounded/116→grounded/116 top-10 shared 2 | Identical Open set (116/116, 0 dropped); top-10 re-ranked so text hits ("NRS St Paul Janitorial") precede NAICS-only hits. |
| market research | bug_correction | open_now grounded/933→grounded/465 top-10 shared 1 · ev {"DIRECT_MATCH":172,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":428,"RELATED_MARKET_CANDIDATE":0}<br>coming_back empty/0→grounded/4 top-4 shared 0 · ev null→{"DIRECT_MATCH":4,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon grounded/40→grounded/62 top-10 shared 9 | Old token-OR: any "market" or "research" → 933. Canonical requires both qualifiers → 465; recompete +4 via "Marketing Research"; forecast +22. |
| zzzxxyyqqq | unchanged | — | — |
| veterans affairs | bug_correction | open_now grounded/723→grounded/386 top-10 shared 9 · ev {"DIRECT_MATCH":280,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":386,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon grounded/695→grounded/1390 top-10 shared 7 | Now a VA buyer filter (was keyword text) → 386 VA notices, all DIRECT (old labeller called them WEAK). Forecast 695→1,390 = VA identity. |
| janitorial + agency=VA | bug_correction | open_now grounded/27→grounded/26 top-10 shared 8 · ev {"DIRECT_MATCH":23,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":22,"RELATED_MARKET_CANDIDATE":0} | VA needle no longer substring-matches; 1 row difference; order by text evidence. |
| janitorial + agency=USDA | bug_correction | open_now grounded/13→grounded/9 top-10 shared 8 · ev {"DIRECT_MATCH":13,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":9,"RELATED_MARKET_CANDIDATE":0}<br>coming_back grounded/487→grounded/172 top-10 shared 3 | Old USDA sibling alias "AG" ⊂ "Defense Logistics AGency" / EPA / Pretrial Services AGency. Recompete 487→172, Open 13→9 — all remaining rows are USDA buyers. |
| management | intentional_canonical_change | open_now grounded/1628→grounded/1628 top-10 shared 1<br>coming_back grounded/4511→grounded/4510 top-10 shared 10<br>coming_soon grounded/2207→grounded/2203 top-10 shared 10 | Same Open set; ranking by breadth/position. Recompete −1 / Forecast −4 = "management" inside a longer word (substring → word-bounded). |
| drones | bug_correction | open_now grounded/69→grounded/59 top-10 shared 3 · ev {"DIRECT_MATCH":2,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":35,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon grounded/5→grounded/52 top-10 shared 2 | Open −10: all matched "uas" inside "q-uas-i-religious". Forecast 5→52: term-of-art aliases (drone, UAS, unmanned aircraft) now apply to forecasts too. |
| "ai governance" | bug_correction | open_now grounded/2→grounded/2 top-2 shared 0<br>coming_soon empty/0→grounded/3 top-3 shared 0 | Old treated quotes as characters (HVAC, Blast Shield). Now an exact phrase: Open 2 genuine, Forecast 0→3 incl. "AI Governance - RFI". |
| 8a | bug_correction | open_now grounded/47→grounded/47 top-10 shared 10 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":47,"RELATED_MARKET_CANDIDATE":0} | Evidence labels only: set-aside-only rows were labelled WEAK_NON_MARKET; now DIRECT (47/47). Same rows, same order, same counts on every horizon. |
| follow-on support | intentional_canonical_change | open_now grounded/88→grounded/98 top-10 shared 6 · ev {"DIRECT_MATCH":28,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":45,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon empty/0→grounded/421 top-10 shared 0 | Hyphenated compound is one unit; "support" is a shared stop word. Forecast 0→421 (old whole-phrase ILIKE found none). Known breadth: follow-on alone admits. |
| Show me USDA opportunities | bug_correction | open_now grounded/5522→grounded/218 top-10 shared 0 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":218,"RELATED_MARKET_CANDIDATE":0}<br>coming_back empty/0→grounded/4602 top-10 shared 0 · ev null→{"DIRECT_MATCH":10,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon empty/0→grounded/5028 top-10 shared 0 | Structured agency intent: 5,522 → 218 USDA notices (was %me% substring). Recompete/Forecast now return USDA (4,602 / 5,028) instead of empty. |
| SDVOSB cybersecurity opportunities in Virginia | bug_correction | open_now grounded/318→empty/0 top-10 shared 0 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→null<br>coming_back grounded/30→grounded/145 top-10 shared 2 · ev {"DIRECT_MATCH":28,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":5,"RELATED_MARKET_CANDIDATE":140}<br>coming_soon grounded/312→grounded/1 top-10 shared 0 | Old resolved the WHOLE query as a set-aside and ignored cyber + Virginia. Now SDVOSB ∧ VA ∧ cyber: Open 0 (true empty: pairs 19/5/64), Recompete 145 (5 direct, 140 related IT), Forecast 1. |
| cyber cloud compliance network server | intentional_canonical_change | open_now grounded/1521→grounded/528 top-10 shared 1 · ev {"DIRECT_MATCH":68,"RELATED_MARKET_CANDIDATE":13}→{"DIRECT_MATCH":272,"RELATED_MARKET_CANDIDATE":21}<br>coming_back grounded/16234→grounded/15688 top-10 shared 10 · ev {"DIRECT_MATCH":48,"RELATED_MARKET_CANDIDATE":149}→{"DIRECT_MATCH":50,"RELATED_MARKET_CANDIDATE":149}<br>coming_soon empty/0→grounded/719 top-10 shared 0 | Capability list (decision 2): ANY of cybersecurity/cloud/server admits; compliance/network rank only. Open 1,521 → 528, DIRECT 68 → 272. Forecast 0→719 (old phrase ILIKE). |
| cyber, cloud | intentional_canonical_change | open_now grounded/487→grounded/459 top-10 shared 1 · ev {"DIRECT_MATCH":287,"RELATED_MARKET_CANDIDATE":17}→{"DIRECT_MATCH":287,"RELATED_MARKET_CANDIDATE":15}<br>coming_back grounded/16234→grounded/15688 top-10 shared 10 · ev {"DIRECT_MATCH":48,"RELATED_MARKET_CANDIDATE":149}→{"DIRECT_MATCH":50,"RELATED_MARKET_CANDIDATE":149}<br>coming_soon grounded/599→grounded/551 top-10 shared 4 | Explicit alternatives (decision 2): cybersecurity OR cloud, word-bounded ∪ cyber taxonomy. Open 487 → 459. |
| janitorial or landscaping | intentional_canonical_change | open_now grounded/140→grounded/140 top-10 shared 2 · ev {"DIRECT_MATCH":96,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":115,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon empty/0→grounded/350 top-10 shared 0 | "or" = alternatives; same Open count (140), re-ranked; Forecast 0→350 (old whole-phrase ILIKE). |
| Pro Audio | bug_correction | open_now grounded/4500→grounded/84 top-10 shared 0 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":39,"RELATED_MARKET_CANDIDATE":0}<br>coming_back empty/0→grounded/6 top-6 shared 0 · ev null→{"DIRECT_MATCH":6,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon empty/0→grounded/85 top-10 shared 0 | Old %pro% substring → 4,500. Now audio admits, "pro" ranks: 84 Open; recompete/forecast now searched word-bounded. |
| 541512 -computers | bug_correction | open_now grounded/5→grounded/13 top-10 shared 0 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":13,"RELATED_MARKET_CANDIDATE":0}<br>coming_back empty/0→grounded/4267 top-10 shared 0 · ev null→{"DIRECT_MATCH":10,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon empty/0→grounded/287 top-10 shared 0 | Old searched the literal text "541512 -computers" (5). Now NAICS 541512 minus notices mentioning computers (13); recompete 4,267, forecast 287. |
| -computers | intentional_canonical_change | open_now empty/0→unavailable/null(needs_positive_scope) top-0 shared 0<br>coming_back empty/0→unavailable/null(needs_positive_scope) top-0 shared 0<br>coming_soon empty/0→unavailable/null(needs_positive_scope) top-0 shared 0 | Decision 5: exclusion-only query → needs_positive_scope on every horizon, billing_outcome nonbillable_invalid_input (old: three empty horizons, charged). |
| Naval facilities in Nevada | bug_correction | open_now grounded/1311→empty/0 top-10 shared 0 · ev {"DIRECT_MATCH":0,"RELATED_MARKET_CANDIDATE":0}→null | State NV extracted; naval ∧ facilities in NV = 0 (true empty: naval 533, NV 24). Old: token-OR 1,311. |
| cybersecurity + agency=SOCOM | unchanged | — | — |
| IT services + location=VA | bug_correction | open_now grounded/837→grounded/45 top-10 shared 4 · ev {"DIRECT_MATCH":9,"RELATED_MARKET_CANDIDATE":0}→{"DIRECT_MATCH":25,"RELATED_MARKET_CANDIDATE":0}<br>coming_soon grounded/8→grounded/93 top-10 shared 2 | Old: %it% substring → 837. Now the IT concept (acronym case-sensitive — the pronoun "it" excluded) ∪ IT taxonomy in VA → 45; Forecast 8 → 93. |

**Dropped-row audit (what MCP no longer returns, Open, full ID sets):** cybersecurity 0 dropped (+56);
janitorial / management identical sets (order only); pam 26 dropped — none contain the word PAM;
drones 10 dropped — all "q**uas**i-religious"; market research 468 dropped — none carry both words
word-bounded. Recompete/forecast "management" −1/−4: "DATA**MANAGEMENT**", "…management**control**…",
"QUALITAETS**MANAGEMENT**" (glued words — a known false-negative class, see §5).

## 4. Required proofs

| proof | evidence |
|---|---|
| ai governance has no AI-substring pollution | Open 5,067 → 10; no `ilike.%ai%` anywhere in the plan (test); acronym clause is case-sensitive `match` |
| artificial intelligence governance ≡ ai governance | identical plans on all horizons (test); identical MCP Open/Forecast sets (replay) |
| USDA ≠ DLA via "AG" | janitorial + USDA recompete 487 → 172; old-only rows EPA / Pretrial Services / DLA "…AGency"; USDA buyer test |
| VA ≠ Naval / Nevada | whole-word identity test; "Naval facilities in Nevada" → state NV, no VA buyer |
| janitorial uses canonical industry interpretation | recompete 5,323 via preset NAICS 561210/561720/561730 + 18 mo (unchanged count, now from the plan) |
| cybersecurity eliminates SIEM→SIEMENS | recompete 16,234 → 15,688 (the −546 are SIEMENS-substring rows) |
| capability lists: distinctive eligibility + breadth ranking | "cyber cloud compliance network server": ANY(cybersecurity·cloud·server), compliance/network rank-only; DIRECT 68 → 272 |
| explicit OR / comma alternatives | "cyber, cloud" and "janitorial or landscaping" → 2 alternatives (tests + replay) |
| exclusions require positive scope | "-computers" → needs_positive_scope ×3, nonbillable; "541512 -computers" valid (13) |
| nonsense fails closed | zzzxxyyqqq unchanged 0/0/0 |
| current/future forecast policy | MCP default excludes past FY; `timeframe.forecast_include_past` is the only opt-in (gate test: timeframe changes policy, never meaning) |

## 5. Known limitations (unchanged by design, recorded)
- Body co-occurrence: required words may sit far apart in a long SOW (Phase A §4).
- Glued words / typos are literal: "DATAMANAGEMENT", "janitoral" do not match.
- "follow-on support": "support" is a shared stop word, so follow-on alone admits (forecast 421).
- Recompete ranking only reorders the fetched window (MCP's existing soonest-ending cap).

## 6. Cross-surface query-plan CI gate (before Maps moves)
`src/lib/discovery/cross-surface-plan.unit.test.ts` — registered surfaces (MCP migrated; Maps Open /
Recompete / Forecast, saved searches, daily alerts `pending` as explicit todos). Asserts: MCP executes
exactly the canonical plan for every fixture; MCP timeframe args change policy only; every migrated
surface's MEANING equals MCP's; MCP's module cannot re-import a legacy matcher. **Proven:** dropping MCP's
agency argument → red; re-importing buildSearchOr → red; revert → green.

## 7. Hosted acceptance (production) — small set, after deploy

Production proven to serve the change: `maps-account-build` stamp = **`f3a51f5a`** (the #1639 merge), confirmed by
`git merge-base --is-ancestor`. Then 4 hosted `find_opportunities` calls via the Mindy connector (40 credits budgeted;
balance read with the free `get_balance` before and after).

| call | hosted result | = replay? |
|---|---|---|
| `-computers` | needs_positive_scope on all 3 horizons; `billing_outcome: nonbillable_invalid_input`; **charged 0** | yes |
| `ai governance` | Open 10 (2 DIRECT) · Recompete 0 · Forecast 13, top = "AI Governance - RFI (VA-26-00070202)"; eligibility `ALL(artificial intelligence · governance)` | yes |
| `janitorial` + agency `USDA` | Open 9 · Recompete 172 · Forecast 37 — every buyer a USDA component (Forest Service, ARS, OCFO); no DLA / EPA / Pretrial | yes |
| `cyber cloud compliance network server` | Open 528 (272 direct · 21 related) · Recompete 15,688 (50 direct · 149 related, split in the host note) · Forecast 719; `ANY(cybersecurity · cloud · server) rank-only(compliance · network)` | yes |

Credits: 38,943 → 38,913 = **30 for 3 billable calls; the exclusion-only call was not charged.**

Observed live (pre-existing, recorded): for Andre's list, DLA part notices ("SERVER,AUTOMATIC DA") rank near the
top because DLA descriptions carry cybersecurity clause boilerplate, which MCP's unchanged cyber labeller reads as
DIRECT. Same body-boilerplate class as §5 — a labeller/proximity follow-up, not a Phase B regression.

**Phase B stops here.** Next (not started): Maps Open onto the seam, gated by the cross-surface test.
