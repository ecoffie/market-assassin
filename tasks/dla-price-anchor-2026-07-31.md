
## RESEARCH VERDICT (2026-07-31) — sources confirmed against real NSNs

**Chosen path: DLA PUB LOG govt reference price. Free, no Apify. (Eric picked this.)**

### What's free + server-side vs. not
- **DECODE (NSN→CAGE+part#+item name):** FREE.
  - `https://www.iso-group.com/NSN/{nsn-dashed}` — plain GET works, robots ALLOWS ClaudeBot
    (Crawl-delay 2), no JS. Best LIVE per-NSN decode. Old NSNs sometimes lack a ref part#.
  - **PUB LOG** (DLA FLIS Electronic Reading Room) — authoritative bulk file, free, no login,
    monthly. Carries NSN→CAGE+part#+item name+**unit price**. = decode + reference price in one.
- **REFERENCE PRICE:** FREE via PUB LOG bulk (govt unit price). GSA "NSN Extract" (data.gov)
  also free but STALE (~2017). = defensible "DLA/GSA reference price".
- **LIVE COMMERCIAL RETAIL price (Grainger/McMaster/GSA Advantage/Fastenal/Zoro):** ALL
  bot-blocked (Akamai/403) or JS SPA → **forces headless or paid API**. This is the ONE step
  that isn't free. Deferred (phase 2, only if Eric wants live retail).
- **DIBBS live / WebFLIS:** BLOCKED — /dodwarning.aspx consent gate needs a session cookie
  (headless only). Confirms prior WAF finding.
- **IMAGE:** effectively unavailable free. Only WBParts has part visuals, but robots DISALLOWS
  ClaudeBot, URL isn't NSN-derivable (page-scrape needed), thin coverage (4/5 NSNs had none).
  → images are best-effort/phase-2, NOT a core feature.

### Existing code to reuse (don't rebuild)
- `src/lib/dibbs/ingest.ts` — DLA/DIBBS ingest lib; `dibbs_rfqs` table (has nsn/fsc/etc.).
- `src/app/api/app/opportunity-detail/route.ts` — `decodeNSNsInOpp()` (LOCAL fn) extracts NSNs
  from text + decodes **FSC only** via `src/lib/codes/fsc.ts`. Returns `nsnDecodes` to the drawer.
  PUB LOG ADDS part#/item-name/price on top of the FSC we already show.
- `src/app/api/app/dibbs/route.ts`, `src/app/api/cron/sync-dibbs/route.ts` — existing DIBBS surfaces.
- Drawer slots already exist: `.dla-quote` calculator + `.dla-photo` ("Photo soon").

### Build shape (pending PUB LOG file-format verification)
- Bulk file → one-time loader + monthly refresh (NOT a live per-request fetch).
- New table (e.g. `nsn_catalog`: niin PK, nsn, cage, part_number, item_name, unit_price,
  price_source, updated_at) — migration hand-run by Eric.
- Shared lib `getNsnReference(nsn)` with honest {grounded, degraded}; drawer + detail route + any
  MCP tool reuse it. "no commercial/catalog match" when NSN absent — never fabricate.
- Drawer: show "DLA reference: $X / <unit>" + part#/item name near `.dla-quote`; ISO Group live
  fill-in for NSNs missing from the snapshot (cache hard, respect Crawl-delay 2).

## BREAKTHROUGH (2026-07-31) — new Reading Room format is PLAIN CSV. No Windows needed.

DLA's FLIS Electronic Reading Room offers the data as per-topic .zip of **quoted CSV**
(NOT the DVD's proprietary compressed .TAB). Downloaded to ~/Downloads/:
- IDENTIFICATION.zip → **P_FLIS_NSN.CSV** (FSC,NIIN,INC,ITEM_NAME,...) — item name
- MANAGEMENT.zip → **V_FLIS_MANAGEMENT.CSV** (NIIN,...,UI,...,UNIT_PRICE,...) — PRICE (1.5GB)
- REFERENCE.zip → **V_FLIS_PART.CSV** (NIIN,PART_NUMBER,CAGE_CODE,...) — part#/CAGE
- CAGE.zip → **P_CAGE.CSV** (CAGE_CODE,...,COMPANY,...) — company name
+ 4 "FOIA Layout" PDFs. Decomp.exe/Windows path ABANDONED.

### VERIFIED end-to-end on 3 real NIINs (before building):
- 000000050 COMPRESSOR UNIT,RECIPROCATING → $3,228.01/EA, part TGR5-2M-3, CAGE 11568
- 000000057 CLOSER,DOOR → $46.20/EA, parts BHMA-A156.4 (x2), CAGE 41280
- 000000042 CK FILTER ASSEMBLY → NO mgmt row (real item, no price) — honest miss case

### Loader design nuances found in the real data (must handle):
1. MULTIPLE mgmt rows per NIIN (one per service/MOE) → DEDUP to 1 price/NIIN, newest EFFECTIVE_DATE.
2. MULTIPLE part rows per NIIN → keep all in child table; show primary in drawer.
3. Not every NSN has a price row (000000042) → grounded=false "no reference price", NEVER fabricate.
4. UNIT_PRICE is zero-padded "000003228.01" → parseFloat. "0.0000"/"$0.00" = NO price, not free.
5. NIIN join key = 9-digit; NSN = FSC(4)+NIIN(9). ITEM_NAME sometimes "UNKNOWN"/INC 77777 (stub).
6. Files are quoted CSV, 1-1.6GB each uncompressed → stream-parse (readline), never load whole.

### Build (next):
- Migration: nsn_reference(niin PK, fsc, item_name, unit_price NUMERIC null, ui, aac, price_date)
  + nsn_part_numbers(niin, part_number, cage_code, company_name). Hand-run via pbcopy.
- Local tsx streaming loader (unzip -p | readline parser), concurrency-batched upserts. ASK before bulk write.
- getNsnReference(nsn) lib {grounded,degraded} → drawer .dla-quote: "DLA reference: $X / UI" + part#/item name.
