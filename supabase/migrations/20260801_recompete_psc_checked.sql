-- Recompete PSC backfill — a resumability stamp so the 144K-row backfill can restart without
-- re-hitting USASpending for rows already checked (even ones that legitimately have no PSC).
-- The backfill (scripts/backfill-recompete-psc.ts) sets psc_checked_at after each row; it only
-- processes rows where psc_code IS NULL AND psc_checked_at IS NULL. (Eric 2026-08-01.)
alter table recompete_opportunities add column if not exists psc_checked_at timestamptz;
create index if not exists recompete_psc_backfill_idx
  on recompete_opportunities (psc_checked_at) where psc_code is null;
