BEGIN;

-- Normalize whitespace and nullable arrays produced by the initial schema
-- before evaluating legacy invariants.
UPDATE "Search"
SET
  "name" = BTRIM("name"),
  "query" = BTRIM("query"),
  "providers" = ARRAY(
    SELECT DISTINCT provider
    FROM unnest(COALESCE("providers", ARRAY[]::TEXT[])) AS provider
    ORDER BY provider
  ),
  "forbiddenWords" = ARRAY(
    SELECT DISTINCT BTRIM(word)
    FROM unnest(COALESCE("forbiddenWords", ARRAY[]::TEXT[])) AS word
    WHERE NULLIF(BTRIM(word), '') IS NOT NULL
    ORDER BY BTRIM(word)
  );

UPDATE "Listing" SET "images" = COALESCE("images", ARRAY[]::TEXT[]);
UPDATE "ListingAnalysis"
SET
  "advantages" = COALESCE("advantages", ARRAY[]::TEXT[]),
  "risks" = COALESCE("risks", ARRAY[]::TEXT[]);
UPDATE "CrossMarketplaceMatch" SET "reasons" = COALESCE("reasons", ARRAY[]::TEXT[]);

-- Normalize values accepted by older CLI versions before making the invariants
-- enforceable. Invalid searches are kept, but potentially surprising ones are
-- disabled so an operator can review them before running them again.
UPDATE "Search"
SET
  "active" = FALSE,
  "name" = CASE
    WHEN NULLIF(BTRIM("name"), '') IS NULL THEN '[pesquisa legada inválida]'
    ELSE LEFT(BTRIM("name"), 120)
  END,
  "query" = CASE
    WHEN NULLIF(BTRIM("query"), '') IS NULL THEN '[consulta legada inválida]'
    ELSE LEFT(BTRIM("query"), 300)
  END,
  "category" = CASE
    WHEN "category" IN ('vehicle', 'gpu', 'notebook', 'electronics', 'generic') THEN "category"
    ELSE 'generic'
  END,
  "minPrice" = CASE WHEN "minPrice" >= 0 THEN "minPrice" ELSE NULL END,
  "maxPrice" = CASE WHEN "maxPrice" >= 0 THEN "maxPrice" ELSE NULL END,
  "minYear" = CASE WHEN "minYear" BETWEEN 1900 AND 2200 THEN "minYear" ELSE NULL END,
  "maxYear" = CASE WHEN "maxYear" BETWEEN 1900 AND 2200 THEN "maxYear" ELSE NULL END,
  "minimumScore" = LEAST(100, GREATEST(0, "minimumScore")),
  "intervalMinutes" = CASE WHEN "intervalMinutes" BETWEEN 1 AND 525600 THEN "intervalMinutes" ELSE 60 END,
  "radiusKm" = CASE WHEN "radiusKm" BETWEEN 1 AND 2000 AND NULLIF(BTRIM("location"), '') IS NOT NULL THEN "radiusKm" ELSE NULL END,
  "providers" = CASE
    WHEN cardinality(ARRAY(SELECT DISTINCT provider FROM unnest("providers") AS provider WHERE provider IN ('facebook', 'olx', 'mercadolivre'))) > 0
      THEN ARRAY(SELECT DISTINCT provider FROM unnest("providers") AS provider WHERE provider IN ('facebook', 'olx', 'mercadolivre') ORDER BY provider)
    ELSE ARRAY['mercadolivre']::TEXT[]
  END
WHERE
  (NULLIF(BTRIM("name"), '') IS NULL OR CHAR_LENGTH(BTRIM("name")) > 120)
  OR (NULLIF(BTRIM("query"), '') IS NULL OR CHAR_LENGTH(BTRIM("query")) > 300)
  OR "category" NOT IN ('vehicle', 'gpu', 'notebook', 'electronics', 'generic')
  OR "minPrice" < 0 OR "maxPrice" < 0
  OR ("minPrice" IS NOT NULL AND "maxPrice" IS NOT NULL AND "minPrice" > "maxPrice")
  OR "minYear" NOT BETWEEN 1900 AND 2200 OR "maxYear" NOT BETWEEN 1900 AND 2200
  OR ("minYear" IS NOT NULL AND "maxYear" IS NOT NULL AND "minYear" > "maxYear")
  OR "minimumScore" NOT BETWEEN 0 AND 100
  OR "intervalMinutes" NOT BETWEEN 1 AND 525600
  OR ("radiusKm" IS NOT NULL AND ("radiusKm" NOT BETWEEN 1 AND 2000 OR NULLIF(BTRIM("location"), '') IS NULL))
  OR cardinality("providers") = 0
  OR NOT ("providers" <@ ARRAY['facebook', 'olx', 'mercadolivre']::TEXT[]);

-- Correct inverted ranges after invalid endpoints above have been nulled.
UPDATE "Search"
SET "minPrice" = "maxPrice", "maxPrice" = "minPrice", "active" = FALSE
WHERE "minPrice" IS NOT NULL AND "maxPrice" IS NOT NULL AND "minPrice" > "maxPrice";

UPDATE "Search"
SET "minYear" = "maxYear", "maxYear" = "minYear", "active" = FALSE
WHERE "minYear" IS NOT NULL AND "maxYear" IS NOT NULL AND "minYear" > "maxYear";

UPDATE "ListingAnalysis"
SET
  "score" = LEAST(100, GREATEST(0, "score")),
  "deterministicScore" = LEAST(90, GREATEST(0, "deterministicScore"))
WHERE "score" NOT BETWEEN 0 AND 100 OR "deterministicScore" NOT BETWEEN 0 AND 90;

DELETE FROM "CrossMarketplaceMatch" WHERE "listingAId" = "listingBId";

WITH ranked_matches AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY LEAST("listingAId", "listingBId"), GREATEST("listingAId", "listingBId")
      ORDER BY "confidence" DESC, "updatedAt" DESC, "id" DESC
    ) AS duplicate_rank
  FROM "CrossMarketplaceMatch"
)
DELETE FROM "CrossMarketplaceMatch"
WHERE "id" IN (SELECT "id" FROM ranked_matches WHERE duplicate_rank > 1);

UPDATE "CrossMarketplaceMatch"
SET
  "listingAId" = LEAST("listingAId", "listingBId"),
  "listingBId" = GREATEST("listingAId", "listingBId"),
  "confidence" = LEAST(1, GREATEST(0, "confidence"));

ALTER TABLE "Search"
  ADD CONSTRAINT "Search_name_check"
    CHECK (NULLIF(BTRIM("name"), '') IS NOT NULL AND CHAR_LENGTH("name") <= 120),
  ADD CONSTRAINT "Search_query_check"
    CHECK (NULLIF(BTRIM("query"), '') IS NOT NULL AND CHAR_LENGTH("query") <= 300),
  ADD CONSTRAINT "Search_category_check"
    CHECK ("category" IN ('vehicle', 'gpu', 'notebook', 'electronics', 'generic')),
  ADD CONSTRAINT "Search_price_range_check"
    CHECK (("minPrice" IS NULL OR "minPrice" >= 0) AND ("maxPrice" IS NULL OR "maxPrice" >= 0) AND ("minPrice" IS NULL OR "maxPrice" IS NULL OR "minPrice" <= "maxPrice")),
  ADD CONSTRAINT "Search_year_range_check"
    CHECK (("minYear" IS NULL OR "minYear" BETWEEN 1900 AND 2200) AND ("maxYear" IS NULL OR "maxYear" BETWEEN 1900 AND 2200) AND ("minYear" IS NULL OR "maxYear" IS NULL OR "minYear" <= "maxYear")),
  ADD CONSTRAINT "Search_minimum_score_check"
    CHECK ("minimumScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Search_interval_check"
    CHECK ("intervalMinutes" BETWEEN 1 AND 525600),
  ADD CONSTRAINT "Search_radius_check"
    CHECK ("radiusKm" IS NULL OR ("radiusKm" BETWEEN 1 AND 2000 AND NULLIF(BTRIM("location"), '') IS NOT NULL)),
  ADD CONSTRAINT "Search_providers_check"
    CHECK (cardinality("providers") > 0 AND "providers" <@ ARRAY['facebook', 'olx', 'mercadolivre']::TEXT[]);

ALTER TABLE "ListingAnalysis"
  ADD CONSTRAINT "ListingAnalysis_score_check"
    CHECK ("score" BETWEEN 0 AND 100 AND "deterministicScore" BETWEEN 0 AND 90);

ALTER TABLE "CrossMarketplaceMatch"
  ADD CONSTRAINT "CrossMarketplaceMatch_canonical_pair_check"
    CHECK ("listingAId" < "listingBId"),
  ADD CONSTRAINT "CrossMarketplaceMatch_confidence_check"
    CHECK ("confidence" BETWEEN 0 AND 1);

ALTER TABLE "Search"
  ALTER COLUMN "providers" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "providers" SET NOT NULL,
  ALTER COLUMN "forbiddenWords" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "forbiddenWords" SET NOT NULL;

ALTER TABLE "Listing"
  ALTER COLUMN "images" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "images" SET NOT NULL;

ALTER TABLE "ListingAnalysis"
  ALTER COLUMN "advantages" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "advantages" SET NOT NULL,
  ALTER COLUMN "risks" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "risks" SET NOT NULL;

ALTER TABLE "CrossMarketplaceMatch"
  ALTER COLUMN "reasons" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "reasons" SET NOT NULL;

COMMIT;
