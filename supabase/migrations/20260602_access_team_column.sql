-- Adds the access_team flag to user_profiles. This is the PRIMARY entitlement
-- that drives the 'team' tier in verifyMIAccess() / hasMindyTeamAccess() and
-- unlocks the Team Access panel.
--
-- BUG: the column was referenced in code (updateAccessFlags writes it on a
-- team_monthly/team_annual purchase; hasMindyTeamAccess reads it) but never
-- existed in this Supabase project's schema. Result: every Team purchase
-- silently failed to grant Team access, and hasMindyTeamAccess always returned
-- false. This migration adds the column so Team entitlement actually works.
--
-- Run in the Supabase SQL editor (no exec_migration RPC in this project).

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS access_team BOOLEAN DEFAULT false;
