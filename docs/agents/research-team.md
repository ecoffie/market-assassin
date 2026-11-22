# Research analyst team: playbook

A read-only team that studies the federal contracting market from the contractor's side and answers three questions:

1. **Pain points.** What problems do contractors hit, and which ones could be made very easy?
2. **Easiest industries.** Where can a new or small contractor win first (low barriers, high small-business share, simple acquisition)?
3. **Most lucrative industries.** Where is the most money, growing fastest, with the best margins and recurring work?

Root `CLAUDE.md` overrides everything here. The team only researches. It never edits product code, writes to any database, sends email, contacts anyone, or calls a live SAM.gov endpoint (rule 6: Mindy tools and our DB first).

## Roles

| Role | Agent | Job |
|---|---|---|
| Lead | the session that runs it | Sets the question and scope, runs the analysts in parallel, hands results to the editor, saves the report |
| Pain-Point Analyst | `research-pain-points` | Contractor problems, ranked by how often and how much they hurt, and how easy each is to fix |
| Market Analyst | `research-market` | Industries ranked by money: total spend, growth, recompete pipeline, average award size |
| Entry Analyst | `research-entry` | Industries ranked by ease of entry: small-business share, set-asides, competition per award, certifications needed |
| Editor / fact-checker | `research-editor` | Gets only the analysts' outputs. Checks every number against its source, merges, ranks, writes the final report |

## Run order

1. **Scope.** The lead writes one line: the question, the time window (default: last 3 federal fiscal years), and any focus (agency, NAICS range, company size).
2. **Analyze.** Run the three analysts in parallel (one message, three Agent calls). Give each the scope line only.
3. **Edit.** Give `research-editor` the three outputs and the scope line. Nothing else.
4. **Save.** Write the editor's report to `docs/research/YYYY-MM-DD-<slug>.md`. Optionally publish it as an artifact for sharing.

Budget: at most 4 agents per run. No re-runs of an analyst unless the editor marks its section `fail`.

## Evidence rules (all agents)

- Every number has a source: the Mindy tool name + inputs, or a URL + date. No source, no number.
- **Unknown is never zero.** A figure you could not get is "not available", never 0.
- Mindy data beats web data for spending and award numbers. Web (GAO, SBA, FPDS reports, industry surveys, forums, podcasts) is for pain points and context.
- Say the grain: obligations vs. award count vs. transactions. The BigQuery `awards` table is transaction grain.
- Historical spend is not a forecast. Label any forward claim as an estimate and say what it rests on.
- No customer names, emails or private data. This repo is public.

## Industry output shape (Market + Entry analysts)

One row per industry (NAICS 2- to 6-digit, say which):

`industry · naics · score (1–10) · key numbers · source per number · one-line why`

## Pain-point output shape

`problem · who has it (new / small / mid) · how often (evidence) · how bad (time or money lost) · ease to fix (S/M/L) · what "very easy" would look like · source`

## Final report shape (editor)

1. **Bottom line** — 5 bullets, plain English.
2. **Top 10 contractor problems** — ranked by pain × ease to fix, with the "make it easy" idea for each.
3. **Easiest industries to enter** — top 10 table.
4. **Most lucrative industries** — top 10 table.
5. **Sweet spot** — industries in both top lists, and why.
6. **What we could not establish** — gaps and missing data.
7. **Sources** — every tool call and URL used.
