import { describe, expect, it } from "vitest";
import { retrieveReferences } from "@/lib/threatlens/retrieval/service";

describe("retrieveReferences", () => {
  it("returns relevant results for a stalking-related query", () => {
    const results = retrieveReferences("someone has been following me and watching my house");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.title.toLowerCase().includes("stalking"))).toBe(true);
  });

  it("returns relevant results for an extortion-related query", () => {
    const results = retrieveReferences("they want bitcoin or they will leak my photos");
    const titles = results.map((r) => r.title.toLowerCase());
    expect(titles.some((t) => t.includes("extortion") || t.includes("blackmail"))).toBe(true);
  });

  it("every result retains source metadata", () => {
    const results = retrieveReferences("harassment reporting hotline support");
    for (const r of results) {
      expect(r.source).toBeTruthy();
      expect(r.documentId).toBeTruthy();
    }
  });

  it("returns an empty array for an empty query", () => {
    expect(retrieveReferences("")).toEqual([]);
  });

  it("respects the requested topK", () => {
    const results = retrieveReferences("safety threat abuse contact evidence", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results are sorted by descending similarity", () => {
    const results = retrieveReferences("evidence preservation screenshots hash integrity");
    const sims = results.map((r) => r.similarity);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
  });
});
