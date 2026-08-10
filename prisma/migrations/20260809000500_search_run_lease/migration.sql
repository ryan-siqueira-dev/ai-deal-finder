BEGIN;

ALTER TABLE "Search"
  ADD COLUMN "runLeaseId" TEXT,
  ADD COLUMN "runLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "Search_runLeaseExpiresAt_idx"
ON "Search"("runLeaseExpiresAt");

ALTER TABLE "Search"
  ADD CONSTRAINT "Search_run_lease_check"
    CHECK (("runLeaseId" IS NULL) = ("runLeaseExpiresAt" IS NULL));

COMMIT;
