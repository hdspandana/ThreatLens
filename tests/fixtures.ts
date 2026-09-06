/**
 * Shared, typed fixtures for tests. Building them through the real helpers
 * keeps fixtures in sync with the schema as provenance fields evolve.
 */
import { makeProvenance } from "@/lib/threatlens/provenance";
import type {
  AnalysisResult,
  EvidenceRecord,
  LlmExplanation,
  OcrResult,
  ProcessedText,
  RetrievedReference,
  RiskAssessment,
  ThreatSignal,
} from "@/lib/threatlens/schemas/models";

export const EVIDENCE_ID = "11111111-1111-4111-8111-111111111111";

export function evidenceFixture(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: EVIDENCE_ID,
    caseId: null,
    originalFilename: "screenshot.png",
    storedPath: "storage/evidence/x/original.png",
    declaredMimeType: "image/png",
    detectedMimeType: "image/png",
    sizeBytes: 1234,
    sha256: "a".repeat(64),
    uploadedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function ocrFixture(overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    evidenceId: EVIDENCE_ID,
    engine: "tesseract.js",
    engineVersion: "5.1.1",
    language: "eng",
    languageDataSha256: "b".repeat(64),
    rawText: "I will hurt you",
    confidence: 88,
    regions: [],
    warnings: [],
    succeeded: true,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:01.000Z",
    provenance: makeProvenance({ status: "FOUND", sourceType: "OCR", sourceId: "tesseract.js", explanation: "test" }),
    ...overrides,
  };
}

export function processedTextFixture(text = "I will hurt you", overrides: Partial<ProcessedText> = {}): ProcessedText {
  return {
    normalizedText: text,
    segments: [text],
    changesApplied: [],
    injectionIndicators: [],
    provenance: makeProvenance({ status: "FOUND", sourceType: "USER_VERIFIED", sourceId: "text_processing", explanation: "test" }),
    ...overrides,
  };
}

export function signalFixture(overrides: Partial<ThreatSignal> = {}): ThreatSignal {
  return {
    category: "direct_threat",
    evidenceSpan: "I will hurt you",
    startOffset: 0,
    endOffset: 15,
    confidence: 0.92,
    explanation: "test",
    detectionSource: "rule_based",
    detectorId: "direct_threat.01",
    provenance: makeProvenance({ status: "INFERRED", sourceType: "RULE", sourceId: "direct_threat.01", confidence: 0.92, explanation: "test" }),
    ...overrides,
  };
}

export function riskFixture(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    severity: "HIGH",
    score: 6,
    contributingFactors: [],
    uncertainty: { level: "LOW", reasons: [] },
    explanation: "test",
    engineVersion: "risk_engine_test",
    provenance: makeProvenance({ status: "INFERRED", sourceType: "RISK_ENGINE", sourceId: "risk_scorer", explanation: "test" }),
    ...overrides,
  };
}

export function referenceFixture(overrides: Partial<RetrievedReference> = {}): RetrievedReference {
  return {
    documentId: "kb-001",
    chunkIndex: 0,
    title: "Immediate safety first",
    source: "test dataset",
    snippet: "If you are in danger...",
    similarity: 0.42,
    knowledgeBaseVersion: "kb_test",
    provenance: makeProvenance({ status: "RETRIEVED", sourceType: "RETRIEVAL", sourceId: "kb-001#0", confidence: 0.42, explanation: "test" }),
    ...overrides,
  };
}

export function llmFixture(overrides: Partial<LlmExplanation> = {}): LlmExplanation {
  return {
    available: false,
    provider: null,
    model: null,
    promptVersion: "explain_prompt_test",
    summary: "Deterministic summary for test.",
    usedFallback: true,
    warnings: [],
    outputGuard: { passed: true, findings: [] },
    provenance: makeProvenance({ status: "INFERRED", sourceType: "DETERMINISTIC_FALLBACK", sourceId: "template_summary", explanation: "test" }),
    ...overrides,
  };
}

export function analysisFixture(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    evidenceId: EVIDENCE_ID,
    correlationId: "corr-test",
    inputTextSha256: "c".repeat(64),
    processedText: processedTextFixture(),
    signals: [signalFixture()],
    risk: riskFixture({ contributingFactors: [{ category: "direct_threat", weight: 3, count: 1, contribution: 2.76, description: "1 direct threat signal(s)" }] }),
    references: [referenceFixture()],
    llm: llmFixture(),
    pipelineVersions: {
      pipelineVersion: "pipeline_test",
      textProcessingVersion: "tp_test",
      classifierName: "rule_based",
      classifierVersion: "rules_test",
      riskEngineVersion: "risk_test",
      knowledgeBaseVersion: "kb_test",
      retrievalMethod: "tfidf_test",
      llmProvider: null,
      llmModel: null,
      promptVersion: "prompt_test",
      ocrEngine: "tesseract.js",
      ocrEngineVersion: "5.1.1",
      ocrLanguageDataSha256: "b".repeat(64),
    },
    createdAt: "2026-01-01T00:00:02.000Z",
    ...overrides,
  };
}
