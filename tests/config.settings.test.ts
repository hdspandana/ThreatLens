import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("settings", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("provides sensible defaults when env vars are unset", async () => {
    delete process.env.THREATLENS_MAX_UPLOAD_BYTES;
    const { settings } = await import("@/lib/threatlens/config/settings");
    expect(settings.upload.maxSizeBytes).toBeGreaterThan(0);
    expect(settings.risk.mediumThreshold).toBeLessThan(settings.risk.highThreshold);
    expect(settings.risk.highThreshold).toBeLessThan(settings.risk.criticalThreshold);
  });

  it("respects overridden env vars", async () => {
    process.env.THREATLENS_MAX_UPLOAD_BYTES = "12345";
    process.env.THREATLENS_OCR_ENABLED = "false";
    const { settings } = await import("@/lib/threatlens/config/settings");
    expect(settings.upload.maxSizeBytes).toBe(12345);
    expect(settings.featureFlags.ocrEnabled).toBe(false);
  });

  it("never applies a hardcoded fallback value for secrets", async () => {
    delete process.env.OPENAI_API_KEY;
    const { settings } = await import("@/lib/threatlens/config/settings");
    expect(settings.llm.apiKey).toBe("");
  });
});
