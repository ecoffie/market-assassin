# TODO: Federal Contacts Database — Path to 50K-80K Verified Contacts

**Status:** Captured 2026-05-22, deferred for focused session
**Trigger:** Eric — "I just learned that HigherGov has 220,000 KOs in their database, how do we get that?"
**Related:**
- [`tasks/TODO-contractor-database-expansion.md`](./TODO-contractor-database-expansion.md) — the contractor-side expansion
- [`supabase/migrations/20260512_opengov_iq_contacts.sql`](../supabase/migrations/20260512_opengov_iq_contacts.sql) — existing contacts table
- [`supabase/migrations/20260521_sam_opportunities_full_extraction.sql`](../supabase/migrations/20260521_sam_opportunities_full_extraction.sql) — POC field on every SAM opp

---

## Reality check on "220K KOs"

KO = Contracting Officer. The federal universe has **~25K-50K active KOs at any time**, with maybe 80K-100K cumulative across history.

HigherGov's "220K KOs in our database" almost certainly means one of:

1. **220K total records with massive duplication** — same person at different agencies over time, retired KOs still in the table, name spelling variants
2. **Bundled "contacts"** — KOs + Contracting Specialists + OSBP + COTRs/CORs + Program Managers + end users + generic POCs all under one "contacts" label
3. **Marketing rounding** — could be 180K, could be 250K. They benefit from the big number

Doesn't matter which. The structural answer is the same — we build the same pipeline they have.

---

## Strategic framing — accuracy over count

Per Eric's direction: **don't chase 220K as a vanity metric.**

The defensible play: ship **50K-80K verified, deliverable, role-tagged contacts** with marketing copy that says "70,000+ federal contacts with current roles and deliverable emails" instead of "220K+ KOs."

Why this wins long-term:
- If a customer ever tests the data, ours is real
- Quality is a moat HigherGov can't easily catch up on (their 220K includes years of staleness they have to keep cleaning)
- "We re-verify monthly" is a stronger sales line than "we have more records"

The goal becomes: **build a freshness + role-tagging discipline that compounds.**

---

## Where the data lives (public sources)

| Source | Yield (unique contacts) | How to access |
|---|---|---|
| **SAM.gov opportunities** | 30K-50K | `sam_opportunities.raw_data->pointOfContact` (already cached, ~29K opps) |
| **OpenGov IQ AllSamContacts** | 50K+ if Base44 export ran | `opengov_iq_contacts` table (migration `20260512`) — maybe already populated |
| **USAspending awards** | 80K-150K | API: `spending_by_award` per fiscal year, all NAICS |
| **Agency OSBP directories** | 500-1,500 | Per-agency scrape (most have public OSBP page) |
| **Acquisition.gov staff lookup** | Tens of thousands | Public search interface |
| **SBA Apex Accelerators contacts** | Hundreds | sba.gov/apex |
| **Industry day attendee lists** | Variable | Scrape from SAM Special Notices (we already extract events) |

The 220K HigherGov number = scrape all of these, dedup, union.

---

## What we already have (head start)

Inventory before doing more work:

```sql
-- Check what's already loaded
SELECT count(*) FROM opengov_iq_contacts;

-- Check POCs hiding in sam_opportunities (need to extract)
SELECT count(*)
FROM sam_opportunities
WHERE raw_data->'pointOfContact' IS NOT NULL
  AND jsonb_array_length(raw_data->'pointOfContact') > 0;

-- Estimate unique contacts in SAM opps
SELECT count(DISTINCT (poc->>'email'))
FROM sam_opportunities,
     jsonb_array_elements(raw_data->'pointOfContact') AS poc
WHERE poc->>'email' IS NOT NULL;
```

If `opengov_iq_contacts` is populated (from a prior Base44/CSV import) and `sam_opportunities` POCs deduplicate to ~30K, we may already have **40K-60K contacts in Supabase right now** — just not unified into a single queryable surface.

---

## 4-Phase build plan

### Phase 1 — Union what we already have (~1 day)

1. **Migration: new `federal_contacts` table**

   ```sql
   CREATE TABLE federal_contacts (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

     -- Identity
     name_normalized TEXT NOT NULL,    -- LOWER(TRIM(name)) for dedup
     name_display TEXT NOT NULL,        -- Title-cased for UI
     email TEXT,
     email_normalized TEXT,             -- LOWER(email) for dedup match
     phone TEXT,

     -- Role
     title TEXT,                        -- "Contracting Officer", "OSBP Director", etc.
     role_category TEXT,                -- ko / specialist / osbp / cor_cotr / pm / poc / other
     agency_name TEXT,
     sub_agency_name TEXT,
     office TEXT,

     -- Provenance (which sources contributed to this row)
     sources TEXT[] DEFAULT '{}',       -- ['sam_opps', 'opengov_iq', 'usaspending', ...]
     first_seen TIMESTAMPTZ DEFAULT NOW(),
     last_seen TIMESTAMPTZ DEFAULT NOW(), -- latest source mention — drives staleness
     last_seen_solicitation TEXT,       -- newest SAM opp this person appeared on

     -- Verification status
     is_email_verified BOOLEAN DEFAULT false,  -- MX + format check passed
     is_stale BOOLEAN DEFAULT false,           -- 2+ years since last appearance
     verification_checked_at TIMESTAMPTZ,

     raw_data JSONB DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     updated_at TIMESTAMPTZ DEFAULT NOW(),

     CONSTRAINT unique_contact UNIQUE (email_normalized, name_normalized, agency_name)
   );

   CREATE INDEX idx_federal_contacts_email ON federal_contacts(email_normalized);
   CREATE INDEX idx_federal_contacts_agency ON federal_contacts(agency_name);
   CREATE INDEX idx_federal_contacts_role ON federal_contacts(role_category);
   CREATE INDEX idx_federal_contacts_search ON federal_contacts USING GIN (
     to_tsvector('english',
       coalesce(name_display, '') || ' ' ||
       coalesce(title, '') || ' ' ||
       coalesce(agency_name, '') || ' ' ||
       coalesce(office, '')
     )
   );
   CREATE INDEX idx_federal_contacts_freshness ON federal_contacts(last_seen DESC);
   ```

2. **Backfill from `opengov_iq_contacts`** — script that copies every row with mapping logic for name/email normalization + role detection.

3. **Backfill from `sam_opportunities.raw_data->pointOfContact`** — script that iterates ~29K cached opps, flattens the POC arrays, dedupes by email + name+agency, upserts into `federal_contacts`. Updates `last_seen` to the SAM `postedDate` so we get a freshness signal for free.

**Expected yield:** ~40K-60K unique contacts. Single-session work.

### Phase 2 — USAspending KO scrape (~1 week)

USAspending awards carry the awarding office + responsible KO on most awards. Pulling 5 years of awards = millions of rows; de-duped by KO name = ~100K-150K unique people.

1. **Cron `extract-usaspending-kos`** — daily, processes ~1,000 awards per run (rate-limited at 1 req/sec, ~1 hour total per run)
2. **Backfill mode** — `?backfill=true&fy=2021` flag to march through historical years
3. **Upsert pattern** — same `federal_contacts` table, sources gains `'usaspending'`

**Expected yield after first full pass:** ~80K-100K total contacts (combined with Phase 1).

### Phase 3 — Agency directory scrapes (~3-5 days)

Public sources HigherGov also pulls from:

- **OSBP directory at sba.gov** — `~500 contacts`, official OSBP officers per agency
- **acquisition.gov staff lookup** — `~10K-30K`, federal acquisition workforce
- **Agency-specific small business pages** — `~1K-2K`, the federal-events-sources.json catalog has direct URLs

Each gets a dedicated scraper + import script. Pattern matches the existing forecast scrapers (`src/lib/forecasts/scrapers/`).

**Expected yield:** another 20K-30K contacts.

### Phase 4 — Quality layer (~1 week, recurring)

The differentiator vs HigherGov isn't quantity — it's accuracy. Implement:

1. **Email validation** — MX + SMTP check at write time. `is_email_verified` flag.
2. **Staleness detection** — contacts with `last_seen < NOW() - 730 days` get `is_stale = true`. Hide from default queries; show in "include stale" toggle.
3. **Role normalization** — map title variants to `role_category`:
   - "Contract Specialist" / "Procurement Analyst" / "Acquisition Lead" → `specialist`
   - "Contracting Officer" / "KO" / "CO" → `ko`
   - "Small Business Specialist" / "OSDBU Director" → `osbp`
   - "COR" / "COTR" → `cor_cotr`
4. **Cross-reference with current SAM opps** — if a contact has appeared in any opp in the last 365 days, mark `is_active = true`. Refresh weekly.
5. **Mid-stream LLM cleanup** — quarterly Groq pass on rows missing `role_category` to auto-classify.

**This is the moat.** HigherGov can scrape; they can't easily build a freshness discipline retroactively.

---

## Marketing copy when we ship

Defensible claims after Phase 1-2:
- "70,000+ federal contacts" (after Phase 1+2 union + dedup)
- "Re-verified weekly via cross-reference with active SAM solicitations"
- "Role-tagged by Contracting Officer, Contracting Specialist, OSBP, COR/COTR"
- "Email deliverability checked at ingestion + monthly thereafter"

What NOT to claim:
- "220K KOs" — we don't have 220K KOs, period. We'd have 220K contacts of mixed roles. Different thing.
- "Complete federal acquisition workforce" — nobody has this; the universe is closed-data inside government HR systems

---

## Where contacts surface in the product

Once `federal_contacts` is populated, plug it into:

| Surface | How |
|---|---|
| **Relationships panel (existing)** | Replace the static OSBP / partner lookup with `federal_contacts` queries |
| **AgencyDrawer in Market Research** | "Decision-makers at this office" section listing the top 5 active contacts |
| **Source Feed opp cards** | When an opp has a `pointOfContact`, link the name to a `/contacts/[slug]` page (similar to ContractorLink) |
| **My Target List** | "Suggested contacts to reach out to" per saved office |
| **AI Mindy Says narrative** | Include "X has 12 OSBP contacts you could approach" in the recommended-actions list |
| **NEW: /contacts/[slug] public pages** | SEO play — every contact gets an indexable page. Adds ~50K-80K URLs to the sitemap. |

---

## Trigger for execution

Phase 1 (SAM POC + OpenGov union) is a **single focused session** — ~4-6 hours. Cheap.

Phases 2-4 are **multi-day**. Don't start until:
1. The contractor SEO flywheel shows traction (Search Console impressions > 0 on contractor pages)
2. Phase 1 yield is validated (count the rows, sanity-check a few names)
3. Eric gives explicit go-ahead with focused session time

**Don't build the marketing claim before the data exists.** The order is: data first, claim second, never the reverse.

---

## What I'd ship in the first session (when triggered)

Just Phase 1 — no scope creep:

1. Migration `20260???_federal_contacts.sql`
2. Script `scripts/build-federal-contacts.js` that:
   - Reads from `opengov_iq_contacts` (if populated)
   - Reads from `sam_opportunities.raw_data->pointOfContact`
   - Normalizes name/email/role
   - Upserts into `federal_contacts` with sources[] union
3. SQL count + sanity-check output at the end of the script: "Loaded N total, deduped to M unique, K with verified emails"
4. Update the docs/PRD references — captured but not built: USAspending scrape, agency directories, quality layer

That's it. Don't overscope. Validate the data first; expand later.
