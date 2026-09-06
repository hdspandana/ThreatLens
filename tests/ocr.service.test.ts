import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("runOcr", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("returns a structured, non-throwing result when OCR is disabled via config", async () => {
    process.env.THREATLENS_OCR_ENABLED = "false";
    const { runOcr } = await import("@/lib/threatlens/ocr/service");
    const result = await runOcr({ evidenceId: "11111111-1111-1111-1111-111111111111", imageBuffer: Buffer.from("x") });

    expect(result.succeeded).toBe(false);
    expect(result.rawText).toBe("");
    expect(result.warnings.join(" ")).toMatch(/disabled/i);
  });

  it("fails gracefully (does not throw) on unrecognizable image bytes", async () => {
    const { runOcr } = await import("@/lib/threatlens/ocr/service");
    const result = await runOcr({
      evidenceId: "22222222-2222-2222-2222-222222222222",
      imageBuffer: Buffer.from("this is not a real image"),
    });
    // Whatever tesseract does with garbage bytes, the service must return a
    // well-formed OcrResult rather than throwing.
    expect(typeof result.succeeded).toBe("boolean");
    expect(Array.isArray(result.warnings)).toBe(true);
  }, 30000);
});
