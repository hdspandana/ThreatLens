import { describe, expect, it } from "vitest";
import { generateReportMarkdown } from "@/lib/threatlens/reporting/service";
import type { EvidenceRecord, OcrResult, AnalysisResult } from "@/lib/threatlens/schemas/models";

const evidence: EvidenceRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  originalFilename: "screenshot.png",
  storedPath: "storage/evidence/x/original.png",
  declaredMimeType: "image/png",
  detectedMimeType: "image/png",
  sizeBytes: 1024,
  sha256: "a".repeat(64),
  uploadedAt: new Date().toISOString(),
};

const ocr: OcrResult = {
  evidenceId: evidence.id,
  engine: "tesseract.js",
  language: "eng",
  rawText: "raw ocr text",
  confidence: 55,
  regions: [],
  warnings: ["Low OCR confidence"],
  succeeded: true,
  errorMessage: null,
  createdAt: new Date().toISOString(),
};

const analysis: AnalysisResult = {
  evidenceId: evidence.id,
  processedText: { normalizedText: "verified text", segments: ["verified text"], changesApplied: [] },
  signals: [
    {
      category: "direct_threat",
      evidenceSpan: "I will hurt you",
      startOffset: 0,
      endOffset: 16,
      confidence: 0.9,
      explanation: "explicit threat",
      detectionSource: "rule_based",
    },
  ],
  risk: {
    severity: "HIGH",
    score: 6.5,
    contributingFactors: [{ category: "direct_threat", weight: 3, count: 1, description: "1 direct_threat signal" }],
    uncertainty: { level: "LOW", reasons: [] },
    explanation: "Detected 1 signal.",
  },
  references: [{ documentId: "kb-001", title: "Immediate safety first", source: "dev dataset", snippet: "...", similarity: 0.2 }],
  llm: { available: false, provider: null, model: null, summary: "fallback summary", usedFallback: true, warnings: [] },
  createdAt: new Date().toISOString(),
};

describe("generateReportMarkdown", () => {
  it("includes a non-legal disclaimer", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: "verified text", analysis });
    expect(md).toMatch(/not.*official legal document/i);
  });

  it("includes the SHA-256 and clarifies it is integrity, not authenticity", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: null, analysis: null });
    expect(md).toContain(evidence.sha256);
    expect(md.toLowerCase()).toContain("not");
    expect(md.toLowerCase()).toContain("authentic");
  });

  it("includes raw OCR text separately from verified text", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: "the corrected version", analysis: null });
    expect(md).toContain("raw ocr text");
    expect(md).toContain("the corrected version");
  });

  it("handles missing analysis gracefully", () => {
    const md = generateReportMarkdown({ evidence, ocr: null, verifiedText: null, analysis: null });
    expect(md).toMatch(/has not been run/i);
  });

  it("includes detected signals and severity when analysis is present", () => {
    const md = generateReportMarkdown({ evidence, ocr, verifiedText: "verified text", analysis });
    expect(md).toContain("direct_threat");
    expect(md).toContain("HIGH");
  });
});
