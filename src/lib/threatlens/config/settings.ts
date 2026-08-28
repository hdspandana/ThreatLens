/**
 * Centralized configuration for ThreatLens.
 *
 * Design decision: every environment-driven value used anywhere in the
 * application must be read through this module. This keeps constants out of
 * business logic and gives us one place to document defaults, thresholds,
 * and feature flags (per project requirement: "centralize configuration").
 */

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const settings = {
  /** Root directory (outside `public/`) where original evidence bytes are preserved. */
  evidenceStorageDir: envString("THREATLENS_STORAGE_DIR", "storage/evidence"),

  /** Local, bundled tesseract language data directory (avoids runtime CDN dependency). */
  ocrLangDataDir: envString("THREATLENS_OCR_LANGDATA_DIR", "data/tessdata"),
  ocrLanguage: envString("THREATLENS_OCR_LANGUAGE", "eng"),
  /** Below this confidence (0-100), the UI must prompt for human verification. */
  ocrLowConfidenceThreshold: envFloat("THREATLENS_OCR_LOW_CONFIDENCE", 65),

  upload: {
    maxSizeBytes: envInt("THREATLENS_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
    allowedExtensions: [".png", ".jpg", ".jpeg", ".webp", ".bmp"] as string[],
    allowedMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/bmp",
    ] as string[],
  },

  /**
   * Risk engine thresholds on the 0-10 interpretable score produced by
   * `risk/scorer.ts`. These are intentionally simple and documented rather
   * than fitted to data we do not have. Operators can retune via env vars.
   */
  risk: {
    mediumThreshold: envFloat("THREATLENS_RISK_MEDIUM_THRESHOLD", 2.5),
    highThreshold: envFloat("THREATLENS_RISK_HIGH_THRESHOLD", 5),
    criticalThreshold: envFloat("THREATLENS_RISK_CRITICAL_THRESHOLD", 8),
    /** Minimum verified-text length before the engine will attempt scoring at all. */
    minTextLengthForAssessment: envInt("THREATLENS_MIN_TEXT_LENGTH", 3),
  },

  retrieval: {
    topK: envInt("THREATLENS_RETRIEVAL_TOP_K", 3),
    knowledgeBaseDir: envString("THREATLENS_KB_DIR", "data/knowledge_base"),
    /** Below this cosine similarity, a result is considered too weak to show. */
    minSimilarity: envFloat("THREATLENS_RETRIEVAL_MIN_SIMILARITY", 0.03),
  },

  llm: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    apiBaseUrl: envString("THREATLENS_LLM_BASE_URL", "https://api.openai.com/v1"),
    model: envString("THREATLENS_LLM_MODEL", "gpt-4o-mini"),
    enabled: envBool("THREATLENS_LLM_ENABLED", true),
    timeoutMs: envInt("THREATLENS_LLM_TIMEOUT_MS", 20000),
  },

  featureFlags: {
    /** Allows disabling OCR entirely (e.g. constrained environments) and forcing manual transcription. */
    ocrEnabled: envBool("THREATLENS_OCR_ENABLED", true),
    /** Allows disabling retrieval independent of the LLM. */
    retrievalEnabled: envBool("THREATLENS_RETRIEVAL_ENABLED", true),
  },
} as const;

export type ThreatLensSettings = typeof settings;
