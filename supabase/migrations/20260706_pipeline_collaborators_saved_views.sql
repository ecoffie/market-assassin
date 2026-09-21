-- Phase 2 (Mindy v2): Deal Flow Board — per-card collaborators + shared saved views.
--
-- The team plumbing (workspace_id, owner_email, roles, invites, activity feed,
-- comments API) already exists. This adds the two genuine gaps:
--   1. collaborators[] on user_pipeline — a card can have MULTIPLE teammates working
--      it, not just one owner. "Assigned to me" then means owner OR collaborator.
--   2. pipeline_saved_views — workspace-shared one-click filters ("Due this week",
--      "Needs owner", "High value", plus custom saved filters any member can create).
--
-- Idempotent. Hand-run in Supabase (this DB has no in-app DDL).

-- 1) Per-card collaborators (in addition to the single owner_email).
ALTER TABLE public.user_pipeline
  ADD COLUMN IF NOT EXISTS collaborators text[] NOT NULL DEFAULT '{}';

-- 2) Workspace-shared saved views. filter_json holds the board filter state
--    (stage, priority, ownerFilter, value floor, deadline window, search, etc.)
--    so any teammate can apply a colleague's saved view. Built-in views are
--    client-side constants; this table is only user-created custom views.
CREATE TABLE IF NOT EXISTS public.pipeline_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  name text NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  is_shared boolean NOT NULL DEFAULT true,   -- shared with the whole workspace vs. private to creator
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lookups are always "views for this workspace" (+ the creator's private ones).
CREATE INDEX IF NOT EXISTS idx_pipeline_saved_views_workspace
  ON public.pipeline_saved_views (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_saved_views_creator
  ON public.pipeline_saved_views (created_by);

-- GIN index so "collaborators contains me" (Assigned-to-me across a workspace board)
-- stays fast as boards grow.
CREATE INDEX IF NOT EXISTS idx_user_pipeline_collaborators
  ON public.user_pipeline USING gin (collaborators);
