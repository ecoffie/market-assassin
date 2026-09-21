-- Decision Makers — additive identity layer (Workstream B).
--
-- THREE CONCEPTS, kept separate on purpose:
--   OBSERVATION  federal_contacts row — one POC slot on one notice. UNTOUCHED.
--   IDENTITY     a person, keyed on normalized personal email.
--   ROLE         where an identity acts (agency / office).
--
-- Nothing is collapsed, nothing is deleted, no row is rewritten. These are VIEWS
-- over the observations, so the physical record stays the source of truth and the
-- layer can be dropped with no data loss.
--
-- ── WHY EMAIL IS THE KEY (measured 2026-09-20 on production) ────────────────
--   · 212,415 government observations resolve to 23,201 distinct emails (~9.2
--     observations per address). Email is the only stable, source-native handle.
--   · NAME IS NOT A KEY. Real stored values include
--       'Telephone: 7176053992'
--       'Natalya RadykDSN312-850-4033'
--       an entire paragraph of DIBBS filing instructions.
--     Matching on name would merge strangers and split individuals.
--   · VENDOR POCs CANNOT USE THIS KEY AT ALL: all 82,017 `vendor_entity_poc`
--     rows have NO email (measured: 0). They are a separate key space
--     (`<uei>::<slot>`) and are deliberately OUT of scope here — an identity
--     layer that silently produced zero vendor identities would look complete
--     while covering nothing.
--
-- ── WHY VOLUME IS NOT EVIDENCE OF A ROLE MAILBOX ───────────────────────────
-- The busiest address in the corpus, natalya.radyk@dla.mil, has 3,807
-- observations and is a REAL PERSON (a DLA contracting officer). Classifying by
-- volume would have deleted her. Classification therefore reads ADDRESS SHAPE
-- and never observation count.
--
-- ── UNKNOWN STAYS UNKNOWN ───────────────────────────────────────────────────
-- 5,420 of 23,201 addresses (23%) do not match a confident person OR role shape
-- (e.g. `stephen.1.weaver@dla.mil`, `fmde_3319@dla.mil`). They are classified
-- `unknown` and are NOT promoted to `person`. A missing result is preferable to
-- a misleading one; `decision_maker_identities` exposes them so the ambiguity is
-- visible rather than silently resolved.

-- ── 1. Classifier — address shape only, never volume ────────────────────────
CREATE OR REPLACE FUNCTION public.decision_maker_email_kind(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR btrim(p_email) = '' THEN 'unknown'
    -- Distribution-list / shared-box prefixes used by DoD and civilian agencies.
    WHEN lower(p_email) ~ '(^|[._-])(mbx|dl|grp|group|team|smb)([._-])' THEN 'role_mailbox'
    -- Functional names in the local part.
    WHEN split_part(lower(p_email), '@', 1) ~
         '(^|[._-])(support|helpdesk|help|info|inquiries|quotation|quotations|quote|quotes|order|orders|contract|contracts|contracting|procurement|purchasing|acquisition|bid|bids|rfp|rfq|rfi|solicitation|solicitations|mailbox|noreply|no-reply|donotreply|webmaster|postmaster|admin)([._-]|$)'
         THEN 'role_mailbox'
    -- first.last  /  first.m.last, with an optional disambiguating digit run and
    -- an optional DoD affiliation suffix (.civ/.mil/.ctr).
    WHEN split_part(lower(p_email), '@', 1) ~ '^[a-z]+\.[a-z]+[0-9]{0,3}(\.(civ|mil|ctr))?$' THEN 'person'
    WHEN split_part(lower(p_email), '@', 1) ~ '^[a-z]+\.[a-z]\.[a-z]+[0-9]{0,3}(\.(civ|mil|ctr))?$' THEN 'person'
    ELSE 'unknown'
  END;
$$;

COMMENT ON FUNCTION public.decision_maker_email_kind(text) IS
  'Classify a contact email by ADDRESS SHAPE only: person | role_mailbox | unknown. Never uses observation volume — the busiest address in the corpus (3,807 observations) is a real person.';

-- ── 2. IDENTITY — one row per distinct government email ─────────────────────
-- Every address is exposed, INCLUDING role_mailbox and unknown, each labelled.
-- Callers filter; the view never hides a population it could not classify.
CREATE OR REPLACE VIEW public.decision_maker_identities AS
SELECT
  lower(btrim(fc.contact_email))                       AS identity_email,
  public.decision_maker_email_kind(fc.contact_email)   AS identity_kind,
  count(*)                                             AS observation_count,
  count(DISTINCT fc.department_ind_agency)             AS agency_count,
  count(DISTINCT fc.solicitation_number)               AS solicitation_count,
  min(fc.posted_date)                                  AS first_seen_posted,
  max(fc.posted_date)                                  AS last_seen_posted,
  max(fc.imported_at)                                  AS last_observed_at,
  -- Display only. NEVER an identity key — see the header.
  (array_agg(fc.contact_fullname ORDER BY fc.imported_at DESC)
     FILTER (WHERE fc.contact_fullname IS NOT NULL AND btrim(fc.contact_fullname) <> ''))[1]
                                                       AS latest_observed_name,
  (array_agg(fc.contact_title ORDER BY fc.imported_at DESC)
     FILTER (WHERE fc.contact_title IS NOT NULL AND btrim(fc.contact_title) <> ''))[1]
                                                       AS latest_observed_title
FROM public.federal_contacts fc
WHERE fc.contact_kind = 'government_buyer'
  AND fc.contact_email IS NOT NULL
  AND btrim(fc.contact_email) <> ''
GROUP BY 1, 2;

COMMENT ON VIEW public.decision_maker_identities IS
  'One row per distinct government contact email. identity_kind is person|role_mailbox|unknown — a role mailbox is NOT a person and unknown is NOT promoted. Vendor POCs are excluded: all 82,017 carry no email.';

-- ── 3. ROLE — where an identity acts ────────────────────────────────────────
-- An identity legitimately holds several roles (an officer who buys for two
-- offices). Role is NOT folded into identity, so a move is observable instead of
-- overwriting history.
CREATE OR REPLACE VIEW public.decision_maker_roles AS
SELECT
  lower(btrim(fc.contact_email))                     AS identity_email,
  public.decision_maker_email_kind(fc.contact_email) AS identity_kind,
  fc.department_ind_agency                           AS agency,
  fc.sub_tier                                        AS sub_tier,
  fc.office                                          AS office,
  fc.role_category                                   AS role_category,
  count(*)                                           AS observation_count,
  min(fc.posted_date)                                AS first_seen_posted,
  max(fc.posted_date)                                AS last_seen_posted
FROM public.federal_contacts fc
WHERE fc.contact_kind = 'government_buyer'
  AND fc.contact_email IS NOT NULL
  AND btrim(fc.contact_email) <> ''
GROUP BY 1, 2, 3, 4, 5, 6;

COMMENT ON VIEW public.decision_maker_roles IS
  'One row per (identity, agency, sub_tier, office, role_category). An identity may hold several roles; roles are never collapsed into the identity.';

-- ── 4. Coverage truth — why held/upstream reads ~80% and is NOT debt ────────
-- `decision_makers_upstream_slots()` counts every POC slot with an email or
-- phone, INCLUDING slots the drain's quality filter deliberately rejects. So a
-- correctly-filtering pipeline reports ~79.8% forever and the deficit is read as
-- coverage debt. Measured 2026-09-20: of 53,698 unheld slots, 45,924 (85.5%) are
-- the single DIBBS role mailbox dibbsbsm@dla.mil, whose "name" is a paragraph of
-- filing instructions. The 53,698 slots resolve to just 501 distinct addresses.
--
-- This function reports the split WITHOUT redefining the existing metric — the
-- control-plane denominator is Eric's call, not a silent change.
CREATE OR REPLACE FUNCTION public.decision_makers_slot_coverage()
RETURNS TABLE(
  upstream_slots bigint,
  held_slots bigint,
  unheld_slots bigint,
  unheld_distinct_emails bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH up AS (
    SELECT o.notice_id || '::' || (ord - 1)::text AS k,
           lower(btrim(t.e->>'email')) AS em
    FROM sam_opportunities o,
         LATERAL jsonb_array_elements(o.points_of_contact) WITH ORDINALITY AS t(e, ord)
    WHERE o.points_of_contact IS NOT NULL
      AND (coalesce(t.e->>'email', '') <> '' OR coalesce(t.e->>'phone', '') <> '')
  ),
  j AS (
    SELECT up.k, up.em, fc.id AS held_id
    FROM up
    LEFT JOIN public.federal_contacts fc
      ON fc.source_row_key = up.k AND fc.contact_kind = 'government_buyer'
  )
  SELECT count(*)::bigint,
         count(held_id)::bigint,
         (count(*) - count(held_id))::bigint,
         count(DISTINCT em) FILTER (WHERE held_id IS NULL)::bigint
  FROM j;
$$;

COMMENT ON FUNCTION public.decision_makers_slot_coverage() IS
  'Slot-level coverage split. The unheld remainder is dominated by deliberately-rejected role mailboxes, so it is NOT coverage debt — see the migration header.';
