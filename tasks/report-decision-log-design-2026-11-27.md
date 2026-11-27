# Report decision log: design (DRY RUN, nothing applied)

Status: proposal for Eric's approval · 2026-11-27 · owner: Agent 1 (Ask Mindy), with Agent 3 (Data Core) on storage.
No migration file is committed. Nothing is written in production until Eric approves the table and the writer.

## Why

Eric's hardening Fix 4 for the "How They Buy Now" report section: at ship time, record the judgment the report made so
it can be checked against what happened at 90 and 180 days, and so we can see whether the doors are judged or
pattern-matched (the same marks on every report means pattern-matching).

## Where it is written

`create_document` already validates and saves every report (`src/lib/chat/generate-document-tool.ts`). After a
successful save of a document that carries the How They Buy Now section, the tool appends one row. This is a best-effort
write: a failed log write never fails the save, and it is counted in the turn trace.

The doors and the consortium call are read from the saved DocModel. The model is asked to emit a small structured
`decision` object alongside `doc_model` (an optional create_document argument, validated server-side). Nothing is parsed
out of prose.

## Proposed table (illustrative SQL, NOT a migration)

```sql
-- report_decision_log: one row per shipped report with a How They Buy Now section.
create table if not exists report_decision_log (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  owner_email     text not null,          -- the acting scope's Vault owner (same as the saved document)
  document_id     uuid not null,          -- the generated Vault document row
  client_name     text not null,          -- the company the report is about
  client_uei      text,                   -- when known from the SAM record
  report_date     date not null,
  primary_door    text not null,          -- one of the 8 door keys
  doors_fit       text[] not null default '{}',
  doors_possible  text[] not null default '{}',
  doors_na        jsonb  not null default '{}',  -- { door_key: "one-sentence client-tied reason" }
  consortium_call text not null,          -- "join:<name>" or "none:<reason>"
  first_target    text,                   -- newcomers only
  pae_applies     text not null check (pae_applies in ('yes','no','not_dow')),
  outcome_90d     text,                   -- filled later (what_happened)
  outcome_180d    text
);
create index if not exists report_decision_log_owner_idx on report_decision_log (owner_email, created_at desc);
```

Door keys: `market_research`, `vehicles`, `open_calls`, `rnd`, `ota`, `consortia`, `cso`, `pae`. The server refuses a
`decision` object unless all 8 doors appear exactly once across fit / possible / na and every na door has a reason.

## Variation check

`scripts/report-decision-variation.ts` (read-only): across the last N rows, the share of reports with identical
fit/possible/na marks and identical consortium calls. If more than half of the last 20 reports share one mark pattern,
it is flagged as pattern-matching. Admin-only output; no customer-facing number.

## Rollout

1. Eric approves this design.
2. Migration with `IF NOT EXISTS`, applied with `npm run migrate -- --go --only <file>` by the release coordinator.
3. A writer behind a flag (`REPORT_DECISION_LOG`, default off). Dry-run mode logs the row it would write to the turn
   trace only.
4. Turn it on after one dry-run report is checked.

Privacy: rows hold the customer's own report judgments, owner-scoped like the Vault document. They are never shown to
another account and never used in a customer-facing aggregate.
