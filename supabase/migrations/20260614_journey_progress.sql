-- mindy_journey_progress — per-user state for the Getting Started guided journeys.
--
-- Tracks the 3 onboarding journeys (profile / find-customers / first-bid) so the
-- app can: (a) land new users on Getting Started for the first 14 days OR until all
-- 3 are done, (b) check off completed journeys, (c) remember a dismissed home-card.
--
-- One row per user (the 3 journeys are columns, not rows — there are exactly 3 and
-- they're fixed). created_at gives the 14-day-window anchor independent of signup.
-- No in-app DDL on this DB — run by hand in Supabase.

CREATE TABLE IF NOT EXISTS mindy_journey_progress (
  user_email TEXT PRIMARY KEY,

  -- Completion flags for the 3 journeys.
  profile_done BOOLEAN NOT NULL DEFAULT FALSE,       -- "Set up your Market Profile"
  customers_done BOOLEAN NOT NULL DEFAULT FALSE,     -- "Find your customers"
  bid_done BOOLEAN NOT NULL DEFAULT FALSE,           -- "Create your first bid"

  -- The dismissible dashboard home-card (sidebar item is always available).
  card_dismissed BOOLEAN NOT NULL DEFAULT FALSE,

  -- Anchor for the 14-day "forced landing" window.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
