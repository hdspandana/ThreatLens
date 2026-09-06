import { describe, expect, it } from "vitest";
import { characterErrorRate, wordErrorRate } from "@/lib/threatlens/utils/textMetrics";

describe("characterErrorRate", () => {
  it("is 0 for identical strings", () => {
    expect(characterErrorRate("hello world", "hello world")).toBe(0);
  });

  it("is 1 when hypothesis is empty and reference is non-empty", () => {
    expect(characterErrorRate("", "hello")).toBe(1);
  });

  it("increases with more character-level edits", () => {
    const small = characterErrorRate("hallo world", "hello world");
    const large = characterErrorRate("xxxxx xxxxx", "hello world");
    expect(small).toBeLessThan(large);
  });
});

describe("wordErrorRate", () => {
  it("is 0 for identical strings", () => {
    expect(wordErrorRate("hello world", "hello world")).toBe(0);
  });

  it("counts one substitution correctly", () => {
    expect(wordErrorRate("hello there", "hello world")).toBeCloseTo(0.5, 5);
  });
});
