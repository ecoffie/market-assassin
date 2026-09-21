-- USHCC Atlanta — Mindy org provisioning (Coach Mode eval)
--
-- BEFORE RUNNING: Replace placeholders:
--   {{DIRECTOR_EMAIL}}  — e.g. director@ushccatlanta.org
--
-- Hand-run in Supabase SQL editor → confirm "Success. No rows returned"
-- Then verify with the SELECTs at the bottom.
--
-- Access model (June 2026):
--   org_members (org_admin) → My Clients via coach-access grandfather
--   Optional: grant access_team on user_profiles for full Teams UI label
--
-- Runbook: tasks/USHCC-Atlanta-pilot-runbook.md

-- ── 1. Organization ─────────────────────────────────────────────────────────
INSERT INTO organizations (name, slug, org_type, tab_label, brand_color, tier)
VALUES (
  'USHCC Atlanta',
  'ushcc-atlanta',
  'chamber',
  'USHCC Atlanta',
  '#1e3a8a',
  'enterprise'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tab_label = EXCLUDED.tab_label,
  org_type = EXCLUDED.org_type,
  brand_color = EXCLUDED.brand_color
RETURNING id, slug;

-- ── 2. Director as org_admin ────────────────────────────────────────────────
INSERT INTO org_members (org_id, user_email, role, status)
SELECT id, lower(trim('{{DIRECTOR_EMAIL}}')), 'org_admin', 'active'
FROM organizations
WHERE slug = 'ushcc-atlanta'
ON CONFLICT (org_id, user_email) DO UPDATE SET
  role = 'org_admin',
  status = 'active';

-- ── 3. Optional welcome post on org tab ─────────────────────────────────────
INSERT INTO org_news (org_id, title, body, pinned, posted_by)
SELECT
  id,
  'Welcome to Mindy — USHCC Atlanta Federal Training',
  'Add your first training cohort member under My Clients. Paste their capability statement to auto-seed NAICS, keywords, and target agencies.',
  true,
  'eric@govcongiants.com'
FROM organizations
WHERE slug = 'ushcc-atlanta'
  AND NOT EXISTS (
    SELECT 1 FROM org_news n
    JOIN organizations o ON o.id = n.org_id
    WHERE o.slug = 'ushcc-atlanta' AND n.title LIKE 'Welcome to Mindy%'
  );

-- ── 4. Optional Teams entitlement (uncomment if director should show Teams tier)
-- UPDATE user_profiles
-- SET access_team = true, updated_at = now()
-- WHERE lower(email) = lower(trim('{{DIRECTOR_EMAIL}}'));

NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT o.id, o.name, o.slug, o.tab_label, o.org_type
FROM organizations o WHERE slug = 'ushcc-atlanta';

SELECT m.user_email, m.role, m.status
FROM org_members m
JOIN organizations o ON o.id = m.org_id
WHERE o.slug = 'ushcc-atlanta';
