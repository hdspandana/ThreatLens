/**
 * Shared data contracts for the ThreatLens pipeline.
 *
 * These types intentionally separate "what was found" (raw OCR / evidence),
 * "what a human confirmed" (verified text), "what a deterministic system
 * inferred" (signals / risk), "what was retrieved" (reference material),
 * and "what an LLM generated" (explanation) so no layer can silently blend
 * these categories together.
 *
 * Phase 1 (foundation hardening) added a structured PROVENANCE record to
 * every important output and a PIPELINE VERSION block to every analysis so
 * any historical result can answer "where did this come from, and which
 * code/model produced it?".
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Provenance (cross-cutting)
// ---------------------------------------------------------------------------

/**
 * The five epistemic categories that ThreatLens keeps separate end-to-end.
 *   FOUND      – present in the evidence itself (bytes, OCR text, human-verified text)
 *   INFERRED   – produced by a deterministic or statistical model from FOUND data
 *   RETRIEVED  – looked up from a reference source; not derived from the evidence
 *   GENERATED  – produced by a generative model (LLM); never a source of truth
 *   UNCERTAIN  – explicitly flagged as unknown / unverifiable
 */
export const EpistemicStatus = z.enum(["FOUND", "INFERRED", "RETRIEVED", "GENERATED", "UNCERTAIN"]);
export type EpistemicStatusT = z.infer<typeof EpistemicStatus>;

export const ProvenanceSourceType = z.enum([
  "EVIDENCE_FILE",
  "OCR",
  "USER_VERIFIED",
  "TEXT_PROCESSING",
  "RULE",
  "ML",
  "RISK_ENGINE",
  "RETRIEVAL",
  "LLM",
  "DETERMINISTIC_FALLBACK",
  "EXTERNAL_INTELLIGENCE",
  "HUMAN_REVIEW",
]);
export type ProvenanceSourceTypeT = z.infer<typeof ProvenanceSourceType>;

export const ProvenanceSchema = z.object({
  status: EpistemicStatus,
  sourceType: ProvenanceSourceType,
  /** Stable identifier of the producer: rule id, model name, KB chunk id, engine name, ... */
  sourceId: z.string(),
  /** Version of the producer (rule-set version, model version, KB version). Null if not versioned. */
  sourceVersion: z.string().nullable(),
  /** Producer-reported confidence in [0,1]. Null when the producer has no meaningful confidence. */
  confidence: z.number().min(0).max(1).nullable(),
  /** ISO timestamp at which this output was produced. */
  timestamp: z.string(),
  /** Short human-readable statement of how this output was produced. */
  explanation: z.string(),
  /** Identifiers of the upstream inputs this output was derived from (e.g. "verified_text:sha256:..."). */
  derivedFrom: z.array(z.string()),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Versions of every stage that participated in an analysis (reproducibility / audit). */
export const PipelineVersionsSchema = z.object({
  pipelineVersion: z.string(),
  textProcessingVersion: z.string(),
  classifierName: z.string(),
  classifierVersion: z.string(),
  riskEngineVersion: z.string(),
  knowledgeBaseVersion: z.string().nullable(),
  retrievalMethod: z.string(),
  llmProvider: z.string().nullable(),
  llmModel: z.string().nullable(),
  promptVersion: z.string().nullable(),
  ocrEngine: z.string().nullable(),
  ocrEngineVersion: z.string().nullable(),
  ocrLanguageDataSha256: z.string().nullable(),
});
export type PipelineVersions = z.infer<typeof PipelineVersionsSchema>;

// ---------------------------------------------------------------------------
// Cases (foundation for Phase 4 case management)
// ---------------------------------------------------------------------------

export const CaseStatus = z.enum(["OPEN", "UNDER_REVIEW", "CLOSED"]);
export type CaseStatusT = z.infer<typeof CaseStatus>;

export const CaseRecordSchema = z.object({
  id: z.string().uuid(),
  /** Human-friendly reference such as CASE-2026-0001. Unique. */
  reference: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: CaseStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CaseRecord = z.infer<typeof CaseRecordSchema>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const EvidenceRecordSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid().nullable(),
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
  /** tesseract.js package version that produced this result. */
  engineVersion: z.string(),
  language: z.string(),
  /** SHA-256 of the language model file actually loaded (null when OCR did not run). */
  languageDataSha256: z.string().nullable(),
  /** Raw, unmodified OCR output. Never overwritten once created. */
  rawText: z.string(),
  /** Mean word-level confidence reported by the OCR engine, 0-100. */
  confidence: z.number().nullable(),
  regions: z.array(OcrRegionSchema),
  warnings: z.array(z.string()),
  succeeded: z.boolean(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  provenance: ProvenanceSchema,
});
export type OcrResult = z.infer<typeof OcrResultSchema>;

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

export const ProcessedTextSchema = z.object({
  normalizedText: z.string(),
  segments: z.array(z.string()),
  changesApplied: z.array(z.string()),
  /**
   * Instruction-like content found INSIDE the evidence text (e.g. "ignore
   * previous instructions"). Recorded so downstream LLM stages and reviewers
   * know the evidence contains possible prompt-injection payloads. This is a
   * FOUND fact about the text, not an accusation.
   */
  injectionIndicators: z.array(z.string()),
  provenance: ProvenanceSchema,
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

export const DetectionSourceSchema = z.enum(["rule_based", "ml_model", "llm_suggested"]);

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
  /** Stable id of the rule / model output that produced this signal (reproducibility). */
  detectorId: z.string(),
  provenance: ProvenanceSchema,
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
      /** Exact numeric contribution of this category to the pre-cap score (tier * sum(confidence)). */
      contribution: z.number(),
      description: z.string(),
    })
  ),
  uncertainty: z.object({
    level: z.enum(["LOW", "MEDIUM", "HIGH"]),
    reasons: z.array(z.string()),
  }),
  explanation: z.string(),
  engineVersion: z.string(),
  provenance: ProvenanceSchema,
});
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export const RetrievedReferenceSchema = z.object({
  documentId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  title: z.string(),
  source: z.string(),
  snippet: z.string(),
  similarity: z.number(),
  knowledgeBaseVersion: z.string().nullable(),
  provenance: ProvenanceSchema,
});
export type RetrievedReference = z.infer<typeof RetrievedReferenceSchema>;

// ---------------------------------------------------------------------------
// LLM explanation
// ---------------------------------------------------------------------------

export const LlmExplanationSchema = z.object({
  available: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string(),
  summary: z.string(),
  usedFallback: z.boolean(),
  warnings: z.array(z.string()),
  /** Result of the post-generation output guard (prompt-injection / leakage screen). */
  outputGuard: z.object({
    passed: z.boolean(),
    findings: z.array(z.string()),
  }),
  provenance: ProvenanceSchema,
});
export type LlmExplanation = z.infer<typeof LlmExplanationSchema>;

// ---------------------------------------------------------------------------
// Full analysis bundle (persisted)
// ---------------------------------------------------------------------------

export const AnalysisResultSchema = z.object({
  /** Server-assigned id of the persisted analysis row (null before persistence). */
  id: z.string().uuid().nullable(),
  evidenceId: z.string().uuid(),
  /** Correlation id for logs/telemetry -- never carries content. */
  correlationId: z.string(),
  /** SHA-256 of the exact verified text that was analysed, for reproducibility. */
  inputTextSha256: z.string(),
  processedText: ProcessedTextSchema,
  signals: z.array(ThreatSignalSchema),
  risk: RiskAssessmentSchema,
  references: z.array(RetrievedReferenceSchema),
  llm: LlmExplanationSchema,
  pipelineVersions: PipelineVersionsSchema,
  createdAt: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export const AuditAction = z.enum([
  "EVIDENCE_UPLOADED",
  "EVIDENCE_REJECTED",
  "OCR_COMPLETED",
  "OCR_FAILED",
  "TEXT_VERIFIED",
  "ANALYSIS_COMPLETED",
  "ANALYSIS_FAILED",
  "REPORT_GENERATED",
  "CASE_CREATED",
  "CASE_UPDATED",
  "REVIEW_RECORDED",
]);
export type AuditActionT = z.infer<typeof AuditAction>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid().nullable(),
  evidenceId: z.string().uuid().nullable(),
  action: AuditAction,
  /** Local single-user deployment today; becomes a real principal once auth lands (Phase 8). */
  actor: z.string(),
  correlationId: z.string(),
  /** Structured, content-free details (counts, versions, durations). Never message text. */
  details: z.record(z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
