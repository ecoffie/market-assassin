-- OPPORTUNITY SHARE FUNNEL — one defensible model over existing first-party data.
--
--   shares → unique share visitors → signups → activated within 7 days → paid customers → revenue
--
-- Grain: ONE ROW PER SHARE EVENT (share_id). Segment by grouping these rows on notice_id (the
-- opportunity), sharer, method, or shared_on (acquisition date = the day the share happened).
-- Every stage re-validates the share the same way src/lib/attribution/share-attribution.ts does:
--
--   · a share is the EARLIEST listing_share carrying that share_id (a forged later copy of a real
--     id cannot take it over; a random or malformed id has no listing_share and never resolves);
--   · an arrival counts only if it names the SAME record, happened AFTER the share, and was not
--     made by the sharer's own identity;
--   · a signup counts only if signup_attribution.share_id was written by the verified-session
--     claim (itself validated) AND the account exists in auth.users;
--   · activation = within [signup, signup + 7 days] the account created ≥1 opportunity save
--     (user_saved_opportunities, or an anonymous_shortlist save claimed by it), watch/alert
--     (saved_searches) or pursuit (user_pipeline, owner-attributed). Views, opens, searches,
--     logins and email opens are NOT activation;
--   · paid/revenue = purchases_canonical (the de-duplicated revenue surface) for the account,
--     on or after signup. Renewals are not rows in purchases (see PR notes).

WITH share_events AS (
  SELECT DISTINCT ON (e.metadata->>'share_id')
         e.metadata->>'share_id'  AS share_id,
         e.metadata->>'notice_id' AS notice_id,
         e.metadata->>'kind'      AS kind,
         COALESCE(e.metadata->>'method', 'unknown') AS method,
         e.user_email             AS sharer,
         e.created_at             AS shared_at
  FROM user_engagement e
  WHERE e.event_source = 'opportunity_map'
    AND e.metadata->>'action' = 'listing_share'
    AND e.metadata ? 'share_id'
  ORDER BY e.metadata->>'share_id', e.created_at ASC
),
arrivals AS (
  SELECT s.share_id, a.user_email AS visitor, MIN(a.created_at) AS arrived_at
  FROM share_events s
  JOIN user_engagement a
    ON a.metadata ? 'share_id'
   AND a.metadata->>'share_id' = s.share_id
   AND a.event_source = 'opportunity_map'
   AND a.metadata->>'action' IN ('map_view', 'listing_open')
   AND a.metadata->>'entry' = 'share'
   AND a.metadata->>'notice_id' = s.notice_id
   AND a.created_at >= s.shared_at
   AND a.user_email <> s.sharer
  GROUP BY s.share_id, a.user_email
),
signups AS (
  SELECT sa.share_id, lower(sa.email) AS email, sa.anon_id, u.created_at AS signed_up_at
  FROM signup_attribution sa
  JOIN share_events s ON s.share_id = sa.share_id
  JOIN auth.users u ON lower(u.email) = lower(sa.email)
  WHERE sa.share_id IS NOT NULL
),
activation AS (
  SELECT g.share_id, g.email,
         EXISTS (SELECT 1 FROM user_saved_opportunities x
                  WHERE lower(x.user_email) = g.email
                    AND x.created_at >= g.signed_up_at AND x.created_at < g.signed_up_at + interval '7 days')
      OR EXISTS (SELECT 1 FROM anonymous_shortlist x
                  WHERE lower(x.claimed_by) = g.email
                    AND x.created_at >= g.signed_up_at AND x.created_at < g.signed_up_at + interval '7 days')
      OR EXISTS (SELECT 1 FROM saved_searches x
                  WHERE lower(x.user_email) = g.email
                    AND x.created_at >= g.signed_up_at AND x.created_at < g.signed_up_at + interval '7 days')
      OR EXISTS (SELECT 1 FROM user_pipeline x
                  WHERE lower(COALESCE(x.owner_email, x.user_email)) = g.email
                    AND x.created_at >= g.signed_up_at AND x.created_at < g.signed_up_at + interval '7 days')
         AS activated_within_7d
  FROM signups g
),
paid AS (
  SELECT g.share_id, g.email, SUM(p.amount_cents) AS revenue_cents
  FROM signups g
  JOIN purchases_canonical p
    ON lower(p.user_email) = g.email
   AND p.created_at >= g.signed_up_at
   AND COALESCE(p.status, 'completed') = 'completed'
  GROUP BY g.share_id, g.email
)
SELECT
  s.share_id,
  s.notice_id,
  s.kind,
  s.sharer,
  s.method,
  s.shared_at::date                                                   AS shared_on,
  (SELECT COUNT(*) FROM arrivals a WHERE a.share_id = s.share_id)     AS share_visitors,
  (SELECT COUNT(*) FROM signups g WHERE g.share_id = s.share_id)      AS signups,
  (SELECT COUNT(*) FROM activation v WHERE v.share_id = s.share_id AND v.activated_within_7d) AS activated_7d,
  (SELECT COUNT(*) FROM paid p WHERE p.share_id = s.share_id)         AS paid_customers,
  COALESCE((SELECT SUM(p.revenue_cents) FROM paid p WHERE p.share_id = s.share_id), 0) AS revenue_cents
FROM share_events s
ORDER BY s.shared_at DESC
