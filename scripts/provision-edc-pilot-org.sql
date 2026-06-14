-- EDC pilot — Mindy org provisioning (Coach Mode 60-day eval)
--
-- BEFORE RUNNING: Replace placeholders:
--   {{ORG_NAME}}       — e.g. Prince George's County EDC
--   {{ORG_SLUG}}       — e.g. pgcedc
--   {{DIRECTOR_EMAIL}} — e.g. kbandrews@co.pg.md.us
--
-- Hand-run in Supabase SQL editor → confirm "Success. No rows returned"
-- Then verify with the SELECTs at the bottom.
--
-- Runbook: projects/edc-mbda-partnerships/EXECUTION-RUNBOOK.md

-- ── 1. Organization ─────────────────────────────────────────────────────────
INSERT INTO organizations (name, slug, org_type, tab_label, brand_color, tier)
VALUES (
  '{{ORG_NAME}}',
  '{{ORG_SLUG}}',
  'edc',
  '{{ORG_NAME}}',
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
WHERE slug = '{{ORG_SLUG}}'
ON CONFLICT (org_id, user_email) DO UPDATE SET
  role = 'org_admin',
  status = 'active';

-- ── 3. Welcome post on org tab ──────────────────────────────────────────────
INSERT INTO org_news (org_id, title, body, pinned, posted_by)
SELECT
  id,
  'Welcome to Mindy — Procurement Cohort',
  'Add cohort members under My Clients. Paste capability statements to auto-seed NAICS, keywords, and target agencies. Use Source Feed CTA filters to align pursuits to DoD Critical Tech Areas.',
  true,
  'eric@govcongiants.com'
FROM organizations
WHERE slug = '{{ORG_SLUG}}'
  AND NOT EXISTS (
    SELECT 1 FROM org_news n
    JOIN organizations o ON o.id = n.org_id
    WHERE o.slug = '{{ORG_SLUG}}' AND n.title LIKE 'Welcome to Mindy%'
  );

NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT o.id, o.name, o.slug, o.tab_label, o.org_type
FROM organizations o WHERE slug = '{{ORG_SLUG}}';

SELECT m.user_email, m.role, m.status
FROM org_members m
JOIN organizations o ON o.id = m.org_id
WHERE o.slug = '{{ORG_SLUG}}';
