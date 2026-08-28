import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ProcessedText, RiskAssessment } from "@/lib/threatlens/schemas/models";

const processedText: ProcessedText = { normalizedText: "I will hurt you", segments: ["I will hurt you"], changesApplied: [] };
const risk: RiskAssessment = {
  severity: "HIGH",
  score: 6,
  contributingFactors: [],
  uncertainty: { level: "LOW", reasons: [] },
  explanation: "test",
};

describe("generateExplanation", () => {
  const ORIGINAL_ENV = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it("falls back to a deterministic summary when no API key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const { generateExplanation } = await import("@/lib/threatlens/llm/service");
    const result = await generateExplanation({ processedText, signals: [], risk, references: [] });

    expect(result.available).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.summary).toMatch(/deterministic/i);
  });

  it("uses the mocked LLM API response when a key is configured", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "This is an AI-generated explanation." } }] }),
    }) as unknown as typeof fetch;

    const { generateExplanation } = await import("@/lib/threatlens/llm/service");
    const result = await generateExplanation({ processedText, signals: [], risk, references: [] });

    expect(result.available).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.summary).toBe("This is an AI-generated explanation.");
  });

  it("falls back gracefully when the LLM API call fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const { generateExplanation } = await import("@/lib/threatlens/llm/service");
    const result = await generateExplanation({ processedText, signals: [], risk, references: [] });

    expect(result.available).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/network down/i);
  });

  it("falls back gracefully on a non-OK HTTP response", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }) as unknown as typeof fetch;

    const { generateExplanation } = await import("@/lib/threatlens/llm/service");
    const result = await generateExplanation({ processedText, signals: [], risk, references: [] });

    expect(result.usedFallback).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/401/);
  });
});
