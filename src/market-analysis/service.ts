import { calculateMarketStatistics, type MarketStatistics, type PricedListing } from "./statistics.js";

export class MarketAnalysisService {
  calculate(listings: readonly PricedListing[]): MarketStatistics {
    return calculateMarketStatistics(listings);
  }
}
