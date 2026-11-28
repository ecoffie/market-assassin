-- NOT APPLIED. Hosted market report link controls: owner revocation + expiry (report sharing, Option 1).
--
-- Do not apply until Eric's separate RED approval for this release. After that approval, and only then:
--   npm run migrate -- --go --only 20261122_market_reports_share_controls.sql
-- Verify on the live DB afterwards (both columns present, row count unchanged); a runner "ok" is not proof:
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_name = 'market_reports' and column_name in ('expires_at', 'revoked_at');
--
-- Additive and data-preserving: two NULLABLE columns, no backfill, no rewrite.
--   expires_at null = the link never expires. Every link that exists today keeps working: Eric's decision,
--                     2026-11-22. They are with clients and in MCP host transcripts.
--   revoked_at null = the link is active.
-- New reports get expires_at = created_at + 90 days from the app (src/lib/market/report-store.ts), not
-- from a column default, so applying this file on its own changes no behaviour.
-- Revoking or expiring a LINK never deletes the report; only the owner's explicit DELETE removes the row.
-- Idempotent.

alter table market_reports add column if not exists expires_at timestamptz;
alter table market_reports add column if not exists revoked_at timestamptz;

-- The owner's "my reports" list, active links first.
create index if not exists market_reports_owner_active_idx
  on market_reports (owner_email, created_at desc) where revoked_at is null;
