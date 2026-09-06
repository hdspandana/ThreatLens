/**
 * Report generation.
 *
 * Pure functions with no framework dependency (no Next.js/React imports),
 * so this module could be reused from a CLI or a different frontend.
 * The report is explicitly labeled as a working document, not an official
 * legal filing.
 */
import type { AnalysisResult, EvidenceRecord, OcrResult } from "../schemas/models";
import { escapeInlineMarkdown, fencedBlock } from "../security";

/** Epistemic badge rendered next to each finding so a reader can tell FOUND from INFERRED/GENERATED. */
function badge(status: string): string {
  return `[${status}]`;
}

export interface ReportInput {
  evidence: EvidenceRecord;
  ocr: OcrResult | null;
  verifiedText: string | null;
  analysis: AnalysisResult | null;
}

function section(title: string): string {
  return `\n## ${title}\n`;
}

export function generateReportMarkdown(input: ReportInput): string {
  const { evidence, ocr, verifiedText, analysis } = input;
  const lines: string[] = [];

  lines.push(`# ThreatLens Incident Documentation Report`);
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push(
    "\n> **Disclaimer:** This is an automatically generated working document to help organize evidence and " +
      "analysis. It is **not** an official legal document, is not a substitute for legal advice, and does not " +
      "constitute a finding that any offense occurred. Severity and signal labels come from a documented " +
      "heuristic/rule-based system and, where noted, an AI-generated summary. Review all content before " +
      "relying on it."
  );

  lines.push(section("1. Evidence Record (Integrity, not Authenticity)"));
  lines.push(`- **Evidence ID:** ${evidence.id}`);
  if (evidence.caseId) lines.push(`- **Case ID:** ${evidence.caseId}`);
  lines.push(`- **Original filename (as provided by user):** ${escapeInlineMarkdown(evidence.originalFilename)}`);
  lines.push(`- **Uploaded at:** ${evidence.uploadedAt}`);
  lines.push(`- **Declared MIME type:** ${evidence.declaredMimeType}`);
  lines.push(`- **Detected MIME type (magic bytes):** ${evidence.detectedMimeType ?? "unknown"}`);
  lines.push(`- **File size:** ${evidence.sizeBytes} bytes`);
  lines.push(`- **SHA-256:** \`${evidence.sha256}\``);
  lines.push(
    "- **Note:** the SHA-256 hash demonstrates the stored file has not changed since ingestion. It does " +
      "**not** prove the screenshot's underlying content is authentic or was never altered before upload."
  );

  lines.push(section("2. OCR Extraction (Raw, Unverified)"));
  if (ocr) {
    lines.push(`- **Engine:** ${ocr.engine} ${ocr.engineVersion} (language: ${ocr.language})`);
    if (ocr.languageDataSha256) lines.push(`- **Language model SHA-256:** \`${ocr.languageDataSha256}\``);
    lines.push(`- **Provenance:** ${badge(ocr.provenance.status)} ${ocr.provenance.explanation}`);
    lines.push(`- **Succeeded:** ${ocr.succeeded}`);
    lines.push(`- **Confidence:** ${ocr.confidence !== null ? `${ocr.confidence.toFixed(1)}%` : "n/a"}`);
    if (ocr.warnings.length > 0) lines.push(`- **Warnings:** ${ocr.warnings.join(" ")}`);
    if (ocr.errorMessage) lines.push(`- **Error:** ${ocr.errorMessage}`);
    lines.push("\n" + fencedBlock(ocr.rawText || "(no text extracted)"));
  } else {
    lines.push("OCR was not run for this evidence item.");
  }

  lines.push(section("3. Human-Verified Text"));
  lines.push(
    verifiedText && verifiedText.trim().length > 0
      ? `${badge("FOUND")} Human-verified transcription.\n\n` + fencedBlock(verifiedText)
      : "_No human-verified text has been recorded yet._"
  );

  if (analysis) {
    if (analysis.processedText.injectionIndicators && analysis.processedText.injectionIndicators.length > 0) {
      lines.push(
        `\n> **Note:** the verified text contains instruction-like content (${analysis.processedText.injectionIndicators.join(", ")}). ` +
          "It was treated strictly as quoted data by every automated stage."
      );
    }

    lines.push(section("4. Detected Signals (Heuristic, Not a Legal Determination)"));
    if (analysis.signals.length === 0) {
      lines.push("No rule-based signals were detected in the verified text.");
    } else {
      for (const s of analysis.signals) {
        lines.push(
          `- ${badge(s.provenance?.status ?? "INFERRED")} **${s.category}** (confidence ${s.confidence.toFixed(2)}, detector: ${s.detectorId ?? s.detectionSource}): ` +
            `"${escapeInlineMarkdown(s.evidenceSpan)}" — ${s.explanation}`
        );
      }
    }

    lines.push(section("5. Risk / Severity Assessment"));
    lines.push(`- ${badge(analysis.risk.provenance?.status ?? "INFERRED")} **Severity:** ${analysis.risk.severity}`);
    lines.push(`- **Score:** ${analysis.risk.score !== null ? `${analysis.risk.score}/10` : "n/a"}`);
    lines.push(`- **Uncertainty:** ${analysis.risk.uncertainty.level} — ${analysis.risk.uncertainty.reasons.join(" ") || "none noted"}`);
    lines.push(`- **Explanation:** ${analysis.risk.explanation}`);
    if (analysis.risk.contributingFactors.length > 0) {
      lines.push("- **Contributing factors:**");
      for (const f of analysis.risk.contributingFactors) {
        lines.push(`  - ${f.category}: ${f.description}${typeof f.contribution === "number" ? ` Contribution: +${f.contribution}.` : ""}`);
      }
    }

    lines.push(section("6. Retrieved Reference Material"));
    if (analysis.references.length === 0) {
      lines.push("No reference material met the similarity threshold for this text.");
    } else {
      for (const r of analysis.references) {
        lines.push(
          `- ${badge("RETRIEVED")} **${escapeInlineMarkdown(r.title)}** (similarity ${r.similarity}, source: ${escapeInlineMarkdown(r.source)}` +
            `${r.knowledgeBaseVersion ? `, KB ${r.knowledgeBaseVersion}` : ""}): ${r.snippet}`
        );
      }
    }

    lines.push(section("7. AI-Generated Explanation"));
    lines.push(
      `- **Provenance:** ${badge(analysis.llm.provenance?.status ?? (analysis.llm.usedFallback ? "INFERRED" : "GENERATED"))} ` +
        (analysis.llm.usedFallback ? "deterministic template summary (no language model)." : "language-model output; not evidence.")
    );
    lines.push(`- **Available:** ${analysis.llm.available} ${analysis.llm.usedFallback ? "(deterministic fallback used)" : ""}`);
    if (analysis.llm.model) lines.push(`- **Model:** ${analysis.llm.model}`);
    lines.push(`\n${analysis.llm.summary}`);
    if (analysis.llm.warnings.length > 0) {
      lines.push(`\n_Warnings: ${analysis.llm.warnings.join(" ")}_`);
    }
    lines.push(section("8. Reproducibility Metadata"));
    const v = analysis.pipelineVersions;
    if (v) {
      lines.push(`- **Analysis ID:** ${analysis.id ?? "n/a"}`);
      lines.push(`- **Correlation ID:** ${analysis.correlationId}`);
      lines.push(`- **Input text SHA-256:** \`${analysis.inputTextSha256}\``);
      lines.push(`- **Pipeline:** ${v.pipelineVersion}`);
      lines.push(`- **Text processing:** ${v.textProcessingVersion}`);
      lines.push(`- **Classifier:** ${v.classifierName} @ ${v.classifierVersion}`);
      lines.push(`- **Risk engine:** ${v.riskEngineVersion}`);
      lines.push(`- **Retrieval:** ${v.retrievalMethod}${v.knowledgeBaseVersion ? ` over KB ${v.knowledgeBaseVersion}` : ""}`);
      lines.push(`- **LLM:** ${v.llmModel ? `${v.llmProvider}/${v.llmModel}` : "not used"}${v.promptVersion ? ` (prompt ${v.promptVersion})` : ""}`);
      if (v.ocrEngine) lines.push(`- **OCR:** ${v.ocrEngine} ${v.ocrEngineVersion ?? ""}${v.ocrLanguageDataSha256 ? ` (model ${v.ocrLanguageDataSha256.slice(0, 12)}…)` : ""}`);
    }
  } else {
    lines.push(section("4-8. Analysis"));
    lines.push("_Analysis has not been run for this evidence item yet._");
  }

  lines.push(section("9. Provenance Legend"));
  lines.push("- `[FOUND]` present in the evidence itself (file bytes, OCR output, human-verified text).");
  lines.push("- `[INFERRED]` produced by a deterministic rule or scoring heuristic from FOUND data.");
  lines.push("- `[RETRIEVED]` looked up from the bundled reference dataset; not derived from this evidence.");
  lines.push("- `[GENERATED]` written by a language model; explanatory only, never evidence.");
  lines.push("- `[UNCERTAIN]` explicitly unknown or unverifiable.");

  lines.push(section("10. System Limitations"));
  lines.push("- Signal detection uses a transparent, regex/keyword rule-based baseline. It will miss context, sarcasm, and novel phrasing, and can produce false positives.");
  lines.push("- OCR accuracy depends on image quality; low-confidence OCR text should always be manually verified.");
  lines.push("- The retrieval layer searches a small, hand-curated development reference dataset, not a comprehensive legal database.");
  lines.push("- The AI explanation (if used) summarizes the structured findings above; it does not independently verify facts.");
  lines.push("- This tool does not determine legal guilt, innocence, or clinical risk. Consult qualified professionals for those determinations.");

  return lines.join("\n");
}
