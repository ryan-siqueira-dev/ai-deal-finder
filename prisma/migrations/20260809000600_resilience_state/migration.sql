BEGIN;

-- A suppressed listing keeps only its marketplace identity as a durable
-- tombstone. This prevents a user-deleted item from being recreated by the
-- next collection cycle.
ALTER TABLE "Listing" ADD COLUMN "suppressedAt" TIMESTAMP(3);

CREATE INDEX "Listing_suppressedAt_idx" ON "Listing"("suppressedAt");

-- Failed LLM attempts are timestamped separately from successful model output
-- so transient failures can be retried with a bounded backoff.
ALTER TABLE "ListingAnalysis" ADD COLUMN "llmAttemptedAt" TIMESTAMP(3);

COMMIT;
