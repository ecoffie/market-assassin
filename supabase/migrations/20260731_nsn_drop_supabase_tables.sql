-- NSN — drop the abandoned Supabase tables. The catalog moved to BigQuery (dataset `nsn`);
-- these tables were the failed Postgres load (filled the disk, caused pooler/timeout/disk-full
-- incidents). Dropping them reclaims that disk. getNsnReference() now queries BigQuery.
drop table if exists nsn_part_numbers;
drop table if exists nsn_reference;
