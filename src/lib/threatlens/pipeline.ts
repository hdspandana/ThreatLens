/**
 * End-to-end analysis orchestration.
 *
 * This is the single place that wires text processing -> signal detection
 * -> risk scoring -> retrieval -> LLM explanation together. API routes call
 * this function; it contains no HTTP or UI concerns so it is independently
 * testable.
 */
import { processText } from "./text/processing";
import { getDefaultClassifier } from "./analysis/classifier";
import { assessRisk } from "./risk/scorer";
import { retrieveReferences } from "./retrieval/service";
import { generateExplanation } from "./llm/service";
import type { AnalysisResult } from "./schemas/models";

export async function runAnalysisPipeline(params: {
  evidenceId: string;
  verifiedText: string;
  ocrConfidence: number | null;
}): Promise<AnalysisResult> {
  const { evidenceId, verifiedText, ocrConfidence } = params;

  const processedText = processText(verifiedText);
  const classifier = getDefaultClassifier();
  const signals = await classifier.classify(processedText.normalizedText);
  const risk = assessRisk({ normalizedText: processedText.normalizedText, signals, ocrConfidence });

  const references =
    risk.severity === "INSUFFICIENT_INFORMATION"
      ? []
      : retrieveReferences(buildRetrievalQuery(processedText.normalizedText, signals.map((s) => s.category)));

  const llm = await generateExplanation({ processedText, signals, risk, references });

  return {
    evidenceId,
    processedText,
    signals,
    risk,
    references,
    llm,
    createdAt: new Date().toISOString(),
  };
}

function buildRetrievalQuery(normalizedText: string, categories: string[]): string {
  const categoryHint = Array.from(new Set(categories)).join(" ");
  // Combine detected categories with the message text so retrieval is
  // grounded in both the specific wording and the abuse type detected.
  return `${categoryHint} ${normalizedText}`.slice(0, 2000);
}
