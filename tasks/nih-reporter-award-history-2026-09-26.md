# Funded NIH RePORTER projects = award history, never open opportunities (2026-09-26)

**Rule (Eric):** funded projects must be labeled award/research history and never presented as open
opportunities. Separate from #1710, which retires Mindy's dedicated SBIR search, and from the
precompute-reporting fix. **Stop before merge/deploy.** No stored data, scraper or cron was changed.

## Measurements (production, read-only, 2026-09-26)

| source / opportunity_type / status | rows |
|---|---|
| nih_reporter / grant / active | **1,474** |
| nih_reporter / sbir_sttr / active | **42** |
| grants_gov / grant / active | 57 |
| grants_gov / baa / active | 6 |
| darpa_baa / baa / active | 6 |
| **table total** | 1,585 |

- **nih_reporter rows with a `reporter.nih.gov/project-details/` URL: 1,516.** That is every one of them.
- **nih_reporter rows with `close_date >= today`: 1,487, all `status='active'`.** These are funded
  projects that look like open opportunities with a deadline.
- **The writer** (`src/lib/scrapers/apis/nih-reporter.ts`, via `snapshot-multisite`; the
  `snapshot-multisite-nih` cron is enabled, the darpa/nsf crons are disabled) maps
  `closeDate: project.budget_end` and `status: project.is_active ? 'active' : 'archived'`. So
  `close_date` is the **project end** and `active` means "project running", not "open for
  proposals".

## Every consumer of `aggregated_opportunities`

| Consumer | What it reads | User-facing? | Presented as open? (before) | This PR |
|---|---|---|---|---|
| `src/lib/briefings/pipelines/multisite.ts` `fetchMultisiteOpportunities` (shared) | all sources unless filtered | via callers | yes: rows mapped with `closeDate` | **Award-history sources excluded by default inside the query.** Every row is labeled `recordKind`; award rows carry `projectEndDate`, never `closeDate`. A caller must ask for `nih_reporter` explicitly to get them, and then they come labeled |
| AI briefing generator (`ai-briefing-generator.ts` → the above; **active nightly** via `precompute-briefings`) | last 30 days, limit 25 | briefings (LLM prompt: "MULTISITE OPPORTUNITIES … R&D opportunity") | **yes** — a live run showed all 25 rows were nih_reporter grants | covered by the pipeline default (no edit to the generator) |
| `fetchMultisiteForUser`, `getMultisiteStats` (same file) | — | no callers found | — | the mapping label applies if they are ever used |
| `/api/market-scan` `fetchSbirOpportunities` | `nih_reporter`, `nsf_sbir`, `sbir_gov` | public GET (no UI caller) | **yes**: NIH rows as `sbirOpportunities` with `daysUntilClose` | `nih_reporter` removed from the source list |
| `/api/sbir` (in-app SBIR panel) | NIH RePORTER live + the multisite `sbir_sttr` slice | `/briefings` SBIR panel | **yes** | **not edited here.** Retired entirely by **#1710** (410); editing it here would conflict with #1710's rewrite |
| `src/lib/sbir/search.ts` | NIH + the multisite `sbir_sttr` slice | only via MCP `search_sbir` | yes | **not edited here.** Its only caller is retired/unregistered by **#1710** |
| `/api/admin/data-inventory` | counts by source/type | admin only | no (counts) | unchanged. Note: the admin label "Research & Lab Funding Opportunities" counts funded projects; flagged, not changed |
| `/api/admin/tool-health` | `source, created_at` for scrape health | admin only | no | unchanged |
| `src/lib/data-core/specialty-advancement.ts` | per-source advancement | monitoring | no | unchanged |
| `/api/cron/snapshot-multisite` | **writer** (insert/update) | — | — | unchanged (no scraper/write change) |

**Not consumers**, checked:
- the SEO `/opportunity/[slug]` pages read `sam_opportunities` only;
- the Grants panel / MCP `search_grants` read Grants.gov (`grants_cache` / live), not this table;
- the Opportunity Map reads SAM/DIBBS/forecast/grants sources;
- the chat/MCP tool registry has no multisite reader.

**Dependency on #1710:** two consumers (`/api/sbir`, `src/lib/sbir/search.ts`) remain wrong on
`main` until #1710 merges, because #1710 retires them. If #1710 were abandoned, both would need this
rule applied.

## Tests (behavioural; only I/O faked)

- `src/lib/research/award-history.unit.test.ts` (4):
  - **classifier:** `nih_reporter` and project-details URLs → award history; Grants.gov/DARPA →
    opportunity;
  - **pipeline:** the real `fetchMultisiteOpportunities` over an in-memory table (NIH grant + NIH
    SBIR, both active with future end dates; an open Grants.gov grant; a DARPA BAA). The default
    fetch returns only the two open rows, with real deadlines intact;
  - **control:** explicitly asking for `nih_reporter` shows the fixture rows are fetchable, and they
    come labeled `award_history` with no `closeDate`;
  - **AI briefing generator end to end:** the real generator runs, and the **LLM prompt** contains
    the open rows and never a funded NIH title.
- `src/app/api/market-scan/award-history.unit.test.ts` (1): the **real GET handler** returns the NSF
  solicitation and never the funded NIH project, in both `sbirOpportunities` and
  `rankedOpportunities`.
- **Mutation proof:**
  - removing the pipeline's default exclusion turns 2 tests red (pipeline and generator prompt);
  - letting award rows keep `closeDate` turns 1 red;
  - restoring market-scan's pre-fix source list turns its test red;
  - all restored → green.

## Expected merge interaction with #1710

- `src/lib/briefings/pipelines/multisite.ts`: #1710 adds an `excludeOpportunityTypes` block after the
  `opportunityTypes` filter. This PR adds its block after the **source** filters and edits the row
  mapping. Different hunks, so no textual conflict is expected; `git merge-tree` result recorded in
  the PR.
- `src/app/api/market-scan/route.ts`: #1710 edits `includeSbir`, the response `sbir` field and one
  import line. This PR edits the source list inside `fetchSbirOpportunities` and adds one import. The
  adjacent import lines may conflict trivially: keep both imports.
- **No edits** to `ai-briefing-generator.ts`, `src/lib/scrapers/types.ts`, `/api/sbir` or
  `src/lib/sbir/*`. Those are the files #1710 owns.

## Left unresolved (out of scope)

- The admin data-inventory label calls funded projects "Funding Opportunities".
- The in-app Grants/Research surfaces were not changed. They don't read this table.
