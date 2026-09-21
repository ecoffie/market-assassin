-- Bulk set-based UPDATE for the set-aside enrichment backfill (scope: tasks/setaside-enrichment-scope).
-- The supabase-js client can't bulk-UPDATE distinct per-row values (upsert tries to INSERT and violates
-- NOT NULL). This RPC takes a JSON array of {contract_id, set_aside_enriched, set_aside_source,
-- set_aside_checked_at} and applies them in ONE set-based UPDATE ... FROM jsonb_to_recordset — so the
-- runner writes 500 rows per round-trip instead of 500 individual UPDATEs. Only ever UPDATES existing
-- rows (JOIN on contract_id); touches ONLY the three enriched columns; never inserts.
CREATE OR REPLACE FUNCTION bulk_update_recompete_setaside(rows jsonb)
RETURNS integer
LANGUAGE sql
AS $$
  WITH upd AS (
    UPDATE recompete_opportunities r
    SET set_aside_enriched   = x.set_aside_enriched,
        set_aside_source     = x.set_aside_source,
        set_aside_checked_at = x.set_aside_checked_at::timestamptz
    FROM jsonb_to_recordset(rows) AS x(
      contract_id text,
      set_aside_enriched text,
      set_aside_source text,
      set_aside_checked_at text
    )
    WHERE r.contract_id = x.contract_id
    RETURNING 1
  )
  SELECT COUNT(*)::int FROM upd;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_recompete_setaside(jsonb) TO service_role;
