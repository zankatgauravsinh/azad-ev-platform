-- Release 3.2 compatibility checks. READ-ONLY (SELECT statements only).
-- Run them against a RESTORED SNAPSHOT of production, never against production itself — see
-- docs/RELEASE-PREPARATION.md, step 4. Expected results are stated with each check.
\pset pager off
\pset footer off
\set ON_ERROR_STOP on
-- Every statement below runs in a read-only transaction; a write would fail.
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;

\echo '== P1 vehicles that lose ordinary identity edits (M4B.2 / M4B.4). Review AVAILABLE/RESERVED rows with has_history = t (restocked vehicles).'
SELECT u."companyId", u.status,
       (EXISTS (SELECT 1 FROM "Sale" s WHERE s."unitId" = u.id)
     OR EXISTS (SELECT 1 FROM "Warranty" w WHERE w."unitId" = u.id)
     OR EXISTS (SELECT 1 FROM "AmcPlan" a WHERE a."unitId" = u.id)) AS has_history,
       count(*)
FROM "InventoryUnit" u
WHERE u."deletedAt" IS NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

\echo '== P2 catalogue rows that become identity-locked (M4B.5): rename / recolour is refused for these.'
SELECT v."companyId", count(DISTINCT v.id) AS locked_variants, count(DISTINCT v."modelId") AS locked_models
FROM "ScooterVariant" v
JOIN "InventoryUnit" u ON u."variantId" = v.id
WHERE u.status NOT IN ('AVAILABLE', 'RESERVED')
   OR EXISTS (SELECT 1 FROM "Sale" s WHERE s."unitId" = u.id)
   OR EXISTS (SELECT 1 FROM "Warranty" w WHERE w."unitId" = u.id)
   OR EXISTS (SELECT 1 FROM "AmcPlan" a WHERE a."unitId" = u.id)
GROUP BY 1;

\echo '== P3a identifiers not stored trimmed and upper-case. EXPECTED: 0 0 0 (otherwise a reviewed data fix is needed before CSV import is used).'
SELECT count(*) FILTER (WHERE vin <> upper(btrim(vin))) AS vin,
       count(*) FILTER (WHERE "motorNumber" <> upper(btrim("motorNumber"))) AS motor,
       count(*) FILTER (WHERE "batteryNumber" <> upper(btrim("batteryNumber"))) AS battery
FROM "InventoryUnit";

\echo '== P3b near-duplicate identifiers (same once trimmed and upper-cased). EXPECTED: no rows.'
SELECT 'vin' AS field, upper(btrim(vin)) AS value, count(*) FROM "InventoryUnit" GROUP BY 2 HAVING count(*) > 1
UNION ALL
SELECT 'motorNumber', upper(btrim("motorNumber")), count(*) FROM "InventoryUnit" GROUP BY 2 HAVING count(*) > 1
UNION ALL
SELECT 'batteryNumber', upper(btrim("batteryNumber")), count(*) FROM "InventoryUnit" GROUP BY 2 HAVING count(*) > 1;

\echo '== P4a active models sharing a normalised name (CSV rows for these need a Brand column; same-brand pairs stay ambiguous).'
SELECT "companyId", lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS normalised_name,
       count(*), string_agg(brand || ' ' || name, ', ' ORDER BY brand) AS models
FROM "ScooterModel"
WHERE "isActive"
GROUP BY 1, 2
HAVING count(*) > 1;

\echo '== P4b variants of one model that collide once normalised (CSV rows for these are refused as ambiguous).'
SELECT "modelId", lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS normalised_name,
       lower(regexp_replace(btrim(colour), '\s+', ' ', 'g')) AS normalised_colour, count(*)
FROM "ScooterVariant"
GROUP BY 1, 2, 3
HAVING count(*) > 1;

\echo '== P5 companies with GST enabled. EXPECTED: no rows. Any row BLOCKS the release: in 3.2 this flag turns on GST calculation for sales.'
SELECT "companyId", "gstEnabled", "gstNumber" IS NOT NULL AS has_gstin
FROM "CompanySetting"
WHERE "gstEnabled";

\echo '== M1 applied migrations. EXPECTED on production before deploying 3.2: the 21 migrations of release/2.0, none failed or rolled back,'
\echo '   and none of 20261004173939_tax_foundation, 20261005170323_sale_tax_snapshots, 20261007124942_catalog_model_tenant_unique.'
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations"
ORDER BY started_at;

\echo '== M2 indexes on ScooterModel. EXPECTED before 3.2: ScooterModel_brand_name_key present (the new migration drops it).'
SELECT indexname FROM pg_indexes WHERE tablename = 'ScooterModel' ORDER BY 1;

\echo '== M3 (companyId, brand, name) duplicates that would break the new unique index. EXPECTED: no rows.'
SELECT "companyId", brand, name, count(*)
FROM "ScooterModel"
GROUP BY 1, 2, 3
HAVING count(*) > 1;

\echo '== M4 tables the 3.2 migrations create. EXPECTED before 3.2: all NULL (none exists yet).'
SELECT to_regclass('"TaxClassification"') AS tax_classification, to_regclass('"TaxRate"') AS tax_rate,
       to_regclass('"TaxComponentMapping"') AS tax_component_mapping, to_regclass('"TaxSnapshot"') AS tax_snapshot,
       to_regclass('"TaxSnapshotLine"') AS tax_snapshot_line;
