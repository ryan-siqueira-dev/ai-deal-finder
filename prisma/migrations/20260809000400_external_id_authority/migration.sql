BEGIN;

-- External marketplace IDs are authoritative. A URL can be reused or returned
-- for more than one explicit ID, while listings without an ID still need URL
-- uniqueness to make retries idempotent.
DROP INDEX "Listing_source_normalizedUrl_key";

CREATE INDEX "Listing_source_normalizedUrl_idx"
ON "Listing"("source", "normalizedUrl");

CREATE UNIQUE INDEX "Listing_source_normalizedUrl_without_external_id_key"
ON "Listing"("source", "normalizedUrl")
WHERE "externalId" IS NULL;

COMMIT;
