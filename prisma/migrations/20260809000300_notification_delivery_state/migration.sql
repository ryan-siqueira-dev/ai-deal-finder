BEGIN;

CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sending', 'sent', 'failed');

ALTER TABLE "Notification"
  ALTER COLUMN "sentAt" DROP DEFAULT,
  ALTER COLUMN "sentAt" DROP NOT NULL,
  ADD COLUMN "status" "NotificationStatus" NOT NULL DEFAULT 'sent',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT;

ALTER TABLE "Notification"
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ALTER COLUMN "attempts" SET DEFAULT 0;

WITH ranked_notifications AS (
  SELECT
    notification."id",
    ROW_NUMBER() OVER (
      PARTITION BY notification."analysisId", notification."channel"
      ORDER BY notification."sentAt" DESC, notification."id" DESC
    ) AS duplicate_rank
  FROM "Notification" notification
)
DELETE FROM "Notification"
WHERE "id" IN (
  SELECT "id" FROM ranked_notifications WHERE duplicate_rank > 1
);

DROP INDEX "Notification_listingId_searchId_analysisId_channel_key";
DROP INDEX "Notification_analysisId_channel_idx";

CREATE UNIQUE INDEX "Notification_analysisId_channel_key"
ON "Notification"("analysisId", "channel");

CREATE INDEX "Notification_status_claimedAt_idx"
ON "Notification"("status", "claimedAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_attempts_check"
    CHECK ("attempts" >= 0),
  ADD CONSTRAINT "Notification_delivery_state_check"
    CHECK (
      (("status" = 'sent') = ("sentAt" IS NOT NULL))
      AND ("status" <> 'sending' OR "claimedAt" IS NOT NULL)
    );

COMMIT;
