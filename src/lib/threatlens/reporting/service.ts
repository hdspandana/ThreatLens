/**
 * Report generation.
 *
 * Pure functions with no framework dependency (no Next.js/React imports),
 * so this module could be reused from a CLI or a different frontend.
 * The report is explicitly labeled as a working document, not an official
 * legal filing.
 */
import type { AnalysisResult, EvidenceRecord, OcrResult } from "../schemas/models";

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
  lines.push(`- **Original filename (as provided by user):** ${evidence.originalFilename}`);
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
    lines.push(`- **Engine:** ${ocr.engine} (language: ${ocr.language})`);
    lines.push(`- **Succeeded:** ${ocr.succeeded}`);
    lines.push(`- **Confidence:** ${ocr.confidence !== null ? `${ocr.confidence.toFixed(1)}%` : "n/a"}`);
    if (ocr.warnings.length > 0) lines.push(`- **Warnings:** ${ocr.warnings.join(" ")}`);
    if (ocr.errorMessage) lines.push(`- **Error:** ${ocr.errorMessage}`);
    lines.push("\n```\n" + (ocr.rawText || "(no text extracted)") + "\n```");
  } else {
    lines.push("OCR was not run for this evidence item.");
  }

  lines.push(section("3. Human-Verified Text"));
  lines.push(
    verifiedText && verifiedText.trim().length > 0
      ? "\n```\n" + verifiedText + "\n```"
      : "_No human-verified text has been recorded yet._"
  );

  if (analysis) {
    lines.push(section("4. Detected Signals (Heuristic, Not a Legal Determination)"));
    if (analysis.signals.length === 0) {
      lines.push("No rule-based signals were detected in the verified text.");
    } else {
      for (const s of analysis.signals) {
        lines.push(
          `- **${s.category}** (confidence ${s.confidence.toFixed(2)}, source: ${s.detectionSource}): ` +
            `"${s.evidenceSpan}" — ${s.explanation}`
        );
      }
    }

    lines.push(section("5. Risk / Severity Assessment"));
    lines.push(`- **Severity:** ${analysis.risk.severity}`);
    lines.push(`- **Score:** ${analysis.risk.score !== null ? `${analysis.risk.score}/10` : "n/a"}`);
    lines.push(`- **Uncertainty:** ${analysis.risk.uncertainty.level} — ${analysis.risk.uncertainty.reasons.join(" ") || "none noted"}`);
    lines.push(`- **Explanation:** ${analysis.risk.explanation}`);
    if (analysis.risk.contributingFactors.length > 0) {
      lines.push("- **Contributing factors:**");
      for (const f of analysis.risk.contributingFactors) {
        lines.push(`  - ${f.category}: ${f.description}`);
      }
    }

    lines.push(section("6. Retrieved Reference Material"));
    if (analysis.references.length === 0) {
      lines.push("No reference material met the similarity threshold for this text.");
    } else {
      for (const r of analysis.references) {
        lines.push(`- **${r.title}** (similarity ${r.similarity}, source: ${r.source}): ${r.snippet}`);
      }
    }

    lines.push(section("7. AI-Generated Explanation"));
    lines.push(`- **Available:** ${analysis.llm.available} ${analysis.llm.usedFallback ? "(deterministic fallback used)" : ""}`);
    if (analysis.llm.model) lines.push(`- **Model:** ${analysis.llm.model}`);
    lines.push(`\n${analysis.llm.summary}`);
    if (analysis.llm.warnings.length > 0) {
      lines.push(`\n_Warnings: ${analysis.llm.warnings.join(" ")}_`);
    }
  } else {
    lines.push(section("4-7. Analysis"));
    lines.push("_Analysis has not been run for this evidence item yet._");
  }

  lines.push(section("8. System Limitations"));
  lines.push("- Signal detection uses a transparent, regex/keyword rule-based baseline. It will miss context, sarcasm, and novel phrasing, and can produce false positives.");
  lines.push("- OCR accuracy depends on image quality; low-confidence OCR text should always be manually verified.");
  lines.push("- The retrieval layer searches a small, hand-curated development reference dataset, not a comprehensive legal database.");
  lines.push("- The AI explanation (if used) summarizes the structured findings above; it does not independently verify facts.");
  lines.push("- This tool does not determine legal guilt, innocence, or clinical risk. Consult qualified professionals for those determinations.");

  return lines.join("\n");
}
