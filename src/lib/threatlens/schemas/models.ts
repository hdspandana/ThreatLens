/**
 * Shared data contracts for the ThreatLens pipeline.
 *
 * These types intentionally separate "what was found" (raw OCR / evidence),
 * "what a human confirmed" (verified text), "what a deterministic system
 * inferred" (signals / risk), "what was retrieved" (reference material),
 * and "what an LLM generated" (explanation) so no layer can silently blend
 * these categories together.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EvidenceRecordSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string(),
  storedPath: z.string(),
  declaredMimeType: z.string(),
  detectedMimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  uploadedAt: z.string(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

export const OcrRegionSchema = z.object({
  text: z.string(),
  confidence: z.number(),
  bbox: z.object({
    x0: z.number(),
    y0: z.number(),
    x1: z.number(),
    y1: z.number(),
  }),
});
export type OcrRegion = z.infer<typeof OcrRegionSchema>;

export const OcrResultSchema = z.object({
  evidenceId: z.string().uuid(),
  engine: z.literal("tesseract.js"),
  language: z.string(),
  /** Raw, unmodified OCR output. Never overwritten once created. */
  rawText: z.string(),
  /** Mean word-level confidence reported by the OCR engine, 0-100. */
  confidence: z.number().nullable(),
  regions: z.array(OcrRegionSchema),
  warnings: z.array(z.string()),
  succeeded: z.boolean(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});
export type OcrResult = z.infer<typeof OcrResultSchema>;

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

export const ProcessedTextSchema = z.object({
  normalizedText: z.string(),
  segments: z.array(z.string()),
  changesApplied: z.array(z.string()),
});
export type ProcessedText = z.infer<typeof ProcessedTextSchema>;

// ---------------------------------------------------------------------------
// Signals (abuse / threat indicators)
// ---------------------------------------------------------------------------

export const SignalCategory = z.enum([
  "direct_threat",
  "harassment",
  "intimidation",
  "coercion",
  "extortion",
  "blackmail",
  "stalking",
  "sexual_harassment",
  "hate_abusive_language",
  "impersonation",
  "repeated_unwanted_contact",
  "suspicious_demand",
]);
export type SignalCategoryT = z.infer<typeof SignalCategory>;

export const DetectionSourceSchema = z.enum(["rule_based", "llm_suggested"]);

export const ThreatSignalSchema = z.object({
  category: SignalCategory,
  /** The exact substring of the analyzed text that triggered this signal. */
  evidenceSpan: z.string(),
  /** Character offsets into the normalized text, for UI highlighting. */
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  /** Heuristic confidence in [0, 1]. Not a calibrated probability. */
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  detectionSource: DetectionSourceSchema,
});
export type ThreatSignal = z.infer<typeof ThreatSignalSchema>;

// ---------------------------------------------------------------------------
// Risk assessment
// ---------------------------------------------------------------------------

export const SeverityLevel = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
  "INSUFFICIENT_INFORMATION",
]);
export type SeverityLevelT = z.infer<typeof SeverityLevel>;

export const RiskAssessmentSchema = z.object({
  severity: SeverityLevel,
  /** Interpretable 0-10 score. See risk/scorer.ts for exact, documented formula. */
  score: z.number().nullable(),
  contributingFactors: z.array(
    z.object({
      category: SignalCategory,
      weight: z.number(),
      count: z.number().int(),
      description: z.string(),
    })
  ),
  uncertainty: z.object({
    level: z.enum(["LOW", "MEDIUM", "HIGH"]),
    reasons: z.array(z.string()),
  }),
  explanation: z.string(),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export const RetrievedReferenceSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  source: z.string(),
  snippet: z.string(),
  similarity: z.number(),
});
export type RetrievedReference = z.infer<typeof RetrievedReferenceSchema>;

// ---------------------------------------------------------------------------
// LLM explanation
// ---------------------------------------------------------------------------

export const LlmExplanationSchema = z.object({
  available: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  summary: z.string(),
  usedFallback: z.boolean(),
  warnings: z.array(z.string()),
});
export type LlmExplanation = z.infer<typeof LlmExplanationSchema>;

// ---------------------------------------------------------------------------
// Full analysis bundle (persisted)
// ---------------------------------------------------------------------------

export const AnalysisResultSchema = z.object({
  evidenceId: z.string().uuid(),
  processedText: ProcessedTextSchema,
  signals: z.array(ThreatSignalSchema),
  risk: RiskAssessmentSchema,
  references: z.array(RetrievedReferenceSchema),
  llm: LlmExplanationSchema,
  createdAt: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
