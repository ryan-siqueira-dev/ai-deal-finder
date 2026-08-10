import { describe, expect, it } from "vitest";
import { GPUAnalyzer, normalizeGpuModel } from "../src/categories/gpu/analyzer.js";
import { VehicleAnalyzer } from "../src/categories/vehicle/analyzer.js";
import { NotebookAnalyzer } from "../src/categories/notebook/analyzer.js";
import { GenericAnalyzer } from "../src/categories/generic/analyzer.js";
import { detectCategory } from "../src/categories/detector.js";
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
  it("does not invent an RTX 1080 from a GeForce model", () => {
    expect(normalizeGpuModel("GeForce 1080 Ti").normalized).toBe("NVIDIA GeForce GTX 1080 TI");
  });
  it("preserves explicit GT models and ignores unrelated years", () => {
    expect(normalizeGpuModel("NVIDIA GeForce GT 1030 2GB").normalized).toBe("NVIDIA GeForce GT 1030");
    expect(normalizeGpuModel("Notebook com GeForce, comprado em 2021").normalized).toBeNull();
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
  it("does not confuse Golf with Gol or tire condition with a new vehicle", async () => {
    const result = await new VehicleAnalyzer().extract(listingFixture({
      title: "Volkswagen Golf 2018",
      description: "Pneus novos; precisa revisar suspensão",
    }));
    expect(result.data).toMatchObject({ model: "golf", condition: "used", maintenanceMentioned: false });
  });
});

describe("NotebookAnalyzer", () => {
  it("extracts specs and compares matching notebooks", async () => {
    const analyzer = new NotebookAnalyzer();
    const a = await analyzer.extract(listingFixture({ title: "Dell notebook i5-1135G7 16GB RAM SSD 512GB", description: "Tela 15,6 polegadas usado" }));
    const b = await analyzer.extract(listingFixture({ title: "Dell laptop i5 1135G7 16 GB RAM 512 GB SSD", description: "usado" }));
    expect(a.data).toMatchObject({ manufacturer: "dell", ramGb: 16, storageGb: 512, storageType: "ssd", screenInches: 15.6 });
    expect(a.data["cpuGeneration"]).toBe(11);
    expect(analyzer.isComparable(a, b)).toBe(true);
  });
  it("recognizes pre-10th-generation Intel model numbers", async () => {
    const result = await new NotebookAnalyzer().extract(listingFixture({ title: "Notebook Intel Core i7-2920XM" }));
    expect(result.data).toMatchObject({ cpu: "i7 2920xm", cpuGeneration: 2 });
  });
});

describe("GenericAnalyzer", () => {
  it("acts as a safe fallback", async () => {
    const result = await new GenericAnalyzer().extract(listingFixture({ title: "Samsung produto usado", description: "Com defeito na tampa" }));
    expect(result.data).toMatchObject({ brand: "samsung", condition: "damaged" });
  });
  it("understands negated defects and requires the same product model", async () => {
    const analyzer = new GenericAnalyzer();
    const phone = await analyzer.extract(listingFixture({ title: "Samsung Galaxy S25", description: "Sem qualquer defeito" }));
    const television = await analyzer.extract(listingFixture({ title: "Samsung Smart TV 75", description: "Sem defeitos" }));
    expect(phone.data["condition"]).not.toBe("damaged");
    expect(analyzer.isComparable(phone, television)).toBe(false);
  });
  it("normalizes token order and storage-unit spacing when comparing models", async () => {
    const analyzer = new GenericAnalyzer();
    const compact = await analyzer.extract(listingFixture({ title: "Apple iPhone 15 Pro 256GB" }));
    const reordered = await analyzer.extract(listingFixture({ title: "256 GB iPhone Pro 15 Apple" }));
    expect(analyzer.isComparable(compact, reordered)).toBe(true);
  });
});

describe("category detection", () => {
  it("classifies a gaming notebook with a discrete GPU as notebook", () => {
    expect(detectCategory(listingFixture({ title: "Notebook gamer Dell RTX 3060" }), "generic")).toBe("notebook");
  });
});
