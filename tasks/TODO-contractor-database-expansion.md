# TODO: Expand Contractor Database from 2,768 → 50,000+

**Status:** Captured 2026-05-22, deferred for later session
**Trigger:** Eric — "we need to expand the contractor database from opengoviq"
**Related:**
- [`tasks/PRD-contractor-sales-chart.md`](./PRD-contractor-sales-chart.md)
- [`tasks/PRD-seo-contractor-pages-agent.md`](./PRD-seo-contractor-pages-agent.md)
- [`docs/PRD-mi-beta-opengov-iq-gap-analysis.md`](../docs/PRD-mi-beta-opengov-iq-gap-analysis.md)
- [`docs/TODO-mi-beta-opengov-iq-database-buildout.md`](../docs/TODO-mi-beta-opengov-iq-database-buildout.md)

---

## Why this matters

Today: 2,768 contractors in `src/data/contractors.json` (hand-curated subset). After the SEO infrastructure work shipped in `bcafe04`, each contractor = one indexable `/contractors/[slug]` SEO page.

OpenGov IQ has **50,000+ federal contractor entities** in their BigQuery dataset (`SAMEntities` table per `docs/TODO-mi-beta-opengov-iq-database-buildout.md`). That's an **18× expansion** — directly multiplies the SEO acquisition flywheel.

HigherGov / GovTribe rank for tens of thousands of contractor names because they have 50K+ profile pages each. We can match that surface once the entities are ingested.

---

## Where we stand

| Surface | Status |
|---|---|
| `contractors.json` (2,768 rows) | ✅ Currently ingested + SEO-live |
| `/contractors/[slug]` page template | ✅ ISR-cached, drill-down chart, in-app + public |
| `sitemap.xml` with current 2,711 URLs | ✅ Submitted to Google Search Console, accepted |
| OpenGov IQ `AllSamContacts` (federal contact POCs) | ✅ Import script exists (`scripts/import-opengov-iq-contacts.js`) — has run before |
| OpenGov IQ `IDIQ_details` (vehicles + recompetes) | ✅ Audited (`scripts/audit-opengov-idiq-quality.js`) |
| **OpenGov IQ `SAMEntities` (50K+ contractors)** | ⏳ **NOT ingested — this is the work** |
| Per-NAICS / per-PSC / per-agency programmatic SEO pages | ⏳ Separate workstream — see below |

---

## What needs to happen (in order)

### Step 1 — Determine the data-source shape (UNBLOCK QUESTION)

Eric said: "I have access to Base44 but not BigQuery."

Base44 is a no-code platform. OpenGov IQ data could surface there as:
- A table view with CSV export
- A REST API endpoint
- A direct Postgres/Supabase connection
- Something else entirely

**Next session, the first question to answer:** screenshot the Base44 OpenGov IQ surface so we know what export options exist + how many rows are actually visible. Without this we can't pick the right pipeline pattern.

### Step 2 — Migration: `sam_entities` table

```sql
CREATE TABLE sam_entities (
  uei TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  cage_code TEXT,
  duns TEXT,                        -- legacy ID, some older rows still use it
  address JSONB,                    -- {street, city, state, zip, country}
  business_types TEXT[],            -- SDB / 8(a) / WOSB / SDVOSB / HUBZone / etc.
  certifications TEXT[],            -- separate from business_types — set-aside eligibilities
  naics_codes TEXT[],               -- all NAICS the entity is registered under
  primary_naics TEXT,
  registration_status TEXT,         -- 'Active' / 'Expired' / 'Inactive'
  registration_expiry DATE,
  total_obligations_5y NUMERIC,
  contract_count_5y INT,
  agencies_served TEXT[],           -- top agencies by spend
  sam_url TEXT,                     -- deep link back to sam.gov entity record
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  imported_from TEXT                -- 'opengov_iq_base44' / 'usaspending' / 'manual'
);

CREATE INDEX idx_sam_entities_uei         ON sam_entities(uei);
CREATE INDEX idx_sam_entities_company     ON sam_entities(LOWER(company_name));
CREATE INDEX idx_sam_entities_business    ON sam_entities USING gin(business_types);
CREATE INDEX idx_sam_entities_naics       ON sam_entities USING gin(naics_codes);
CREATE INDEX idx_sam_entities_spend       ON sam_entities(total_obligations_5y DESC NULLS LAST);
```

**Bonus:** this also unlocks the certification filter chips deferred in
`tasks/should-cost-builder-v2.md` — `business_types[]` carries the
SDB / 8(a) / WOSB / SDVOSB / HUBZone fields ContractorsPanel needs.

### Step 3 — Import script

Path determined by Step 1:

| Base44 surface | Script pattern |
|---|---|
| CSV export | Clone `scripts/import-opengov-iq-contacts.js` — adapt for entity shape, dedupe by UEI, batch upsert in chunks of 500 |
| REST API | New script: paginated fetch + Supabase upsert, store cursor in a `import_runs` table for resume-on-fail |
| Direct DB | `pg_dump` from Base44 → `pg_restore` into Supabase (no JS script needed) |

### Step 4 — Sitemap rewrite to read from Supabase

`src/app/sitemap.ts` currently reads from `contractors.json`. Update to query `sam_entities`:

```typescript
const { data } = await getSupabase()
  .from('sam_entities')
  .select('uei, company_name, total_obligations_5y')
  .order('total_obligations_5y', { ascending: false, nullsFirst: false });
```

**Sitemap pagination:** Google caps single sitemaps at 50,000 URLs. Even at 50K we hit the limit exactly once. Per Eric ("let's get it first"), shipping a single sitemap is acceptable for the initial expansion. Add pagination later when we layer NAICS/PSC/agency pages on top.

When that day comes:
- `sitemap.xml` becomes a sitemap-index file
- Generate `sitemap-contractors-1.xml`, `sitemap-contractors-2.xml`, etc. — each capped at 50K
- Next.js supports this via the `Sitemap[]` return shape from `generateSitemaps()`

### Step 5 — Update `/contractors/[slug]/page.tsx` lookup

`findContractorBySlug()` in `src/lib/contractor-sales-history.ts` currently reads from `contractors.json`. Switch to a Supabase query against `sam_entities`:

```typescript
export async function findContractorBySlug(slug: string) {
  const { data } = await getSupabase()
    .from('sam_entities')
    .select('*')
    .or(`uei.eq.${slug},slug.eq.${slug}`)  // accept either UEI or name slug
    .maybeSingle();
  return data;
}
```

`generateStaticParams` also needs updating to pre-render the top N from
`sam_entities` instead of `contractors.json`. Top 500 by `total_obligations_5y`
is still the right cutoff — the rest hydrate via ISR.

### Step 6 — Update `/contractors` index page

The tier-based index currently groups all 2,768 into 5 spend tiers. At 50K
we need pagination per tier OR aggressive caps:

| Tier | Current cap | At 50K |
|---|---|---|
| Mega Primes ($1B+) | 100 visible | ~100 (probably under cap) |
| Large ($100M-$1B) | 100 visible | ~500 (need pagination) |
| Mid-Market ($10M-$100M) | 100 visible | ~3K |
| Emerging ($1M-$10M) | 100 visible | ~15K |
| New Entrants (<$1M) | 50 visible | ~30K |

Per-tier "Browse all" sub-pages (`/contractors/large`, `/contractors/mid-market`)
with proper pagination is the right Phase-2 move.

### Step 7 — Verify SEO impact

After Vercel rebuild:
- Visit `/sitemap.xml` and confirm URL count jumped from 2,711 → 50K+
- Re-submit sitemap in Google Search Console
- Force-index the top 10 contractor pages with "Request Indexing"
- Check `/contractors` index page renders without 30K-link wall

---

## Related workstreams (separate efforts)

This TODO is **just the contractor entity expansion**. The full programmatic-SEO play also includes:

| Page type | Status | Est. URLs |
|---|---|---|
| `/contractors/[slug]` | ✅ Live | Will jump from 2,706 → 50K+ via this TODO |
| `/naics/[code]` | ⏳ Not built | ~1,000 |
| `/psc/[code]` | ⏳ Not built | ~3,000 |
| `/agencies/[slug]` | ⏳ Not built | ~307 |
| `/agencies/[parent]/[sub]/[office]` | ⏳ Not built | ~2,000 |
| Cross-section pages (NAICS × agency, state × NAICS, etc.) | ⏳ Not built | ~5,000-10,000 |

The contractor expansion is the highest-leverage single push because:
1. The template already exists
2. The data already exists (just needs ingestion)
3. Search demand is highest ("Booz Allen federal contracts" >> "PSC D316 contractors")

NAICS / PSC / Agency programmatic pages are separate roadmap items —
their templates need to be built from scratch.

---

## Decision when to build this

Two reasonable triggers:

1. **When the current 2,711 pages start showing search impressions in Search Console.** That signals Google IS ranking us — at which point cranking the volume up to 50K is pure leverage. Probably 2-4 weeks from now (2026-06-05 to 2026-06-19).

2. **When the user gives the OK to spend 1 day on it.** Step 1 (Base44 audit) is 30 min. Steps 2-7 are ~6 hours of focused work, mostly waiting on imports.

Don't build before either trigger. The current 2,711 is enough to validate whether the SEO flywheel is even working before we 18× the surface area.
