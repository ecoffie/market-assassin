# OpenGov IQ Pre-Handover Checklist

**Status:** Investigating before partner handover. Pick up over the weekend.
**Created:** 2026-05-20

---

## TL;DR risk summary

| Asset | Local snapshot | Supabase | At risk after handover? |
|---|---|---|---|
| `AllSamContacts` (federal contacts) | **1,320 rows** in CSV (PRD says 50K — local is incomplete) | Unknown — needs verification | **YES if Supabase has only 1,320 too** |
| `SAMEntities` | 50,000 rows on disk ✓ | Imported per docs | No |
| `IDIQ_details` | 100,000 rows on disk ✓ | Imported per docs | No |
| Old codebase | 43MB in `~/Market Assasin/opn-g-iq-a31ed6b6/` | N/A | No (already local) |
| OpenGov IQ forecast table | Not yet imported per TODO | Not imported | **YES — never grabbed** |
| Live BigQuery fallback | N/A | N/A | No — see below |

**The live BigQuery fallback in `relationships/route.ts` is currently a no-op in production.** Vercel env vars do not contain `GOOGLE_SERVICE_ACCOUNT_JSON` or `BIGQUERY_SERVICE_ACCOUNT_JSON` (verified 2026-05-20 via `vercel env ls`). So production traffic is already going through Supabase → SAM cache, not BigQuery. Handover does not break production immediately.

---

## What we need to verify this weekend

### 1. Supabase row counts (5 min once credentials work)

The local `.env.local` `SUPABASE_SERVICE_ROLE_KEY` is invalid/expired as of 2026-05-20. Refresh it from Vercel/Supabase, then run:

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
node -e "
const fs = require('fs');
const env = {};
fs.readFileSync('.env.local','utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([^#=]+)=(.*)$/); if(m) env[m[1].trim()] = m[2].replace(/^['\"]|['\"]\$/g,''); });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  for (const t of ['opengov_iq_contacts','opengov_iq_entities','opengov_iq_idiq_vehicles']) {
    const r = await sb.from(t).select('id', { count: 'exact', head: true });
    console.log(t, '→', r.count, '| err:', r.error?.message || 'none');
  }
})();
"
```

**What to look for:**
- `opengov_iq_contacts` should be ≈ **50,000** per PRD. If it's only **1,320**, the local CSV was the full import and we lost 48K contacts. **Critical to know.**
- Other two should match the on-disk CSV counts.

### 2. BigQuery access path (to be sorted before partner signs)

Who set this up: A staff member configured the BigQuery project `fresh-ward-455220-j0` and created a service-account JSON. The JSON was given to Eric to paste into Vercel, then later removed (or never re-added after the project moved). The commit `1b57cec` on 2026-05-12 wired the BigQuery code path but does not contain credentials (correctly — they should never be in git).

**To regain access:**

1. **Ask the staff member directly** which Google Workspace / personal account owns the GCP project `fresh-ward-455220-j0`. Options:
   - The staff member's personal Google account
   - A shared `service@govcongiants.com` or similar GovCon Giants Workspace account
   - A separate OpenGov IQ Workspace
2. **Have them either:**
   - Add `evankoffdev@gmail.com` (or the right Eric Coffie Google account) as **Owner** to the GCP project, OR
   - Generate a fresh service-account JSON with `BigQuery Data Viewer` + `BigQuery Job User` roles and hand off the JSON

3. **Once you have access**, you can:
   ```bash
   # Install gcloud if not installed
   curl https://sdk.cloud.google.com | bash
   exec -l $SHELL
   gcloud auth login
   gcloud config set project fresh-ward-455220-j0

   # List datasets
   bq ls

   # List tables in the samgovcons dataset
   bq ls samgovcons

   # Get exact row counts
   bq query --use_legacy_sql=false "
     SELECT table_id, row_count
     FROM samgovcons.__TABLES__
     ORDER BY row_count DESC
   "
   ```

### 3. Items to grab from BigQuery before signing

Run only after access is restored:

```bash
# Make a fresh dir
mkdir -p ~/Desktop/opengov-iq-final-export
cd ~/Desktop/opengov-iq-final-export

# Full AllSamContacts table (the one we're worried about)
bq extract --destination_format=CSV \
  samgovcons.AllSamContacts \
  gs://YOUR_BUCKET/AllSamContacts.csv

# OR if no bucket — query and save directly
bq query --use_legacy_sql=false --format=csv \
  "SELECT * FROM samgovcons.AllSamContacts" > AllSamContacts.csv

# Check for tables the PRD didn't import
bq ls samgovcons   # look for anything starting with "forecast"

# If forecasts table exists, grab it
bq query --use_legacy_sql=false --format=csv \
  "SELECT * FROM samgovcons.Forecasts" > Forecasts.csv
```

### 4. Other access surfaces to inventory before signing

OpenGov IQ Base44 instance — old codebase at `~/Market Assasin/opn-g-iq-a31ed6b6/` references `base44/functions/*` cloud functions. You said you "have access to opngoviq" — confirm what that access is:
- **Admin dashboard** (web UI to manage users, view data)?
- **Customer/user list** (paying users or beta users to migrate)?
- **Any other databases** beyond BigQuery (Postgres, Mongo, Firestore)?
- **Any third-party API keys / OAuth credentials** in the old account?

Make a list. Anything that's only accessible through OpenGov IQ login should be exported before signing.

### 5. What to tell the partner

The handover document should explicitly carve out:
- **Data that has already been duplicated into Mindy's Supabase** — no obligation to delete (it's our copy)
- **The local CSV exports** in `~/Market Assasin/opn-g-iq-a31ed6b6/` — keep
- **The old codebase** at `~/Market Assasin/opn-g-iq-a31ed6b6/` — keep as reference

The partner is getting:
- The BigQuery project itself (live data source going forward)
- The Base44 instance (if they want it)
- The OpenGov IQ brand and customer relationships

---

## Production code touchpoints to clean up (after handover)

After the partner has the BigQuery project, decouple Mindy from it:

- `src/app/api/mi-beta/relationships/route.ts:23-25` — remove the `BIGQUERY_CONTACTS_*` env-var defaults pointing at `fresh-ward-455220-j0` and `samgovcons.AllSamContacts`
- `src/app/api/mi-beta/relationships/route.ts:174` — remove the `GOOGLE_SERVICE_ACCOUNT_JSON` / `BIGQUERY_SERVICE_ACCOUNT_JSON` env reads
- `src/app/api/mi-beta/relationships/route.ts:491-577` — remove `queryBigQueryContacts()` and its caller chain so the Relationships endpoint falls straight from `opengov_iq_contacts` → SAM cache

Tagging it as "low priority" since it's already a no-op in production.

---

## Owner: Eric (to be done this weekend)

1. Refresh Supabase service-role key in `.env.local` and run the row-count check
2. Contact staff member about BigQuery access
3. Once access works, run the export commands above
4. List OpenGov IQ login surfaces and inventory anything else worth grabbing
5. After handover, schedule the BigQuery code removal as a small cleanup commit
