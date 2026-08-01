-- NSN Intelligence Layer — DLA PUB LOG / FLIS reference data.
-- Source: DLA FLIS Electronic Reading Room (public, monthly), plain CSV.
--   IDENTIFICATION.zip → P_FLIS_NSN.CSV        (FSC, NIIN, INC, ITEM_NAME)
--   MANAGEMENT.zip     → V_FLIS_MANAGEMENT.CSV  (NIIN, UI, AAC, UNIT_PRICE, EFFECTIVE_DATE)  -- price
--   REFERENCE.zip      → V_FLIS_PART.CSV        (NIIN, PART_NUMBER, CAGE_CODE)
--   CAGE.zip           → P_CAGE.CSV             (CAGE_CODE, COMPANY, CITY, STATE, COUNTRY)
--
-- Join key = NIIN (9-digit). NSN = FSC(4) + NIIN(9).
-- Loaded by scripts/load-nsn-intelligence.ts (streaming, dedup one price/NIIN by newest EFFECTIVE_DATE).
-- Only rows with a real item name OR a price are loaded (~7.2M named, ~5.5M priced; ~10M UNKNOWN stubs skipped).

-- ── One row per NSN: identity + the reference price (deduped from the multi-row management file).
create table if not exists nsn_reference (
  niin            char(9) primary key,
  fsc             char(4),
  nsn             char(13),               -- FSC || NIIN, precomputed for direct NSN lookups
  item_name       text,                   -- FLIS approved item name (null when stub/UNKNOWN)
  inc             char(5),                -- item name code
  unit_price      numeric(14,2),          -- FLIS management standard unit price; NULL = no reference price (never 0-as-free)
  unit_of_issue   char(2),                -- UI (EA, BX, ...)
  aac             char(1),                -- acquisition advice code
  price_date      date,                   -- EFFECTIVE_DATE of the chosen price row (freshness signal)
  publog_month    date,                   -- which monthly PUB LOG snapshot this came from
  updated_at      timestamptz not null default now()
);

create index if not exists nsn_reference_nsn_idx        on nsn_reference (nsn);
create index if not exists nsn_reference_fsc_idx        on nsn_reference (fsc);
-- Trigram index for item-name search (optional intel surface); pg_trgm is already enabled in this DB.
create index if not exists nsn_reference_item_name_trgm on nsn_reference using gin (item_name gin_trgm_ops);

-- ── Many rows per NSN: manufacturer part numbers + CAGE (+ denormalized company name, no runtime join).
create table if not exists nsn_part_numbers (
  id              bigserial primary key,
  niin            char(9) not null,
  part_number     text not null,
  cage_code       char(5),
  company_name    text,                   -- denormalized from P_CAGE at load time
  updated_at      timestamptz not null default now()
);

create index if not exists nsn_part_numbers_niin_idx on nsn_part_numbers (niin);
create index if not exists nsn_part_numbers_cage_idx on nsn_part_numbers (cage_code);
-- Reverse lookup (part number → NSN) for the "I have a part #, what's the NSN" intel direction.
create index if not exists nsn_part_numbers_part_trgm on nsn_part_numbers using gin (part_number gin_trgm_ops);

-- RLS: reference data is public-catalog, read-only. Service-role writes (loader); reads open.
alter table nsn_reference     enable row level security;
alter table nsn_part_numbers  enable row level security;

drop policy if exists nsn_reference_read on nsn_reference;
create policy nsn_reference_read on nsn_reference for select using (true);

drop policy if exists nsn_part_numbers_read on nsn_part_numbers;
create policy nsn_part_numbers_read on nsn_part_numbers for select using (true);
