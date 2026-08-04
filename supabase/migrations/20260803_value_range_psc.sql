-- Make the M-Estimate value-range PSC-aware (Eric 2026-08-03).
--
-- WHY: opp_value_range keys the M-Estimate band on NAICS (+ optional agency/sub-agency). For a
-- PRODUCT buy that carries a BROAD NAICS, the band describes the wrong market — a Bureau-of-Prisons
-- "APX N70 Radios" buy carries NAICS 541519 ("Other Computer Related Services", broad IT), so the
-- NAICS band is IT-services dollars, not radio dollars. PSC ("what was BOUGHT") is the right key:
-- PSC family 58 (radio/comms equipment) medians ~$2.1M across 146 comparables, vs the fabricated
-- $77M the NAICS path produced. This adds PSC as an OPTIONAL, ADDITIVE filter — the caller tries a
-- PSC-scoped band FIRST and falls back to the existing NAICS band when the PSC sample is too thin.
--
-- ⚠️ WHY A PREFIX, NOT AN EXACT MATCH: recompete_opportunities.psc_code is only ~7.4% populated
-- (10,977 / 147,996 rows), and an exact 4-char PSC (e.g. 6940) had just 1 in-band row here — a hard
-- exact filter would fall below the caller's MIN_SAMPLE (8) and NULL the band. So p_psc matches on
-- the PSC/FSC FAMILY (first N chars, default 2 = the FSC group) — 58xx = 146 comparables. The caller
-- decides whether the PSC band has enough depth; if not, it uses the NAICS band (never a dead M-Est).
--
-- Additive + backward compatible: p_psc defaults NULL, so every existing call
-- opp_value_range(naics, agency, sub) behaves EXACTLY as before. Only a call that passes p_psc
-- narrows to that product family.

CREATE OR REPLACE FUNCTION opp_value_range(
  p_naics text,
  p_agency text DEFAULT NULL,
  p_sub text DEFAULT NULL,
  p_psc text DEFAULT NULL,          -- PSC/FSC of the opportunity ("what was bought"); NULL = ignore
  p_psc_prefix_len int DEFAULT 2    -- match this many leading PSC chars (the FSC family); 2 = group
)
RETURNS TABLE (n bigint, p10 numeric, p50 numeric, p90 numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint AS n,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY total_obligation) AS p10,  -- 25th (col kept p10 for API compat)
    percentile_cont(0.50) WITHIN GROUP (ORDER BY total_obligation) AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY total_obligation) AS p90   -- 75th
  FROM recompete_opportunities
  WHERE total_obligation BETWEEN 1000 AND 500000000
    AND (
      (length(p_naics) >= 6 AND naics_code = p_naics)
      OR (length(p_naics) < 6 AND naics_code LIKE p_naics || '%')
    )
    AND (p_agency IS NULL OR awarding_agency ILIKE p_agency)
    AND (p_sub IS NULL OR awarding_sub_agency ILIKE p_sub)
    -- PSC family narrowing — only when p_psc is supplied AND the row has a PSC (the 7.4% that do).
    AND (
      p_psc IS NULL
      OR (
        psc_code IS NOT NULL
        AND upper(psc_code) LIKE upper(left(p_psc, greatest(p_psc_prefix_len, 1))) || '%'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION opp_value_range(text, text, text, text, int) TO service_role;

-- NOTE: PostgREST resolves overloads by the argument NAMES sent, so the pre-existing 3-arg call
-- opp_value_range(p_naics, p_agency, p_sub) still binds to THIS function (p_psc/p_psc_prefix_len
-- default). The old 3-arg-only signature is superseded by this superset — no DROP needed, and no
-- existing caller changes behavior until it starts sending p_psc.
