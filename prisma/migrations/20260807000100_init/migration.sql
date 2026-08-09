CREATE TABLE "Search" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "query" TEXT NOT NULL, "category" TEXT NOT NULL,
    "minPrice" DECIMAL(14,2), "maxPrice" DECIMAL(14,2), "minYear" INTEGER, "maxYear" INTEGER,
    "location" TEXT, "radiusKm" INTEGER, "minimumScore" INTEGER NOT NULL DEFAULT 70,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60, "providers" TEXT[], "forbiddenWords" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, "lastRunAt" TIMESTAMP(3), CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL, "source" TEXT NOT NULL, "category" TEXT NOT NULL, "externalId" TEXT,
    "fingerprint" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "price" DECIMAL(14,2),
    "currency" TEXT, "location" TEXT, "sellerName" TEXT, "url" TEXT NOT NULL, "normalizedUrl" TEXT NOT NULL,
    "imageUrl" TEXT, "images" TEXT[], "attributes" JSONB, "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "active" BOOLEAN NOT NULL DEFAULT true,
    "rawData" JSONB, "contentHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SearchListing" (
    "searchId" TEXT NOT NULL, "listingId" TEXT NOT NULL, "firstMatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SearchListing_pkey" PRIMARY KEY ("searchId", "listingId")
);
CREATE TABLE "ListingPriceHistory" (
    "id" TEXT NOT NULL, "listingId" TEXT NOT NULL, "price" DECIMAL(14,2) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ListingPriceHistory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StructuredListingData" (
    "id" TEXT NOT NULL, "listingId" TEXT NOT NULL, "category" TEXT NOT NULL, "data" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1, "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StructuredListingData_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ListingAnalysis" (
    "id" TEXT NOT NULL, "listingId" TEXT NOT NULL, "searchId" TEXT NOT NULL, "score" INTEGER NOT NULL,
    "deterministicScore" INTEGER NOT NULL, "verdict" TEXT NOT NULL, "marketMedianPrice" DECIMAL(14,2),
    "estimatedMarketPrice" DECIMAL(14,2), "priceDifferencePercent" DECIMAL(8,2), "advantages" TEXT[],
    "risks" TEXT[], "reason" TEXT NOT NULL, "analysisModel" TEXT, "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ListingAnalysis_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL, "listingId" TEXT NOT NULL, "searchId" TEXT NOT NULL, "analysisId" TEXT NOT NULL,
    "channel" TEXT NOT NULL, "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrossMarketplaceMatch" (
    "id" TEXT NOT NULL, "listingAId" TEXT NOT NULL, "listingBId" TEXT NOT NULL, "confidence" DOUBLE PRECISION NOT NULL,
    "reasons" TEXT[], "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrossMarketplaceMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Listing_source_externalId_key" ON "Listing"("source", "externalId");
CREATE UNIQUE INDEX "Listing_source_normalizedUrl_key" ON "Listing"("source", "normalizedUrl");
CREATE INDEX "Listing_source_fingerprint_idx" ON "Listing"("source", "fingerprint");
CREATE INDEX "Listing_category_active_lastSeenAt_idx" ON "Listing"("category", "active", "lastSeenAt");
CREATE INDEX "Listing_price_idx" ON "Listing"("price");
CREATE INDEX "Search_active_lastRunAt_idx" ON "Search"("active", "lastRunAt");
CREATE INDEX "SearchListing_listingId_idx" ON "SearchListing"("listingId");
CREATE INDEX "ListingPriceHistory_listingId_observedAt_idx" ON "ListingPriceHistory"("listingId", "observedAt");
CREATE UNIQUE INDEX "StructuredListingData_listingId_key" ON "StructuredListingData"("listingId");
CREATE INDEX "StructuredListingData_category_extractedAt_idx" ON "StructuredListingData"("category", "extractedAt");
CREATE INDEX "ListingAnalysis_listingId_searchId_createdAt_idx" ON "ListingAnalysis"("listingId", "searchId", "createdAt");
CREATE INDEX "ListingAnalysis_searchId_score_idx" ON "ListingAnalysis"("searchId", "score");
CREATE UNIQUE INDEX "Notification_listingId_searchId_analysisId_channel_key" ON "Notification"("listingId", "searchId", "analysisId", "channel");
CREATE INDEX "Notification_searchId_sentAt_idx" ON "Notification"("searchId", "sentAt");
CREATE UNIQUE INDEX "CrossMarketplaceMatch_listingAId_listingBId_key" ON "CrossMarketplaceMatch"("listingAId", "listingBId");
CREATE INDEX "CrossMarketplaceMatch_listingBId_idx" ON "CrossMarketplaceMatch"("listingBId");
ALTER TABLE "SearchListing" ADD CONSTRAINT "SearchListing_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchListing" ADD CONSTRAINT "SearchListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingPriceHistory" ADD CONSTRAINT "ListingPriceHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StructuredListingData" ADD CONSTRAINT "StructuredListingData_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingAnalysis" ADD CONSTRAINT "ListingAnalysis_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingAnalysis" ADD CONSTRAINT "ListingAnalysis_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ListingAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrossMarketplaceMatch" ADD CONSTRAINT "CrossMarketplaceMatch_listingAId_fkey" FOREIGN KEY ("listingAId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrossMarketplaceMatch" ADD CONSTRAINT "CrossMarketplaceMatch_listingBId_fkey" FOREIGN KEY ("listingBId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
