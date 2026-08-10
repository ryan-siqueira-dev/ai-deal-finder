BEGIN;

WITH ranked_analyses AS (
  SELECT
    analysis."id",
    ROW_NUMBER() OVER (
      PARTITION BY analysis."listingId", analysis."searchId", analysis."inputHash"
      ORDER BY
        EXISTS (SELECT 1 FROM "Notification" notification WHERE notification."analysisId" = analysis."id") DESC,
        analysis."createdAt" DESC,
        analysis."id" DESC
    ) AS duplicate_rank
  FROM "ListingAnalysis" analysis
)
DELETE FROM "ListingAnalysis"
WHERE "id" IN (
  SELECT "id" FROM ranked_analyses WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX "ListingAnalysis_listingId_searchId_inputHash_key"
ON "ListingAnalysis"("listingId", "searchId", "inputHash");

CREATE INDEX "Notification_analysisId_channel_idx"
ON "Notification"("analysisId", "channel");

COMMIT;
