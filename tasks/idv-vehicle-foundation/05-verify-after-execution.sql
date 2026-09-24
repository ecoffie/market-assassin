-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 05 — READ-ONLY verification after README steps 1–4                     (safe to run any time)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Dry-run each block first (bqDryRun / `bq query --dry_run`). All are reads.

-- (a) Mech-Elec II holders grouped by the RETAINED solicitation id — no PIID guessing.
--     Expect: 4 holder IDVs (FA850124D0002..0005), multiple_or_single 'M', ordering end 2029-04-23,
--     ceiling $95,000,000 on each (report it ONCE — see src/lib/recompete/vehicle-ceiling.ts).
WITH idv AS (
  SELECT award_id, piid, recipient_name, recipient_uei,
    ARRAY_AGG(STRUCT(solicitation_identifier, ordering_period_end_date, multiple_or_single_award_idv_code, potential_award_value)
      ORDER BY action_date DESC, mod_number DESC LIMIT 1)[OFFSET(0)] AS latest
  FROM `market-assasin.usaspending.awards`
  WHERE recipient_uei IN ('LAA3W2UCHL23','PZNLVGANJ3U3','RZ53PAJUCNF4','TR1AV9J17C93')   -- cluster prune
    AND STARTS_WITH(award_id, 'CONT_IDV_')
  GROUP BY award_id, piid, recipient_name, recipient_uei
)
SELECT latest.solicitation_identifier, COUNT(*) AS holders,
  ARRAY_AGG(piid ORDER BY piid) AS holder_piids,
  MAX(latest.ordering_period_end_date) AS ordering_end,
  ARRAY_AGG(DISTINCT latest.multiple_or_single_award_idv_code IGNORE NULLS) AS ms,
  MAX(latest.potential_award_value) AS shared_ceiling_once
FROM idv GROUP BY 1;

-- (b) Mech-Elec II orders-to-date vs USASpending /idvs/amounts (2026-09-23: 31 orders, $17,001,286).
SELECT parent_piid, COUNT(DISTINCT award_id) AS orders, ROUND(SUM(obligation_amount), 2) AS obligations
FROM `market-assasin.usaspending.awards`
WHERE recipient_uei IN ('LAA3W2UCHL23','PZNLVGANJ3U3','RZ53PAJUCNF4','TR1AV9J17C93')
  AND parent_piid IN ('FA850124D0002','FA850124D0003','FA850124D0004','FA850124D0005')
GROUP BY parent_piid ORDER BY parent_piid;

-- (c) Fleet fill of the new columns on IDV rows with activity since FY2024.
SELECT COUNT(DISTINCT award_id) AS idv_awards,
  COUNT(DISTINCT IF(solicitation_identifier IS NOT NULL, award_id, NULL)) AS with_solicitation,
  COUNT(DISTINCT IF(ordering_period_end_date IS NOT NULL, award_id, NULL)) AS with_ordering_end,
  COUNT(DISTINCT IF(multiple_or_single_award_idv_code IS NOT NULL, award_id, NULL)) AS with_ms_flag
FROM `market-assasin.usaspending.awards`
WHERE STARTS_WITH(award_id, 'CONT_IDV_') AND action_date >= '2023-10-01';

-- (d) Completeness — must be `complete`: `npm run verify:oracles -- --only freshness`
--     (dod 2026-02/03/04 were 71 / 74 / 50 transactions against 369,957 / 409,484 / 414,853 a year earlier).
