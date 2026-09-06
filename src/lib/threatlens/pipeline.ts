/**
 * End-to-end analysis orchestration.
 *
 * This is the single place that wires text processing -> signal detection
 * -> risk scoring -> retrieval -> LLM explanation together. API routes call
 * this function; it contains no HTTP or UI concerns so it is independently
 * testable.
 *
 * Phase 1 additions:
 *  - every analysis records the version of every stage (PipelineVersions)
 *    plus a SHA-256 of the exact input text, so results are reproducible;
 *  - a correlation id and per-stage durations are emitted through the safe
 *    logger (never content);
 *  - the classifier is consumed through its `ClassificationResult` contract
 *    so an ML model can be swapped in without touching this file.
 */
import { processText, TEXT_PROCESSING_VERSION } from "./text/processing";
import { getDefaultClassifier, type ThreatClassifier } from "./analysis/classifier";
import { assessRisk, RISK_ENGINE_VERSION } from "./risk/scorer";
import { retrieveReferences, RETRIEVAL_METHOD_VERSION } from "./retrieval/service";
import { knowledgeBaseVersion } from "./retrieval/knowledgeBase";
import { generateExplanation, PROMPT_VERSION } from "./llm/service";
import { OCR_ENGINE, OCR_ENGINE_VERSION } from "./ocr/service";
import { settings } from "./config/settings";
import { VERSIONS, sha256Hex } from "./provenance";
import { newCorrelationId, safeLog } from "./security";
import type { AnalysisResult, PipelineVersions } from "./schemas/models";

export interface PipelineInput {
  evidenceId: string;
  verifiedText: string;
  ocrConfidence: number | null;
  /** Language-data hash from the OCR result, when OCR ran (recorded for reproducibility). */
  ocrLanguageDataSha256?: string | null;
  correlationId?: string;
  /** Dependency injection point for tests / alternative classifiers. */
  classifier?: ThreatClassifier;
}

export async function runAnalysisPipeline(params: PipelineInput): Promise<AnalysisResult> {
  const { evidenceId, verifiedText, ocrConfidence } = params;
  const correlationId = params.correlationId ?? newCorrelationId();
  const classifier = params.classifier ?? getDefaultClassifier();
  const classifierMeta = classifier.metadata();
  const timings: Record<string, number> = {};

  let t = Date.now();
  const processedText = processText(verifiedText);
  timings.textProcessingMs = Date.now() - t;

  t = Date.now();
  const classification = await classifier.classify(processedText.normalizedText);
  const signals = classification.signals;
  timings.classifierMs = Date.now() - t;

  t = Date.now();
  const risk = assessRisk({ normalizedText: processedText.normalizedText, signals, ocrConfidence });
  timings.riskMs = Date.now() - t;

  t = Date.now();
  const references =
    risk.severity === "INSUFFICIENT_INFORMATION"
      ? []
      : retrieveReferences(buildRetrievalQuery(processedText.normalizedText, signals.map((s) => s.category)));
  timings.retrievalMs = Date.now() - t;

  t = Date.now();
  const llm = await generateExplanation({ processedText, signals, risk, references });
  timings.llmMs = Date.now() - t;

  const pipelineVersions: PipelineVersions = {
    pipelineVersion: VERSIONS.pipeline,
    textProcessingVersion: TEXT_PROCESSING_VERSION,
    classifierName: classifierMeta.name,
    classifierVersion: classifierMeta.version,
    riskEngineVersion: RISK_ENGINE_VERSION,
    knowledgeBaseVersion: knowledgeBaseVersion(),
    retrievalMethod: RETRIEVAL_METHOD_VERSION,
    llmProvider: llm.provider,
    llmModel: llm.available ? llm.model : null,
    promptVersion: PROMPT_VERSION,
    ocrEngine: ocrConfidence === null && !params.ocrLanguageDataSha256 ? null : OCR_ENGINE,
    ocrEngineVersion: ocrConfidence === null && !params.ocrLanguageDataSha256 ? null : OCR_ENGINE_VERSION,
    ocrLanguageDataSha256: params.ocrLanguageDataSha256 ?? null,
  };

  safeLog("info", "analysis.pipeline.completed", {
    correlationId,
    evidenceId,
    signalCount: signals.length,
    severity: risk.severity,
    referenceCount: references.length,
    llmUsedFallback: llm.usedFallback,
    injectionIndicatorCount: processedText.injectionIndicators.length,
    classifier: `${classifierMeta.name}@${classifierMeta.version}`,
    ...timings,
  });

  return {
    id: null,
    evidenceId,
    correlationId,
    inputTextSha256: sha256Hex(verifiedText),
    processedText,
    signals,
    risk,
    references,
    llm,
    pipelineVersions,
    createdAt: new Date().toISOString(),
  };
}

function buildRetrievalQuery(normalizedText: string, categories: string[]): string {
  const categoryHint = Array.from(new Set(categories)).join(" ");
  // Combine detected categories with the message text so retrieval is
  // grounded in both the specific wording and the abuse type detected.
  return `${categoryHint} ${normalizedText}`.slice(0, 2000);
}

/** Static description of the currently deployed pipeline (for /api/health and reports). */
export function describePipeline(): Omit<PipelineVersions, "llmProvider" | "llmModel"> & { llmConfigured: boolean } {
  return {
    pipelineVersion: VERSIONS.pipeline,
    textProcessingVersion: TEXT_PROCESSING_VERSION,
    classifierName: getDefaultClassifier().metadata().name,
    classifierVersion: getDefaultClassifier().metadata().version,
    riskEngineVersion: RISK_ENGINE_VERSION,
    knowledgeBaseVersion: knowledgeBaseVersion(),
    retrievalMethod: RETRIEVAL_METHOD_VERSION,
    promptVersion: PROMPT_VERSION,
    ocrEngine: OCR_ENGINE,
    ocrEngineVersion: OCR_ENGINE_VERSION,
    ocrLanguageDataSha256: null,
    llmConfigured: settings.llm.enabled && Boolean(settings.llm.apiKey),
  };
}
