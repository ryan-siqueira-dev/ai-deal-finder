import { describe, expect, it } from "vitest";
import { GPUAnalyzer, normalizeGpuModel } from "../src/categories/gpu/analyzer.js";
import { VehicleAnalyzer } from "../src/categories/vehicle/analyzer.js";
import { NotebookAnalyzer } from "../src/categories/notebook/analyzer.js";
import { GenericAnalyzer } from "../src/categories/generic/analyzer.js";
import { listingFixture } from "./fixtures/listings.js";

describe("GPUAnalyzer", () => {
  it.each(["3060ti", "RTX3060 TI", "RTX 3060ti", "GeForce 3060 Ti", "Galax RTX 3060 Ti 8GB"])("normalizes %s", (title) => {
    expect(normalizeGpuModel(title).normalized).toBe("NVIDIA GeForce RTX 3060 TI");
  });
  it("extracts GPU fields and compares equivalent cards", async () => {
    const analyzer = new GPUAnalyzer();
    const a = await analyzer.extract(listingFixture({ title: "Galax RTX 3060 Ti 8GB usada com caixa", description: "Nunca usada para mineração, 6 meses de garantia" }));
    const b = await analyzer.extract(listingFixture({ title: "GeForce RTX3060TI 8 GB", description: "Usada" }));
    expect(a.data).toMatchObject({ gpuVendor: "NVIDIA", boardBrand: "galax", vramGb: 8, sellerClaimsNoMining: true });
    expect(analyzer.isComparable(a, b)).toBe(true);
  });
});

describe("VehicleAnalyzer", () => {
  it("extracts vehicle fields and preserves seller claims as claims", async () => {
    const analyzer = new VehicleAnalyzer();
    const result = await analyzer.extract(listingFixture({ title: "BMW 320i 2015 automática", description: "92.000 km, flex, revisada. Nunca foi de leilão." }));
    expect(result.data).toMatchObject({ brand: "bmw", model: "320i", year: 2015, mileage: 92000, transmission: "automatic", sellerClaimsNoAuction: true, auctionMentioned: true });
    expect(result.data["auctionVerified"]).toBeUndefined();
  });
  it("compares nearby model years and mileage", async () => {
    const analyzer = new VehicleAnalyzer();
    const a = await analyzer.extract(listingFixture({ title: "Honda Civic 2018", description: "80 mil km automático flex" }));
    const b = await analyzer.extract(listingFixture({ title: "Honda Civic 2019", description: "95 mil km automático flex" }));
    expect(analyzer.isComparable(a, b)).toBe(true);
  });
});

describe("NotebookAnalyzer", () => {
  it("extracts specs and compares matching notebooks", async () => {
    const analyzer = new NotebookAnalyzer();
    const a = await analyzer.extract(listingFixture({ title: "Dell notebook i5-1135G7 16GB RAM SSD 512GB", description: "Tela 15,6 polegadas usado" }));
    const b = await analyzer.extract(listingFixture({ title: "Dell laptop i5 1135G7 16 GB RAM 512 GB SSD", description: "usado" }));
    expect(a.data).toMatchObject({ manufacturer: "dell", ramGb: 16, storageGb: 512, storageType: "ssd", screenInches: 15.6 });
    expect(analyzer.isComparable(a, b)).toBe(true);
  });
});

describe("GenericAnalyzer", () => {
  it("acts as a safe fallback", async () => {
    const result = await new GenericAnalyzer().extract(listingFixture({ title: "Samsung produto usado", description: "Com defeito na tampa" }));
    expect(result.data).toMatchObject({ brand: "samsung", condition: "damaged" });
  });
});
