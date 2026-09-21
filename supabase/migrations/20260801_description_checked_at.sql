-- Re-sweep the SAM description backfill's '' (empty-string) rows.
--
-- WHY: the backfill overloads description='' to mean BOTH "genuinely no prose" AND "I tried and
-- gave up" — because there was no checked-at stamp. So 42,939 '' rows sit outside the LINK_FILTER
-- (http% OR null) and are NEVER retried, even ones poisoned by a transient timeout/404. Adding a
-- stamp lets '' mean "no text on record" while a NULL stamp means "re-claimable" — so we re-sweep
-- the '' rows ONCE (recovering the transient-failure poison) and genuinely-empty NSN buys stamp
-- checked and stop re-fetching (protecting the scarce SAM 1,000/day quota). (Eric 2026-08-01.)

alter table sam_opportunities
  add column if not exists description_checked_at timestamptz;

-- Partial index so the re-claim query (WHERE description='' AND description_checked_at IS NULL) is fast.
create index if not exists idx_sam_opps_desc_recheck
  on sam_opportunities (id)
  where description = '' and description_checked_at is null;
